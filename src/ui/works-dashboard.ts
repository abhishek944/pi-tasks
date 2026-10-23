import { copyToClipboard, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type DelegateLink, delegateLink, focusPane } from "../agents/links.js";
import type { GitStatusCache } from "../git-status.js";
import { formatWorksMarkdown } from "../markdown.js";
import { openRepository } from "../open-repository.js";
import { formatCompletion, taskCompletion, workCompletion } from "../progress.js";
import type { TaskState } from "../state.js";
import { safeMultiline, safeSingleLine } from "../text.js";
import { formatTime, taskTime, workTime } from "../time.js";
import type { Todo, WorkWithTodos } from "../types.js";
import { border, type DelegateHitRegion, delegateHitRegion, frame, gitBorder, metricsColumn, metricsHeader, ownerBadge, recordId, rule, todoIcon } from "./panel.js";

type DashboardItem =
  | { key: `work:${string}`; kind: "work"; work: WorkWithTodos }
  | { key: `todo:${string}`; kind: "todo"; todo: Todo; work: WorkWithTodos };

const CHROME_LINES = 9;

type HeaderHitRegion = { start: number; end: number };

export class WorksDashboard implements Component, Focusable {
  focused = false;
  private selectedKey: string | undefined;
  private scrollOffset = 0;
  private detailOffset = 0;
  private detailPageSize = 1;
  private detailsVisible = false;
  private rowHits: { y: number; key: string }[] = [];
  private backHitRegion: HeaderHitRegion | undefined;
  private message = "Ready. Select an item; Escape closes.";
  private messageColor: "warning" | "success" | "error" = "warning";
  private copying = false;
  private opening = false;
  private openingDelegate = false;
  private delegateHits: DelegateHitRegion[] = [];
  private minimized = false;
  private readonly unsubscribeGit: () => void;
  private openHitRegion: HeaderHitRegion | undefined;
  private copyHitRegion: HeaderHitRegion | undefined;
  private toggleHitRegion: HeaderHitRegion | undefined;
  private disposed = false;
  private readonly refreshTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly state: TaskState,
    private readonly close: () => void,
    private readonly cwd: string,
    private readonly git: GitStatusCache,
    private readonly notify: (message: string, type: "error") => void,
  ) {
    this.unsubscribeGit = git.subscribe(() => tui.requestRender());
    this.refreshTimer = setInterval(() => {
      if (!this.disposed) this.tui.requestRender();
    }, 1_000);
    this.refreshTimer.unref?.();
  }

  render(width: number): string[] {
    this.delegateHits = [];
    this.rowHits = [];
    this.backHitRegion = undefined;
    this.copyHitRegion = undefined;
    this.openHitRegion = undefined;
    this.toggleHitRegion = undefined;
    const dialogWidth = Math.max(1, width);
    const innerWidth = Math.max(1, dialogWidth - 2);
    const works = this.state.listWorks();
    const todos = works.flatMap((work) => work.tasks);
    const items = this.items(works);
    this.syncSelection(items);
    const selected = items.find((item) => item.key === this.selectedKey);
    if (this.detailsVisible && selected) return this.renderDetailView(selected, innerWidth);
    if (!selected) this.detailsVisible = false;
    const header = this.renderHeader(innerWidth, works.length, todos.length);
    if (this.minimized) {
      return [
        gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
        frame(header, innerWidth, this.theme),
        border(innerWidth, "bottom", this.theme),
      ];
    }

    const terminalRows = this.tui.terminal.rows || process.stdout.rows || 30;
    const dialogHeight = Math.max(8, Math.min(36, Math.floor(terminalRows * 0.82)));
    const activeTodos = todos.filter((todo) => todo.status === "active").length;
    const completedTodos = todos.filter((todo) => todo.status === "completed").length;
    const summary = `${works.length} works · ${activeTodos} todos active · ${completedTodos}/${todos.length} completed · session scoped`;

    const listHeight = Math.max(0, dialogHeight - CHROME_LINES);
    if (listHeight > 0) this.keepSelectionVisible(items, listHeight);
    const rows = items.slice(this.scrollOffset, this.scrollOffset + listHeight).map((item, index) => this.renderRow(item, innerWidth, 5 + index));
    while (rows.length < listHeight) rows.push("");

    return [
      gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
      frame(header, innerWidth, this.theme),
      frame(this.theme.fg("dim", summary), innerWidth, this.theme),
      rule(innerWidth, this.theme),
      frame(metricsHeader(innerWidth, this.theme), innerWidth, this.theme),
      ...rows.map((line) => frame(line, innerWidth, this.theme)),
      rule(innerWidth, this.theme),
      frame(this.theme.fg(this.messageColor, truncateToWidth(this.message, innerWidth, "")), innerWidth, this.theme),
      frame(this.renderFooter(innerWidth), innerWidth, this.theme),
      border(innerWidth, "bottom", this.theme),
    ];
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    const items = this.items();
    this.syncSelection(items);
    const index = Math.max(0, items.findIndex((item) => item.key === this.selectedKey));
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      if (this.detailsVisible) this.backToList();
      else this.close();
      return;
    }
    if (this.detailsVisible) {
      if (this.keybindings.matches(data, "tui.select.up")) this.detailOffset = Math.max(0, this.detailOffset - 1);
      else if (this.keybindings.matches(data, "tui.select.down")) this.detailOffset += 1;
      else if (this.keybindings.matches(data, "tui.select.pageUp")) this.detailOffset = Math.max(0, this.detailOffset - this.detailPageSize);
      else if (this.keybindings.matches(data, "tui.select.pageDown")) this.detailOffset += this.detailPageSize;
      else if (matchesKey(data, "d")) {
        const selected = items.find((item) => item.key === this.selectedKey);
        const link = selected?.kind === "todo" ? delegateLink(selected.todo.taskInfo) : undefined;
        if (link) void this.openLinkedDelegate(link);
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "c")) {
      void this.copyAllAsMarkdown();
      return;
    }
    if (matchesKey(data, "o")) {
      void this.openInCursor();
      return;
    }
    if (matchesKey(data, "m")) {
      this.toggleMinimized();
      return;
    }
    if (this.minimized) return;
    if (matchesKey(data, "d")) {
      const selected = items.find((item) => item.key === this.selectedKey);
      const link = selected?.kind === "todo" ? delegateLink(selected.todo.taskInfo) : undefined;
      if (link) void this.openLinkedDelegate(link);
      else {
        this.message = "Select a delegated task with a Herdr pane link. Navigation requires Herdr.";
        this.messageColor = "warning";
        this.tui.requestRender();
      }
      return;
    }
    this.messageColor = "warning";
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.select(items, index - 1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.select(items, index + 1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.select(items, index - 10);
    } else if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.select(items, index + 10);
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      if (items.length > 0) this.openDetails();
    }
    this.tui.requestRender();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.disposed) return undefined;
    if (this.detailsVisible && event.type === "wheel" && event.wheelDelta) {
      this.detailOffset = Math.max(0, this.detailOffset + Math.sign(event.wheelDelta) * 3);
      return { handled: true, focus: true, render: true };
    }
    if (event.type === "press" && event.button === "left") {
      const delegateHit = this.delegateHits.some((region) => event.y === region.y && this.isHit(event.x, region));
      const headerHit = event.y === 1 && [this.copyHitRegion, this.openHitRegion, this.toggleHitRegion].some((region) => this.isHit(event.x, region));
      // Own the gesture so Pi does not turn repeated control clicks into text selection.
      const rowHit = this.rowHits.some((row) => row.y === event.y);
      const backHit = event.y === 1 && this.isHit(event.x, this.backHitRegion);
      if (delegateHit || headerHit || rowHit || backHit) return { handled: true };
    }
    // Legacy mouse releases omit the button; Pi still normalizes the gesture as a click.
    if (event.type !== "click" || (event.button !== "left" && event.button !== "none")) return undefined;
    const hit = this.delegateHits.find((region) => event.y === region.y && this.isHit(event.x, region));
    if (hit) {
      void this.openLinkedDelegate(hit.link);
      return { handled: true, focus: true, render: true };
    }
    if (event.y === 1 && this.isHit(event.x, this.backHitRegion)) {
      this.backToList();
      return { handled: true, focus: true, render: true };
    }
    const row = this.rowHits.find((candidate) => candidate.y === event.y);
    if (row && event.x > 0) {
      this.selectedKey = row.key;
      this.openDetails();
      return { handled: true, focus: true, render: true };
    }
    if (event.y !== 1) return undefined;
    if (this.isHit(event.x, this.toggleHitRegion)) {
      this.toggleMinimized();
      return { handled: true, focus: true, render: true };
    }
    if (this.isHit(event.x, this.copyHitRegion)) {
      void this.copyAllAsMarkdown();
      return { handled: true, focus: true, render: true };
    }
    if (this.isHit(event.x, this.openHitRegion)) {
      void this.openInCursor();
      return { handled: true, focus: true, render: true };
    }
    return undefined;
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeGit();
    clearInterval(this.refreshTimer);
  }

  private items(works = this.state.listWorks()): DashboardItem[] {
    const items: DashboardItem[] = [];
    for (const work of works) {
      items.push({ key: `work:${work.workId}`, kind: "work", work });
      for (const todo of work.tasks) items.push({ key: `todo:${todo.taskId}`, kind: "todo", todo, work });
    }
    return items;
  }

  private syncSelection(items: DashboardItem[]): void {
    if (items.some((item) => item.key === this.selectedKey)) return;
    this.selectedKey = items[0]?.key;
    this.scrollOffset = 0;
    this.detailsVisible = false;
    this.detailOffset = 0;
  }

  private select(items: DashboardItem[], index: number): void {
    if (items.length === 0) return;
    this.selectedKey = items[Math.max(0, Math.min(index, items.length - 1))]?.key;
    this.detailOffset = 0;
  }

  private keepSelectionVisible(items: DashboardItem[], height: number): void {
    const index = Math.max(0, items.findIndex((item) => item.key === this.selectedKey));
    if (index < this.scrollOffset) this.scrollOffset = index;
    if (index >= this.scrollOffset + height) this.scrollOffset = index - height + 1;
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, items.length - height)));
  }

  private renderRow(item: DashboardItem, width: number, y: number): string {
    this.rowHits.push({ y, key: item.key });
    const selected = item.key === this.selectedKey;
    const prefix = selected ? this.theme.fg("accent", "▶ ") : "  ";
    if (item.kind === "work") {
      const done = item.work.tasks.filter((todo) => todo.status === "completed").length;
      const metadata = this.theme.fg("dim", `${done}/${item.work.tasks.length} completed`);
      const label = `${prefix}${this.theme.bold(`${recordId(item.work.workId, this.theme)} ${safeSingleLine(item.work.workName)}`)} ${metadata}`;
      return metricsColumn(label, workCompletion(item.work), workTime(item.work), item.work.tasks.some((todo) => todo.workingSince !== undefined), width, this.theme);
    }
    const metadata = this.theme.fg("dim", item.todo.status);
    const label = `${prefix}  ${todoIcon(item.todo.status, this.theme)} ${recordId(item.todo.taskId, this.theme)} ${ownerBadge(item.todo.taskInfo, this.theme, Boolean(delegateLink(item.todo.taskInfo)))} ${safeSingleLine(item.todo.taskName)} ${metadata}`;
    const line = metricsColumn(label, taskCompletion(item.todo), taskTime(item.todo), item.todo.workingSince !== undefined, width, this.theme);
    const start = visibleWidth(`${prefix}  ${todoIcon(item.todo.status, this.theme)} ${recordId(item.todo.taskId, this.theme)} `);
    const hit = delegateHitRegion(delegateLink(item.todo.taskInfo), start, line, y);
    if (hit) this.delegateHits.push(hit);
    return line;
  }

  private openDetails(): void {
    this.detailsVisible = true;
    this.detailOffset = 0;
    this.tui.requestRender();
  }

  private backToList(): void {
    this.detailsVisible = false;
    this.detailOffset = 0;
    this.message = "Select a task; Enter opens details. Escape closes.";
    this.messageColor = "warning";
    this.tui.requestRender();
  }

  private renderDetailView(item: DashboardItem, width: number): string[] {
    const rows = this.tui.terminal.rows || process.stdout.rows || 30;
    const height = Math.max(8, Math.min(36, Math.floor(rows * 0.82)));
    const budget = Math.max(1, height - 6);
    const back = truncateToWidth(this.theme.fg("accent", this.theme.underline("[← Back to works]")), width, "");
    this.backHitRegion = { start: 1, end: 1 + visibleWidth(back) };
    const task = item.kind === "todo" ? item.todo : undefined;
    const link = task ? delegateLink(task.taskInfo) : undefined;
    const label = task
      ? `Task details · ${recordId(task.taskId, this.theme)} ${ownerBadge(task.taskInfo, this.theme, Boolean(link))}`
      : `Work details · ${recordId(item.work.workId, this.theme)}`;
    const available = Math.max(0, width - visibleWidth(back) - 1);
    const shownLabel = truncateToWidth(label, available, "");
    const gap = " ".repeat(Math.max(0, width - visibleWidth(back) - visibleWidth(shownLabel)));
    const header = `${back}${gap}${shownLabel}`;
    if (task) {
      const ownerStart = visibleWidth(`${back}${gap}Task details · ${recordId(task.taskId, this.theme)} `);
      const hit = delegateHitRegion(link, ownerStart, header, 1);
      if (hit) this.delegateHits.push(hit);
    }
    const contentWidth = Math.max(1, width - 4);
    const wrap = (text: string) => text.split("\n").flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth));
    const name = task?.taskName ?? item.work.workName;
    const lines = ["", ...wrap(this.theme.bold(safeSingleLine(name))), ""];
    if (task) {
      lines.push(...wrap(this.theme.fg("muted", `${recordId(item.work.workId, this.theme)} ${safeSingleLine(item.work.workName)}`)), "");
      const status = `${todoIcon(task.status, this.theme)} ${task.status}`;
      lines.push(...wrap(`${status} · ${formatCompletion(taskCompletion(task))} complete · Time: ${formatTime(taskTime(task))}`), "");
      if (task.status === "blocked") {
        const reasonWidth = Math.max(1, contentWidth - 2);
        for (const line of safeMultiline(`Reason: ${task.blockedReason ?? "No reason recorded."}`)) {
          lines.push(...wrapTextWithAnsi(line || " ", reasonWidth).map((part) => this.theme.fg("warning", `│ ${part}`)));
        }
        lines.push("");
      }
    } else {
      lines.push(...wrap(`${formatCompletion(workCompletion(item.work))} complete · Time (task effort): ${formatTime(workTime(item.work))}`), "");
    }
    lines.push(this.theme.fg("accent", this.theme.bold(task ? "Task details" : "Work details")));
    lines.push(...safeMultiline(task?.taskInfo ?? item.work.workInfo).flatMap(wrap));
    this.detailPageSize = budget;
    this.detailOffset = Math.max(0, Math.min(this.detailOffset, Math.max(0, lines.length - budget)));
    const shown = lines.slice(this.detailOffset, this.detailOffset + budget);
    while (shown.length < budget) shown.push("");
    const position = lines.length > budget ? ` · ${this.detailOffset + 1}-${Math.min(lines.length, this.detailOffset + budget)}/${lines.length}` : "";
    const footer = `↑/↓ scroll · PgUp/PgDn page · Esc back to works${position}`;
    return [
      gitBorder(width, this.theme, this.git.getSnapshot()),
      frame(header, width, this.theme),
      rule(width, this.theme),
      ...shown.map((line) => frame(`  ${line}`, width, this.theme)),
      rule(width, this.theme),
      frame(truncateToWidth(this.theme.fg("muted", footer), width, ""), width, this.theme),
      border(width, "bottom", this.theme),
    ];
  }

  private renderHeader(width: number, workCount: number, todoCount: number): string {
    const titleText = this.minimized
      ? `Works (${workCount} work${workCount === 1 ? "" : "s"}, ${todoCount} todo${todoCount === 1 ? "" : "s"})`
      : "Works · session work and todos";
    const title = this.theme.fg("accent", this.theme.bold(titleText));
    const copyAction = this.copying
      ? this.theme.fg("dim", "[Copying…]")
      : this.theme.fg("accent", this.theme.bold("[C Copy]"));
    const openAction = this.theme.fg(this.opening ? "dim" : "accent", this.theme.underline(this.theme.bold("[O Open]")));
    const toggleLabel = this.minimized ? "[M Maximize]" : "[M Minimize]";
    const toggleAction = this.theme.fg("accent", this.theme.bold(toggleLabel));
    const actionsWidth = visibleWidth(copyAction) + 1 + visibleWidth(openAction) + 1 + visibleWidth(toggleAction);
    const titleWidth = Math.max(0, width - actionsWidth - 1);
    const shownTitle = truncateToWidth(title, titleWidth, "");
    const gap = " ".repeat(Math.max(1, width - visibleWidth(shownTitle) - actionsWidth));
    const copyStart = 1 + visibleWidth(shownTitle) + gap.length;
    this.copyHitRegion = { start: copyStart, end: copyStart + visibleWidth(copyAction) };
    const openStart = this.copyHitRegion.end + 1;
    this.openHitRegion = { start: openStart, end: openStart + visibleWidth(openAction) };
    const toggleStart = this.openHitRegion.end + 1;
    this.toggleHitRegion = { start: toggleStart, end: toggleStart + visibleWidth(toggleAction) };
    return `${shownTitle}${gap}${copyAction} ${openAction} ${toggleAction}`;
  }

  private toggleMinimized(): void {
    this.minimized = !this.minimized;
    if (!this.minimized) {
      this.message = "Dashboard maximized.";
      this.messageColor = "warning";
    }
    this.tui.requestRender();
  }

  private isHit(x: number, region: HeaderHitRegion | undefined): boolean {
    return region !== undefined && x >= region.start && x < region.end;
  }

  private async openLinkedDelegate(link: DelegateLink): Promise<void> {
    if (this.openingDelegate) return;
    this.openingDelegate = true;
    this.message = "Opening delegated agent in Herdr…";
    this.messageColor = "warning";
    this.tui.requestRender();
    try {
      await focusPane(link.paneId, this.cwd);
      this.message = "Opened delegated agent in Herdr.";
      this.messageColor = "success";
    } catch (error) {
      const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
      this.message = `Could not open delegate. ${reason}`;
      this.messageColor = "error";
      if (!this.disposed) this.notify(this.message, "error");
    } finally {
      this.openingDelegate = false;
      if (!this.disposed) this.tui.requestRender();
    }
  }

  private async openInCursor(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    this.message = "Opening repository in Cursor…";
    this.messageColor = "warning";
    this.tui.requestRender();
    try {
      await openRepository(this.cwd);
      this.message = "Opened repository in Cursor.";
      this.messageColor = "success";
    } catch (error) {
      const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
      this.message = `Could not open Cursor. Check cursor is on PATH.${reason}`;
      this.messageColor = "error";
      if (!this.disposed) this.notify(this.message, "error");
    } finally {
      this.opening = false;
      if (!this.disposed) this.tui.requestRender();
    }
  }

  private async copyAllAsMarkdown(): Promise<void> {
    if (this.copying) return;
    this.copying = true;
    this.message = "Copying all works and todos as Markdown…";
    this.messageColor = "warning";
    this.tui.requestRender();

    const works = this.state.listWorks();
    try {
      await copyToClipboard(formatWorksMarkdown(works));
      const todoCount = works.reduce((total, work) => total + work.tasks.length, 0);
      this.message = `Copied ${works.length} work${works.length === 1 ? "" : "s"} and ${todoCount} todo${todoCount === 1 ? "" : "s"} as Markdown.`;
      this.messageColor = "success";
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${safeSingleLine(error.message)}` : "";
      this.message = `Could not copy works and todos.${reason}`;
      this.messageColor = "error";
    } finally {
      this.copying = false;
      if (!this.disposed) this.tui.requestRender();
    }
  }

  private renderFooter(width: number): string {
    const text = "↑/↓ select · Enter details · Esc close · C copy · O Cursor · D delegate · M minimize";
    return truncateToWidth(this.theme.fg("muted", text), width, "");
  }
}

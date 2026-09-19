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
import type { TaskState } from "../state.js";
import { safeMultiline, safeSingleLine } from "../text.js";
import type { Todo, WorkWithTodos } from "../types.js";
import { border, frame, rule, todoIcon, workIcon } from "./panel.js";

type DashboardItem =
  | { key: `work:${string}`; kind: "work"; work: WorkWithTodos }
  | { key: `todo:${string}`; kind: "todo"; todo: Todo; workName: string };

const CHROME_LINES = 8;

type HeaderHitRegion = { start: number; end: number };

export class WorksDashboard implements Component, Focusable {
  focused = false;
  private selectedKey: string | undefined;
  private scrollOffset = 0;
  private detailOffset = 0;
  private detailPageSize = 1;
  private detailsVisible = true;
  private message = "Ready. Select an item; Escape closes.";
  private messageColor: "warning" | "success" | "error" = "warning";
  private copying = false;
  private minimized = false;
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
  ) {
    this.refreshTimer = setInterval(() => {
      if (!this.disposed) this.tui.requestRender();
    }, 1_000);
    this.refreshTimer.unref?.();
  }

  render(width: number): string[] {
    const dialogWidth = Math.max(1, width);
    const innerWidth = Math.max(1, dialogWidth - 2);
    const works = this.state.listWorks();
    const todos = works.flatMap((work) => work.tasks);
    const header = this.renderHeader(innerWidth, works.length, todos.length);
    if (this.minimized) {
      return [
        border(innerWidth, "top", this.theme),
        frame(header, innerWidth, this.theme),
        border(innerWidth, "bottom", this.theme),
      ];
    }

    const items = this.items(works);
    this.syncSelection(items);
    const terminalRows = this.tui.terminal.rows || process.stdout.rows || 30;
    const dialogHeight = Math.max(8, Math.min(36, Math.floor(terminalRows * 0.82)));
    const activeWorks = works.filter((work) => work.status === "active").length;
    const completedTodos = todos.filter((todo) => todo.status === "completed").length;
    const summary = `${activeWorks}/${works.length} works active · ${completedTodos}/${todos.length} todos completed · session scoped`;

    const bodyHeight = Math.max(0, dialogHeight - CHROME_LINES);
    const detailBudget = this.detailsVisible ? Math.max(0, Math.floor(bodyHeight / 2)) : 0;
    const details = this.renderDetails(items, innerWidth, detailBudget);
    const listHeight = Math.max(0, bodyHeight - details.length);
    if (listHeight > 0) this.keepSelectionVisible(items, listHeight);
    const rows = items.slice(this.scrollOffset, this.scrollOffset + listHeight).map((item) => this.renderRow(item, innerWidth));
    while (rows.length < listHeight) rows.push("");

    return [
      border(innerWidth, "top", this.theme),
      frame(header, innerWidth, this.theme),
      frame(this.theme.fg("dim", summary), innerWidth, this.theme),
      rule(innerWidth, this.theme),
      ...[...rows, ...details].map((line) => frame(line, innerWidth, this.theme)),
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
      this.close();
      return;
    }
    if (matchesKey(data, "c")) {
      void this.copyAllAsMarkdown();
      return;
    }
    if (matchesKey(data, "m")) {
      this.toggleMinimized();
      return;
    }
    if (this.minimized) return;
    this.messageColor = "warning";
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.select(items, index - 1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.select(items, index + 1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.detailOffset = Math.max(0, this.detailOffset - this.detailPageSize);
      this.message = "Moved detail view up.";
    } else if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.detailOffset += this.detailPageSize;
      this.message = "Moved detail view down.";
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.detailsVisible = !this.detailsVisible;
      this.detailOffset = 0;
      this.message = this.detailsVisible ? "Details shown." : "Details hidden.";
    }
    this.tui.requestRender();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.disposed || event.type !== "click" || event.button !== "left" || event.y !== 1) return undefined;
    if (this.isHit(event.x, this.toggleHitRegion)) {
      this.toggleMinimized();
      return { handled: true, focus: true, render: true };
    }
    if (this.isHit(event.x, this.copyHitRegion)) {
      void this.copyAllAsMarkdown();
      return { handled: true, focus: true, render: true };
    }
    return undefined;
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.refreshTimer);
  }

  private items(works = this.state.listWorks()): DashboardItem[] {
    const items: DashboardItem[] = [];
    for (const work of works) {
      items.push({ key: `work:${work.workId}`, kind: "work", work });
      for (const todo of work.tasks) items.push({ key: `todo:${todo.taskId}`, kind: "todo", todo, workName: work.workName });
    }
    return items;
  }

  private syncSelection(items: DashboardItem[]): void {
    if (items.some((item) => item.key === this.selectedKey)) return;
    this.selectedKey = items[0]?.key;
    this.scrollOffset = 0;
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

  private renderRow(item: DashboardItem, width: number): string {
    const selected = item.key === this.selectedKey;
    const prefix = selected ? this.theme.fg("accent", "▶ ") : "  ";
    if (item.kind === "work") {
      const done = item.work.tasks.filter((todo) => todo.status === "completed").length;
      return truncateToWidth(`${prefix}${workIcon(item.work.status, this.theme)} ${this.theme.bold(safeSingleLine(item.work.workName))} ${this.theme.fg("dim", `${item.work.workId} · ${item.work.status} · ${done}/${item.work.tasks.length}`)}`, width, "");
    }
    return truncateToWidth(`${prefix}  ${todoIcon(item.todo.status, this.theme)} ${safeSingleLine(item.todo.taskName)} ${this.theme.fg("dim", `${item.todo.taskId} · ${item.todo.status}`)}`, width, "");
  }

  private renderDetails(items: DashboardItem[], width: number, budget: number): string[] {
    if (!this.detailsVisible || budget === 0) return [];
    const item = items.find((candidate) => candidate.key === this.selectedKey);
    if (!item) return [this.theme.fg("muted", "No works or todos in this session.")].slice(0, budget);
    const heading = item.kind === "work"
      ? `${item.work.workId} · ${safeSingleLine(item.work.workName)} · ${item.work.status}`
      : `${item.todo.taskId} · ${safeSingleLine(item.todo.taskName)} · ${item.todo.status} · ${item.todo.workId} ${safeSingleLine(item.workName)}`;
    const info = item.kind === "work" ? item.work.workInfo : item.todo.taskInfo;
    const infoLines = safeMultiline(info).flatMap((line) => wrapTextWithAnsi(this.theme.fg("dim", line || " "), width));
    const contentBudget = Math.max(0, budget - 3);
    this.detailPageSize = Math.max(1, contentBudget);
    const maxOffset = Math.max(0, infoLines.length - contentBudget);
    this.detailOffset = Math.min(this.detailOffset, maxOffset);
    const shown = infoLines.slice(this.detailOffset, this.detailOffset + contentBudget);
    const position = infoLines.length > shown.length ? ` · lines ${this.detailOffset + 1}-${this.detailOffset + shown.length}/${infoLines.length}` : "";
    return [
      this.theme.fg("accent", this.theme.bold(`DETAILS${position}`)),
      truncateToWidth(heading, width, ""),
      ...shown,
    ].slice(0, budget);
  }

  private renderHeader(width: number, workCount: number, todoCount: number): string {
    const titleText = this.minimized
      ? `Works (${workCount} work${workCount === 1 ? "" : "s"}, ${todoCount} todo${todoCount === 1 ? "" : "s"})`
      : "Works · session work and todos";
    const title = this.theme.fg("accent", this.theme.bold(titleText));
    const copyAction = this.copying
      ? this.theme.fg("dim", "[Copying…]")
      : this.theme.fg("accent", this.theme.bold("[C Copy]"));
    const toggleLabel = this.minimized ? "[M Maximize]" : "[M Minimize]";
    const toggleAction = this.theme.fg("accent", this.theme.bold(toggleLabel));
    const actionsWidth = visibleWidth(copyAction) + 1 + visibleWidth(toggleAction);
    const titleWidth = Math.max(0, width - actionsWidth - 1);
    const shownTitle = truncateToWidth(title, titleWidth, "");
    const gap = " ".repeat(Math.max(1, width - visibleWidth(shownTitle) - actionsWidth));
    const copyStart = 1 + visibleWidth(shownTitle) + gap.length;
    this.copyHitRegion = { start: copyStart, end: copyStart + visibleWidth(copyAction) };
    const toggleStart = this.copyHitRegion.end + 1;
    this.toggleHitRegion = { start: toggleStart, end: toggleStart + visibleWidth(toggleAction) };
    return `${shownTitle}${gap}${copyAction} ${toggleAction}`;
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
    const text = "C copy all · M minimize · configured ↑/↓ select · PgUp/PgDn scroll details · confirm toggles · cancel closes";
    return truncateToWidth(this.theme.fg("muted", text), width, "");
  }
}

function formatWorksMarkdown(works: WorkWithTodos[]): string {
  const lines = ["# Works and Todos", ""];
  if (works.length === 0) return `${lines.join("\n")}\n_No works or todos in this session._\n`;

  for (const work of works) {
    lines.push(
      `## ${work.workId} — ${escapeMarkdownInline(safeSingleLine(work.workName))}`,
      "",
      `**Status:** ${work.status}`,
      "",
      "### Details",
      "",
      markdownBody(work.workInfo),
      "",
      "### Todos",
      "",
    );
    if (work.tasks.length === 0) {
      lines.push("_No todos._", "");
      continue;
    }
    for (const todo of work.tasks) {
      lines.push(
        `#### ${todo.taskId} — ${escapeMarkdownInline(safeSingleLine(todo.taskName))}`,
        "",
        `**Status:** ${todo.status}`,
        "",
        markdownBody(todo.taskInfo),
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function markdownBody(value: string): string {
  return safeMultiline(value).join("\n").trim() || "_No details provided._";
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([-\\`*_[\]{}()<>#+.!|])/g, "\\$1");
}

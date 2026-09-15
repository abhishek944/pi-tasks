import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, type TUI, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TaskState } from "../state.js";
import { safeMultiline, safeSingleLine } from "../text.js";
import type { Todo, WorkWithTodos } from "../types.js";
import { border, frame, rule, todoIcon, workIcon } from "./panel.js";

type DashboardItem =
  | { key: `work:${string}`; kind: "work"; work: WorkWithTodos }
  | { key: `todo:${string}`; kind: "todo"; todo: Todo; workName: string };

const CHROME_LINES = 8;

export class WorksDashboard implements Component, Focusable {
  focused = false;
  private selectedKey: string | undefined;
  private scrollOffset = 0;
  private detailOffset = 0;
  private detailPageSize = 1;
  private detailsVisible = true;
  private message = "Ready. Select an item; Escape closes.";
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
    const items = this.items();
    this.syncSelection(items);
    const terminalRows = this.tui.terminal.rows || process.stdout.rows || 30;
    const dialogHeight = Math.max(8, Math.min(36, Math.floor(terminalRows * 0.82)));
    const works = this.state.listWorks();
    const todos = works.flatMap((work) => work.tasks);
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
      frame(this.theme.fg("accent", this.theme.bold("Works · session work and todos")), innerWidth, this.theme),
      frame(this.theme.fg("dim", summary), innerWidth, this.theme),
      rule(innerWidth, this.theme),
      ...[...rows, ...details].map((line) => frame(line, innerWidth, this.theme)),
      rule(innerWidth, this.theme),
      frame(this.theme.fg("warning", truncateToWidth(this.message, innerWidth, "")), innerWidth, this.theme),
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

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.refreshTimer);
  }

  private items(): DashboardItem[] {
    const items: DashboardItem[] = [];
    for (const work of this.state.listWorks()) {
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

  private renderFooter(width: number): string {
    const text = "configured ↑/↓ select · PgUp/PgDn scroll details · confirm toggles · cancel closes";
    return truncateToWidth(this.theme.fg("muted", text), width, "");
  }
}

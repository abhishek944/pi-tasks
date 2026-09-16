import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, Key, matchesKey, type OverlayHandle, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TaskState } from "../state.js";
import type { TodoStatus, WorkStatus } from "../types.js";

export type TasksPanelMode = "floating" | "widget" | "off";
const EMPTY_COMPONENT: Component = { render: () => [], invalidate: () => {} };

export class TasksPanelHost {
  private tui: TUI | undefined;
  private panel: TasksPanel | undefined;
  private handle: OverlayHandle | undefined;
  private ui: ExtensionUIContext | undefined;
  private mode: TasksPanelMode = "floating";

  constructor(private readonly state: TaskState) {}

  attach(ui: ExtensionUIContext): void {
    this.hideCurrent();
    this.ui = ui;
    this.applyMode();
  }

  setMode(mode: TasksPanelMode): void {
    this.mode = mode;
    if (this.ui) this.applyMode();
  }

  getMode(): TasksPanelMode {
    return this.mode;
  }

  browse(): string | undefined {
    if (this.mode !== "floating") return "Use /works-panel floating before browsing the panel.";
    if (!this.tui || !this.panel || !this.handle) return "The Works panel is not available.";
    const columns = this.tui.terminal.columns || process.stdout.columns || 0;
    const rows = this.tui.terminal.rows || process.stdout.rows || 0;
    if (columns < 90 || rows < 18) return "The terminal is too small to browse the Works panel.";
    this.handle.focus();
    this.tui.requestRender();
    return undefined;
  }

  update(): void {
    this.panel?.invalidate();
    this.tui?.requestRender();
  }

  hide(): void {
    this.hideCurrent();
    this.ui = undefined;
  }

  private applyMode(): void {
    const ui = this.ui;
    if (!ui) return;
    this.hideCurrent();
    this.ui = ui;
    if (this.mode === "off") return;

    if (this.mode === "widget") {
      ui.setWidget("pi-tasks-panel", (tui, theme) => {
        this.tui = tui;
        this.panel = new TasksPanel(tui, this.state, theme, "widget");
        return this.panel;
      });
      return;
    }

    ui.setWidget("pi-tasks-panel-host", (tui, theme) => {
      this.tui = tui;
      this.panel = new TasksPanel(tui, this.state, theme, "floating", () => this.handle?.unfocus());
      this.handle = tui.showOverlay(this.panel, {
        anchor: "top-right",
        width: "42%",
        minWidth: 38,
        maxHeight: "48%",
        margin: { top: 1, right: 1 },
        nonCapturing: true,
        visible: (terminalWidth, terminalHeight) => terminalWidth >= 90 && terminalHeight >= 18,
      });
      return EMPTY_COMPONENT;
    });
  }

  private hideCurrent(): void {
    this.handle?.hide();
    this.handle = undefined;
    this.ui?.setWidget("pi-tasks-panel", undefined);
    this.ui?.setWidget("pi-tasks-panel-host", undefined);
    this.panel = undefined;
    this.tui = undefined;
  }
}

class TasksPanel implements Component, Focusable {
  focused = false;
  private scrollOffset = 0;
  private pageSize = 1;
  private contentLength = 0;

  constructor(
    private readonly tui: TUI,
    private readonly state: TaskState,
    private readonly theme: Theme,
    private readonly placement: "floating" | "widget",
    private readonly releaseFocus?: () => void,
  ) {}

  render(width: number): string[] {
    if (width < 38) return [];
    const works = this.state.listWorks();
    const boxWidth = this.placement === "floating" ? width : Math.min(54, Math.max(38, Math.floor(width * 0.44)));
    const innerWidth = boxWidth - 2;
    const leftPad = this.placement === "widget" ? " ".repeat(Math.max(0, width - boxWidth)) : "";
    const content: string[] = [];
    if (works.length === 0) content.push(this.theme.fg("muted", "No works yet."));
    for (const work of works) {
      const completed = work.tasks.filter((todo) => todo.status === "completed").length;
      content.push(workSummaryLine(work.status, work.workName, `${completed}/${work.tasks.length}`, innerWidth, this.theme));
      for (const todo of work.tasks) content.push(`  ${todoIcon(todo.status, this.theme)} ${this.theme.fg(todo.status === "completed" ? "muted" : "text", todo.taskName)}`);
    }

    this.contentLength = content.length;
    const terminalRows = this.tui.terminal.rows || process.stdout.rows || 30;
    this.pageSize = this.placement === "widget" ? Math.max(1, content.length) : Math.max(1, Math.floor(terminalRows * 0.48) - 4);
    this.clampScrollOffset();
    const shown = content.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
    const hasOverflow = content.length > shown.length;
    const range = `${this.scrollOffset + 1}–${this.scrollOffset + shown.length}/${content.length}`;
    let title = "Works";
    if (this.placement === "floating" && (hasOverflow || this.scrollOffset > 0)) {
      title += this.focused ? ` · ${range} · ↑↓ PgUp/PgDn · Esc` : ` · ${range} · /works-panel browse`;
    } else if (this.focused) {
      title += " · Esc to return";
    }

    const lines = [
      border(innerWidth, "top", this.theme),
      frame(this.theme.fg("accent", this.theme.bold(title)), innerWidth, this.theme),
      rule(innerWidth, this.theme),
      ...shown.map((line) => frame(line, innerWidth, this.theme)),
      border(innerWidth, "bottom", this.theme),
    ];
    return lines.map((line) => `${leftPad}${line}`);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.releaseFocus?.();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.up)) this.scrollBy(-1);
    else if (matchesKey(data, Key.down)) this.scrollBy(1);
    else if (matchesKey(data, Key.pageUp)) this.scrollBy(-this.pageSize);
    else if (matchesKey(data, Key.pageDown)) this.scrollBy(this.pageSize);
    else if (matchesKey(data, Key.home)) this.scrollTo(0);
    else if (matchesKey(data, Key.end)) this.scrollTo(this.contentLength);
  }

  invalidate(): void {}

  private scrollBy(lines: number): void {
    this.scrollTo(this.scrollOffset + lines);
  }

  private scrollTo(offset: number): void {
    this.scrollOffset = offset;
    this.clampScrollOffset();
    this.tui.requestRender();
  }

  private clampScrollOffset(): void {
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, this.contentLength - this.pageSize)));
  }
}

function workSummaryLine(status: WorkStatus, name: string, count: string, width: number, theme: Theme): string {
  const left = `${workIcon(status, theme)} ${theme.fg("text", name)}`;
  const right = theme.fg("dim", count);
  const leftWidth = Math.max(0, width - visibleWidth(right) - 1);
  const shownLeft = truncateToWidth(left, leftWidth, "…");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(shownLeft) - visibleWidth(right)));
  return `${shownLeft}${gap}${right}`;
}

export function workIcon(status: WorkStatus, theme: Theme): string {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "active") return theme.fg("accent", "▶");
  if (status === "blocked") return theme.fg("warning", "!");
  if (status === "cancelled") return theme.fg("error", "×");
  return theme.fg("muted", "○");
}

export function todoIcon(status: TodoStatus, theme: Theme): string {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "active") return theme.fg("accent", "▶");
  if (status === "blocked") return theme.fg("warning", "!");
  if (status === "cancelled") return theme.fg("error", "×");
  return theme.fg("muted", "○");
}

export function frame(content: string, innerWidth: number, theme: Theme): string {
  const truncated = truncateToWidth(content, innerWidth, "");
  return `${theme.fg("border", "│")}${truncated}${" ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)))}${theme.fg("border", "│")}`;
}

export function rule(innerWidth: number, theme: Theme): string {
  return theme.fg("border", `├${"─".repeat(innerWidth)}┤`);
}

export function border(innerWidth: number, edge: "top" | "bottom", theme: Theme): string {
  return theme.fg("border", `${edge === "top" ? "┌" : "└"}${"─".repeat(innerWidth)}${edge === "top" ? "┐" : "┘"}`);
}

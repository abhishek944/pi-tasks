import { copyToClipboard, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayHandle, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatWorksMarkdown } from "../markdown.js";
import type { TaskState } from "../state.js";
import { safeSingleLine } from "../text.js";
import type { TodoStatus, WorkStatus } from "../types.js";

export type TasksPanelMode = "floating" | "widget" | "off";
type HeaderHitRegion = { start: number; end: number };
type Notify = (message: string, type?: "info" | "warning" | "error") => void;
const EMPTY_COMPONENT: Component = { render: () => [], invalidate: () => {} };

export class TasksPanelHost {
  private tui: TUI | undefined;
  private panel: TasksPanel | undefined;
  private handle: OverlayHandle | undefined;
  private ui: ExtensionUIContext | undefined;
  private mode: TasksPanelMode = "floating";
  private minimized = false;

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

  setMinimized(minimized: boolean): void {
    this.minimized = minimized;
    this.panel?.setMinimized(minimized);
    this.tui?.requestRender();
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
        this.panel = new TasksPanel(
          tui,
          this.state,
          theme,
          "widget",
          this.minimized,
          (minimized) => {
            this.minimized = minimized;
          },
          (message, type) => ui.notify(message, type),
        );
        return this.panel;
      });
      return;
    }

    ui.setWidget("pi-tasks-panel-host", (tui, theme) => {
      this.tui = tui;
      this.panel = new TasksPanel(
        tui,
        this.state,
        theme,
        "floating",
        this.minimized,
        (minimized) => {
          this.minimized = minimized;
        },
        (message, type) => ui.notify(message, type),
      );
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

class TasksPanel implements Component {
  private scrollOffset = 0;
  private pageSize = 1;
  private contentLength = 0;
  private followTail = true;
  private copying = false;
  private copyHitRegion: HeaderHitRegion | undefined;
  private toggleHitRegion: HeaderHitRegion | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly state: TaskState,
    private readonly theme: Theme,
    private readonly placement: "floating" | "widget",
    private minimized: boolean,
    private readonly onMinimizedChange: (minimized: boolean) => void,
    private readonly notify: Notify,
  ) {}

  render(width: number): string[] {
    if (width < 38) return [];
    const works = this.state.listWorks();
    const boxWidth = this.placement === "floating" ? width : Math.min(54, Math.max(38, Math.floor(width * 0.44)));
    const innerWidth = boxWidth - 2;
    const leftPad = this.placement === "widget" ? " ".repeat(Math.max(0, width - boxWidth)) : "";
    if (this.minimized) {
      const header = this.renderHeader("Works", innerWidth, leftPad.length);
      return [
        border(innerWidth, "top", this.theme),
        frame(header, innerWidth, this.theme),
        border(innerWidth, "bottom", this.theme),
      ].map((line) => `${leftPad}${line}`);
    }

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
    if (this.placement === "widget") {
      this.scrollOffset = 0;
      this.followTail = true;
    } else if (this.followTail) {
      this.scrollOffset = this.maxScrollOffset();
    } else {
      this.clampScrollOffset();
    }
    const shown = content.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
    const hasOverflow = content.length > this.pageSize;
    const range = `${this.scrollOffset + 1}–${this.scrollOffset + shown.length}/${content.length}`;
    let title = "Works";
    if (this.placement === "floating" && hasOverflow) {
      title += this.tui.mode === "fullscreen"
        ? ` · ${range} · wheel to scroll`
        : ` · ${range} · latest · /works for all`;
    }

    const header = this.renderHeader(title, innerWidth, leftPad.length);
    const lines = [
      border(innerWidth, "top", this.theme),
      frame(header, innerWidth, this.theme),
      rule(innerWidth, this.theme),
      ...shown.map((line) => frame(line, innerWidth, this.theme)),
      border(innerWidth, "bottom", this.theme),
    ];
    return lines.map((line) => `${leftPad}${line}`);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left" && event.y === 1) {
      if (this.isHit(event.x, this.toggleHitRegion)) {
        this.setMinimized(!this.minimized);
        return { handled: true, render: true };
      }
      if (this.isHit(event.x, this.copyHitRegion)) {
        void this.copyAllAsMarkdown();
        return { handled: true, render: true };
      }
    }
    if (this.minimized || this.placement !== "floating" || event.type !== "wheel" || !event.wheelDelta) return undefined;
    const changed = this.scrollBy(event.wheelDelta < 0 ? -1 : 1);
    return { handled: true, render: changed };
  }

  invalidate(): void {}

  setMinimized(minimized: boolean): void {
    if (this.minimized === minimized) return;
    this.minimized = minimized;
    this.onMinimizedChange(minimized);
    this.tui.requestRender();
  }

  private renderHeader(titleText: string, width: number, leftPadWidth: number): string {
    const title = this.theme.fg("accent", this.theme.bold(titleText));
    const copyAction = this.copying
      ? this.theme.fg("dim", "[Copying…]")
      : this.theme.fg("accent", this.theme.bold("[Copy]"));
    const toggleLabel = this.minimized ? "[Maximize]" : "[Minimize]";
    const toggleAction = this.theme.fg("accent", this.theme.bold(toggleLabel));
    const actionsWidth = visibleWidth(copyAction) + 1 + visibleWidth(toggleAction);
    const titleWidth = Math.max(0, width - actionsWidth - 1);
    const shownTitle = truncateToWidth(title, titleWidth, "");
    const gap = " ".repeat(Math.max(1, width - visibleWidth(shownTitle) - actionsWidth));
    const copyStart = leftPadWidth + 1 + visibleWidth(shownTitle) + gap.length;
    this.copyHitRegion = { start: copyStart, end: copyStart + visibleWidth(copyAction) };
    const toggleStart = this.copyHitRegion.end + 1;
    this.toggleHitRegion = { start: toggleStart, end: toggleStart + visibleWidth(toggleAction) };
    return `${shownTitle}${gap}${copyAction} ${toggleAction}`;
  }

  private isHit(x: number, region: HeaderHitRegion | undefined): boolean {
    return region !== undefined && x >= region.start && x < region.end;
  }

  private async copyAllAsMarkdown(): Promise<void> {
    if (this.copying) return;
    this.copying = true;
    this.tui.requestRender();
    const works = this.state.listWorks();
    try {
      await copyToClipboard(formatWorksMarkdown(works));
      const todoCount = works.reduce((total, work) => total + work.tasks.length, 0);
      this.notify(`Copied ${works.length} work${works.length === 1 ? "" : "s"} and ${todoCount} todo${todoCount === 1 ? "" : "s"} as Markdown.`, "info");
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${safeSingleLine(error.message)}` : "";
      this.notify(`Could not copy works and todos.${reason}`, "error");
    } finally {
      this.copying = false;
      this.tui.requestRender();
    }
  }

  private scrollBy(lines: number): boolean {
    return this.scrollTo(this.scrollOffset + lines);
  }

  private scrollTo(offset: number): boolean {
    const previous = this.scrollOffset;
    this.scrollOffset = Math.max(0, Math.min(offset, this.maxScrollOffset()));
    this.followTail = this.scrollOffset >= this.maxScrollOffset();
    return this.scrollOffset !== previous;
  }

  private clampScrollOffset(): void {
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset()));
    if (this.scrollOffset >= this.maxScrollOffset()) this.followTail = true;
  }

  private maxScrollOffset(): number {
    return Math.max(0, this.contentLength - this.pageSize);
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

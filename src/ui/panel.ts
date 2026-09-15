import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayHandle, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
        this.panel = new TasksPanel(this.state, theme, "widget");
        return this.panel;
      });
      return;
    }

    ui.setWidget("pi-tasks-panel-host", (tui, theme) => {
      this.tui = tui;
      this.panel = new TasksPanel(this.state, theme, "floating");
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
  constructor(private readonly state: TaskState, private readonly theme: Theme, private readonly placement: "floating" | "widget") {}

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
      content.push(`${workIcon(work.status, this.theme)} ${this.theme.fg("text", work.workName)} ${this.theme.fg("dim", `${completed}/${work.tasks.length}`)}`);
      for (const todo of work.tasks) content.push(`  ${todoIcon(todo.status, this.theme)} ${this.theme.fg(todo.status === "completed" ? "muted" : "text", todo.taskName)}`);
    }
    const maxContentLines = 10;
    const shown = content.slice(0, maxContentLines);
    if (content.length > shown.length) shown[shown.length - 1] = this.theme.fg("dim", `… ${content.length - shown.length + 1} more; use /works`);
    const lines = [
      border(innerWidth, "top", this.theme),
      frame(this.theme.fg("accent", this.theme.bold("Works")), innerWidth, this.theme),
      rule(innerWidth, this.theme),
      ...shown.map((line) => frame(line, innerWidth, this.theme)),
      border(innerWidth, "bottom", this.theme),
    ];
    return lines.map((line) => `${leftPad}${line}`);
  }

  invalidate(): void {}
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

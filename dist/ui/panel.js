import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
const EMPTY_COMPONENT = { render: () => [], invalidate: () => { } };
export class TasksPanelHost {
    state;
    tui;
    panel;
    handle;
    ui;
    mode = "floating";
    constructor(state) {
        this.state = state;
    }
    attach(ui) {
        this.hideCurrent();
        this.ui = ui;
        this.applyMode();
    }
    setMode(mode) {
        this.mode = mode;
        if (this.ui)
            this.applyMode();
    }
    getMode() {
        return this.mode;
    }
    update() {
        this.panel?.invalidate();
        this.tui?.requestRender();
    }
    hide() {
        this.hideCurrent();
        this.ui = undefined;
    }
    applyMode() {
        const ui = this.ui;
        if (!ui)
            return;
        this.hideCurrent();
        this.ui = ui;
        if (this.mode === "off")
            return;
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
            this.panel = new TasksPanel(tui, this.state, theme, "floating");
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
    hideCurrent() {
        this.handle?.hide();
        this.handle = undefined;
        this.ui?.setWidget("pi-tasks-panel", undefined);
        this.ui?.setWidget("pi-tasks-panel-host", undefined);
        this.panel = undefined;
        this.tui = undefined;
    }
}
class TasksPanel {
    tui;
    state;
    theme;
    placement;
    scrollOffset = 0;
    pageSize = 1;
    contentLength = 0;
    followTail = true;
    constructor(tui, state, theme, placement) {
        this.tui = tui;
        this.state = state;
        this.theme = theme;
        this.placement = placement;
    }
    render(width) {
        if (width < 38)
            return [];
        const works = this.state.listWorks();
        const boxWidth = this.placement === "floating" ? width : Math.min(54, Math.max(38, Math.floor(width * 0.44)));
        const innerWidth = boxWidth - 2;
        const leftPad = this.placement === "widget" ? " ".repeat(Math.max(0, width - boxWidth)) : "";
        const content = [];
        if (works.length === 0)
            content.push(this.theme.fg("muted", "No works yet."));
        for (const work of works) {
            const completed = work.tasks.filter((todo) => todo.status === "completed").length;
            content.push(workSummaryLine(work.status, work.workName, `${completed}/${work.tasks.length}`, innerWidth, this.theme));
            for (const todo of work.tasks)
                content.push(`  ${todoIcon(todo.status, this.theme)} ${this.theme.fg(todo.status === "completed" ? "muted" : "text", todo.taskName)}`);
        }
        this.contentLength = content.length;
        const terminalRows = this.tui.terminal.rows || process.stdout.rows || 30;
        this.pageSize = this.placement === "widget" ? Math.max(1, content.length) : Math.max(1, Math.floor(terminalRows * 0.48) - 4);
        if (this.placement === "widget") {
            this.scrollOffset = 0;
            this.followTail = true;
        }
        else if (this.followTail) {
            this.scrollOffset = this.maxScrollOffset();
        }
        else {
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
        const lines = [
            border(innerWidth, "top", this.theme),
            frame(this.theme.fg("accent", this.theme.bold(title)), innerWidth, this.theme),
            rule(innerWidth, this.theme),
            ...shown.map((line) => frame(line, innerWidth, this.theme)),
            border(innerWidth, "bottom", this.theme),
        ];
        return lines.map((line) => `${leftPad}${line}`);
    }
    handleMouse(event) {
        if (this.placement !== "floating" || event.type !== "wheel" || !event.wheelDelta)
            return undefined;
        const changed = this.scrollBy(event.wheelDelta < 0 ? -1 : 1);
        return { handled: true, render: changed };
    }
    invalidate() { }
    scrollBy(lines) {
        return this.scrollTo(this.scrollOffset + lines);
    }
    scrollTo(offset) {
        const previous = this.scrollOffset;
        this.scrollOffset = Math.max(0, Math.min(offset, this.maxScrollOffset()));
        this.followTail = this.scrollOffset >= this.maxScrollOffset();
        return this.scrollOffset !== previous;
    }
    clampScrollOffset() {
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset()));
        if (this.scrollOffset >= this.maxScrollOffset())
            this.followTail = true;
    }
    maxScrollOffset() {
        return Math.max(0, this.contentLength - this.pageSize);
    }
}
function workSummaryLine(status, name, count, width, theme) {
    const left = `${workIcon(status, theme)} ${theme.fg("text", name)}`;
    const right = theme.fg("dim", count);
    const leftWidth = Math.max(0, width - visibleWidth(right) - 1);
    const shownLeft = truncateToWidth(left, leftWidth, "…");
    const gap = " ".repeat(Math.max(1, width - visibleWidth(shownLeft) - visibleWidth(right)));
    return `${shownLeft}${gap}${right}`;
}
export function workIcon(status, theme) {
    if (status === "completed")
        return theme.fg("success", "✓");
    if (status === "active")
        return theme.fg("accent", "▶");
    if (status === "blocked")
        return theme.fg("warning", "!");
    if (status === "cancelled")
        return theme.fg("error", "×");
    return theme.fg("muted", "○");
}
export function todoIcon(status, theme) {
    if (status === "completed")
        return theme.fg("success", "✓");
    if (status === "active")
        return theme.fg("accent", "▶");
    if (status === "blocked")
        return theme.fg("warning", "!");
    if (status === "cancelled")
        return theme.fg("error", "×");
    return theme.fg("muted", "○");
}
export function frame(content, innerWidth, theme) {
    const truncated = truncateToWidth(content, innerWidth, "");
    return `${theme.fg("border", "│")}${truncated}${" ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)))}${theme.fg("border", "│")}`;
}
export function rule(innerWidth, theme) {
    return theme.fg("border", `├${"─".repeat(innerWidth)}┤`);
}
export function border(innerWidth, edge, theme) {
    return theme.fg("border", `${edge === "top" ? "┌" : "└"}${"─".repeat(innerWidth)}${edge === "top" ? "┐" : "┘"}`);
}

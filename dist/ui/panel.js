import { stripVTControlCharacters } from "node:util";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { delegateLink, focusPane } from "../agents/links.js";
import { formatWorksMarkdown } from "../markdown.js";
import { openRepository, openSession } from "../open-repository.js";
import { taskOwner } from "../ownership.js";
import { formatCompletion, taskCompletion, workCompletion } from "../progress.js";
import { safeSingleLine } from "../text.js";
const EMPTY_COMPONENT = { render: () => [], invalidate: () => { } };
const PROGRESS_VALUE_WIDTH = 4;
const PROGRESS_COLUMN_WIDTH = PROGRESS_VALUE_WIDTH + 3;
export class TasksPanelHost {
    state;
    git;
    tui;
    panel;
    handle;
    ui;
    mode = "floating";
    minimized = false;
    cwd = "";
    sessionId = "Session unavailable";
    constructor(state, git) {
        this.state = state;
        this.git = git;
    }
    attach(ui, cwd, sessionId) {
        this.hideCurrent();
        this.cwd = cwd;
        this.sessionId = safeSingleLine(sessionId) || "Session unavailable";
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
    setMinimized(minimized) {
        this.minimized = minimized;
        this.panel?.setMinimized(minimized);
        this.tui?.requestRender();
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
                this.panel = new TasksPanel(tui, this.state, theme, "widget", this.minimized, (minimized) => {
                    this.minimized = minimized;
                }, (message, type) => ui.notify(message, type), this.cwd, this.git, this.sessionId);
                return this.panel;
            });
            return;
        }
        ui.setWidget("pi-tasks-panel-host", (tui, theme) => {
            this.tui = tui;
            this.panel = new TasksPanel(tui, this.state, theme, "floating", this.minimized, (minimized) => {
                this.minimized = minimized;
            }, (message, type) => ui.notify(message, type), this.cwd, this.git, this.sessionId);
            this.handle = tui.showOverlay(this.panel, {
                anchor: "top-right",
                width: "42%",
                minWidth: 38,
                maxHeight: "48%",
                margin: { top: 1, right: 1 },
                nonCapturing: true,
                visible: (terminalWidth, terminalHeight) => {
                    const visible = terminalWidth >= 90 && terminalHeight >= 18;
                    this.panel?.setVisible(visible);
                    return visible;
                },
            });
            return EMPTY_COMPONENT;
        });
    }
    hideCurrent() {
        this.panel?.dispose();
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
    minimized;
    onMinimizedChange;
    notify;
    cwd;
    git;
    sessionId;
    scrollOffset = 0;
    pageSize = 1;
    contentLength = 0;
    followTail = true;
    copying = false;
    opening = false;
    openingDelegate = false;
    delegateHits = [];
    disposed = false;
    unsubscribeGit;
    copyHitRegion;
    openHitRegion;
    sessionHitRegion;
    toggleHitRegion;
    constructor(tui, state, theme, placement, minimized, onMinimizedChange, notify, cwd, git, sessionId) {
        this.tui = tui;
        this.state = state;
        this.theme = theme;
        this.placement = placement;
        this.minimized = minimized;
        this.onMinimizedChange = onMinimizedChange;
        this.notify = notify;
        this.cwd = cwd;
        this.git = git;
        this.sessionId = sessionId;
    }
    render(width) {
        this.delegateHits = [];
        if (this.placement === "widget")
            this.setVisible(width >= 38);
        if (width < 38)
            return [];
        const works = this.state.listWorks();
        const boxWidth = this.placement === "floating" ? width : Math.min(54, Math.max(38, Math.floor(width * 0.44)));
        const innerWidth = boxWidth - 2;
        const leftPad = this.placement === "widget" ? " ".repeat(Math.max(0, width - boxWidth)) : "";
        if (this.minimized) {
            const header = this.renderHeader(innerWidth, leftPad.length);
            return [
                gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
                frame(header, innerWidth, this.theme),
                border(innerWidth, "bottom", this.theme),
            ].map((line) => `${leftPad}${line}`);
        }
        const contentWidth = innerWidth - PROGRESS_COLUMN_WIDTH;
        const content = [];
        const delegateRows = new Map();
        if (works.length === 0)
            content.push(progressColumn(this.theme.fg("muted", "No works yet."), null, innerWidth, this.theme));
        for (const work of works) {
            const completed = work.tasks.filter((todo) => todo.status === "completed").length;
            const summary = workSummaryLine(work.status, work.workName, `${completed}/${work.tasks.length}`, contentWidth, this.theme, work.workId);
            content.push(progressColumn(summary, workCompletion(work), innerWidth, this.theme));
            for (const todo of work.tasks) {
                const agent = delegateLink(todo.taskInfo);
                const lead = `  ${todoIcon(todo.status, this.theme)} ${recordId(todo.taskId, this.theme)} `;
                const label = `${lead}${ownerBadge(todo.taskInfo, this.theme, Boolean(agent))} ${this.theme.fg(todo.status === "completed" ? "muted" : "text", safeSingleLine(todo.taskName))}`;
                delegateRows.set(content.length, { agent, start: visibleWidth(lead) });
                content.push(progressColumn(label, taskCompletion(todo), innerWidth, this.theme));
            }
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
        shown.forEach((line, index) => {
            const row = delegateRows.get(this.scrollOffset + index);
            if (!row)
                return;
            const hit = delegateHitRegion(row.agent, row.start, line, 3 + index, leftPad.length);
            if (hit)
                this.delegateHits.push(hit);
        });
        const hasOverflow = content.length > this.pageSize;
        const range = `${this.scrollOffset + 1}–${this.scrollOffset + shown.length}/${content.length}`;
        const suffix = this.placement === "floating" && hasOverflow
            ? this.tui.mode === "fullscreen" ? ` · ${range}` : ` · ${range} · latest · /works for all`
            : "";
        const header = this.renderHeader(innerWidth, leftPad.length, suffix);
        const lines = [
            gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
            frame(header, innerWidth, this.theme),
            this.theme.fg("border", `├${"─".repeat(contentWidth + 1)}┬${"─".repeat(PROGRESS_VALUE_WIDTH + 1)}┤`),
            ...shown.map((line) => frame(line, innerWidth, this.theme)),
            this.theme.fg("border", `└${"─".repeat(contentWidth + 1)}┴${"─".repeat(PROGRESS_VALUE_WIDTH + 1)}┘`),
        ];
        return lines.map((line) => `${leftPad}${line}`);
    }
    handleMouse(event) {
        if (this.disposed)
            return undefined;
        if (event.type === "press" && event.button === "left") {
            const delegateHit = this.delegateHits.some((region) => event.y === region.y && this.isHit(event.x, region));
            const headerHit = event.y === 1 && [this.copyHitRegion, this.sessionHitRegion, this.openHitRegion, this.toggleHitRegion].some((region) => this.isHit(event.x, region));
            // Own the gesture so Pi does not turn repeated control clicks into text selection.
            if (delegateHit || headerHit)
                return { handled: true };
        }
        // Legacy mouse releases omit the button; Pi still normalizes the gesture as a click.
        const primaryClick = event.type === "click" && (event.button === "left" || event.button === "none");
        if (primaryClick) {
            const hit = this.delegateHits.find((region) => event.y === region.y && this.isHit(event.x, region));
            if (hit) {
                void this.openLinkedDelegate(hit.link);
                return { handled: true, render: true };
            }
        }
        if (primaryClick && event.y === 1) {
            if (this.isHit(event.x, this.toggleHitRegion)) {
                this.setMinimized(!this.minimized);
                return { handled: true, render: true };
            }
            if (this.isHit(event.x, this.copyHitRegion)) {
                void this.copyAllAsMarkdown();
                return { handled: true, render: true };
            }
            if (this.isHit(event.x, this.sessionHitRegion)) {
                void this.openInCursor(true);
                return { handled: true, render: true };
            }
            if (this.isHit(event.x, this.openHitRegion)) {
                void this.openInCursor();
                return { handled: true, render: true };
            }
        }
        if (this.minimized || this.placement !== "floating" || event.type !== "wheel" || !event.wheelDelta)
            return undefined;
        const changed = this.scrollBy(event.wheelDelta < 0 ? -1 : 1);
        return { handled: true, render: changed };
    }
    invalidate() { }
    dispose() {
        if (this.disposed)
            return;
        this.setVisible(false);
        this.disposed = true;
    }
    setVisible(visible) {
        if (this.disposed)
            return;
        if (visible) {
            this.unsubscribeGit ??= this.git.subscribe(() => this.tui.requestRender());
        }
        else {
            this.unsubscribeGit?.();
            this.unsubscribeGit = undefined;
        }
    }
    setMinimized(minimized) {
        if (this.minimized === minimized)
            return;
        this.minimized = minimized;
        this.onMinimizedChange(minimized);
        this.tui.requestRender();
    }
    renderHeader(width, leftPadWidth, suffix = "") {
        const copyAction = this.copying
            ? this.theme.fg("dim", "[Copying…]")
            : this.theme.fg("accent", this.theme.bold("[Copy]"));
        const sessionAction = this.theme.fg(this.opening ? "dim" : "accent", this.theme.underline(this.theme.bold("[Open session]")));
        const openAction = this.theme.fg(this.opening ? "dim" : "accent", this.theme.underline(this.theme.bold("[Open]")));
        const fixedWidth = visibleWidth(copyAction) + visibleWidth(sessionAction) + visibleWidth(openAction) + 3;
        const fullToggle = this.minimized ? "[Maximize]" : "[Minimize]";
        const toggleLabel = fixedWidth + visibleWidth(fullToggle) <= width ? fullToggle : this.minimized ? "[+]" : "[-]";
        const toggleAction = this.theme.fg("accent", this.theme.bold(toggleLabel));
        const actionsWidth = fixedWidth + visibleWidth(toggleAction);
        const titleWidth = Math.max(0, width - actionsWidth - 1);
        const context = truncateToWidth(this.theme.fg("dim", suffix.replace(/^\s*·\s*/, "")), titleWidth, "…");
        const gap = " ".repeat(Math.max(0, width - visibleWidth(context) - actionsWidth));
        const copyStart = leftPadWidth + 1 + visibleWidth(context) + gap.length;
        this.copyHitRegion = { start: copyStart, end: copyStart + visibleWidth(copyAction) };
        const sessionStart = this.copyHitRegion.end + 1;
        this.sessionHitRegion = { start: sessionStart, end: sessionStart + visibleWidth(sessionAction) };
        const openStart = this.sessionHitRegion.end + 1;
        this.openHitRegion = { start: openStart, end: openStart + visibleWidth(openAction) };
        const toggleStart = this.openHitRegion.end + 1;
        this.toggleHitRegion = { start: toggleStart, end: toggleStart + visibleWidth(toggleAction) };
        return `${context}${gap}${copyAction} ${sessionAction} ${openAction} ${toggleAction}`;
    }
    isHit(x, region) {
        return region !== undefined && x >= region.start && x < region.end;
    }
    async openLinkedDelegate(link) {
        if (this.openingDelegate)
            return;
        this.openingDelegate = true;
        try {
            await focusPane(link.paneId, this.cwd);
        }
        catch (error) {
            const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
            if (!this.disposed)
                this.notify(`Could not open delegate. ${reason}`, "error");
        }
        finally {
            this.openingDelegate = false;
        }
    }
    async openInCursor(session = false) {
        if (this.opening)
            return;
        this.opening = true;
        this.tui.requestRender();
        try {
            if (session)
                await openSession(this.cwd, this.sessionId);
            else
                await openRepository(this.cwd);
            if (!this.disposed)
                this.notify(session ? "Opened session artifacts in Cursor." : "Opened repository in Cursor.", "info");
        }
        catch (error) {
            const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
            if (!this.disposed)
                this.notify(session ? `Could not open session artifacts in Cursor.${reason}` : `Could not open Cursor. Check that cursor is installed on PATH.${reason}`, "error");
        }
        finally {
            this.opening = false;
            if (!this.disposed)
                this.tui.requestRender();
        }
    }
    async copyAllAsMarkdown() {
        if (this.copying)
            return;
        this.copying = true;
        this.tui.requestRender();
        const works = this.state.listWorks();
        try {
            await copyToClipboard(formatWorksMarkdown(works));
            const todoCount = works.reduce((total, work) => total + work.tasks.length, 0);
            this.notify(`Copied ${works.length} work${works.length === 1 ? "" : "s"} and ${todoCount} todo${todoCount === 1 ? "" : "s"} as Markdown.`, "info");
        }
        catch (error) {
            const reason = error instanceof Error && error.message ? ` ${safeSingleLine(error.message)}` : "";
            this.notify(`Could not copy works and todos.${reason}`, "error");
        }
        finally {
            this.copying = false;
            this.tui.requestRender();
        }
    }
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
export function recordId(id, theme) {
    return theme.fg(id.startsWith("W") ? "accent" : "syntaxType", `[${safeSingleLine(id)}]`);
}
export function ownerBadge(taskInfo, theme, linked = false) {
    const owner = taskOwner(taskInfo);
    const label = owner === "delegate" && linked ? theme.underline(`[${owner}]`) : `[${owner}]`;
    return theme.fg(owner === "self" ? "success" : owner === "delegate" ? "warning" : "muted", label);
}
export function delegateHitRegion(link, start, line, y, leftPad = 0) {
    if (!link || stripVTControlCharacters(sliceByColumn(line, start, 10)) !== "[delegate]")
        return undefined;
    return { start: leftPad + 1 + start, end: leftPad + 1 + start + 10, y, link };
}
export function progressName(name, completion, width, prefix = "") {
    const suffix = ` · ${formatCompletion(completion)}`;
    return `${truncateToWidth(`${prefix}${safeSingleLine(name)}`, Math.max(0, width - visibleWidth(suffix)), "…")}${suffix}`;
}
function progressColumn(content, completion, width, theme) {
    const contentWidth = width - PROGRESS_COLUMN_WIDTH;
    const left = truncateToWidth(content, contentWidth, "…");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(left)));
    const value = theme.fg(completion === null ? "muted" : "accent", formatCompletion(completion).padStart(PROGRESS_VALUE_WIDTH));
    return `${left}${padding}${theme.fg("border", " │ ")}${value}`;
}
function workSummaryLine(status, name, count, width, theme, workId) {
    const right = theme.fg("dim", count);
    const leftWidth = Math.max(0, width - visibleWidth(right) - 1);
    const left = `${workIcon(status, theme)} ${recordId(workId, theme)} ${theme.fg("text", safeSingleLine(name))}`;
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
export function gitBorder(innerWidth, theme, snapshot) {
    if (snapshot.kind === "not-repository" || innerWidth < 6)
        return border(innerWidth, "top", theme);
    let label;
    if (snapshot.kind === "ready") {
        const clean = snapshot.staged === 0 && snapshot.unstaged === 0 && snapshot.untracked === 0;
        let suffix = clean ? " · clean" : ` · S${snapshot.staged} U${snapshot.unstaged} ?${snapshot.untracked}`;
        if (!clean && visibleWidth(suffix) > innerWidth - 13) {
            const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 });
            suffix = ` · S${compact.format(snapshot.staged)} U${compact.format(snapshot.unstaged)} ?${compact.format(snapshot.untracked)}`;
        }
        const branchWidth = Math.max(0, innerWidth - visibleWidth(`git ${suffix}`) - 4);
        label = `git ${truncateToWidth(safeSingleLine(snapshot.branch), branchWidth, "…")}${suffix}`;
    }
    else {
        label = snapshot.kind === "loading" ? "git loading…" : "git unavailable";
    }
    // Truncation may insert ANSI resets; color the complete plain label afterward.
    label = stripVTControlCharacters(truncateToWidth(label, innerWidth - 4, "…"));
    const slack = innerWidth - visibleWidth(label) - 2;
    const left = Math.floor(slack / 2);
    return theme.fg("border", `┌${"─".repeat(left)} ${label} ${"─".repeat(slack - left)}┐`);
}
export function border(innerWidth, edge, theme) {
    return theme.fg("border", `${edge === "top" ? "┌" : "└"}${"─".repeat(innerWidth)}${edge === "top" ? "┐" : "┘"}`);
}

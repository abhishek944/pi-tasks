import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, } from "@earendil-works/pi-tui";
import { delegateLink, focusPane } from "../agents/links.js";
import { formatWorksMarkdown } from "../markdown.js";
import { openRepository } from "../open-repository.js";
import { formatCompletion, taskCompletion, workCompletion } from "../progress.js";
import { safeMultiline, safeSingleLine } from "../text.js";
import { border, delegateHitRegion, frame, gitBorder, ownerBadge, progressName, recordId, rule, todoIcon, workIcon } from "./panel.js";
const CHROME_LINES = 8;
export class WorksDashboard {
    tui;
    theme;
    keybindings;
    state;
    close;
    cwd;
    git;
    notify;
    focused = false;
    selectedKey;
    scrollOffset = 0;
    detailOffset = 0;
    detailPageSize = 1;
    detailsVisible = true;
    message = "Ready. Select an item; Escape closes.";
    messageColor = "warning";
    copying = false;
    opening = false;
    openingDelegate = false;
    delegateHits = [];
    minimized = false;
    unsubscribeGit;
    openHitRegion;
    copyHitRegion;
    toggleHitRegion;
    disposed = false;
    refreshTimer;
    constructor(tui, theme, keybindings, state, close, cwd, git, notify) {
        this.tui = tui;
        this.theme = theme;
        this.keybindings = keybindings;
        this.state = state;
        this.close = close;
        this.cwd = cwd;
        this.git = git;
        this.notify = notify;
        this.unsubscribeGit = git.subscribe(() => tui.requestRender());
        this.refreshTimer = setInterval(() => {
            if (!this.disposed)
                this.tui.requestRender();
        }, 1_000);
        this.refreshTimer.unref?.();
    }
    render(width) {
        this.delegateHits = [];
        const dialogWidth = Math.max(1, width);
        const innerWidth = Math.max(1, dialogWidth - 2);
        const works = this.state.listWorks();
        const todos = works.flatMap((work) => work.tasks);
        const header = this.renderHeader(innerWidth, works.length, todos.length);
        if (this.minimized) {
            return [
                gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
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
        if (listHeight > 0)
            this.keepSelectionVisible(items, listHeight);
        const rows = items.slice(this.scrollOffset, this.scrollOffset + listHeight).map((item, index) => this.renderRow(item, innerWidth, 4 + index));
        while (rows.length < listHeight)
            rows.push("");
        const selected = items.find((item) => item.key === this.selectedKey);
        if (selected?.kind === "todo" && details[1] !== undefined) {
            const start = visibleWidth(`${recordId(selected.todo.taskId, this.theme)} `);
            const hit = delegateHitRegion(delegateLink(selected.todo.taskInfo), start, details[1], 5 + listHeight);
            if (hit)
                this.delegateHits.push(hit);
        }
        return [
            gitBorder(innerWidth, this.theme, this.git.getSnapshot()),
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
    handleInput(data) {
        if (this.disposed)
            return;
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
        if (matchesKey(data, "o")) {
            void this.openInCursor();
            return;
        }
        if (matchesKey(data, "m")) {
            this.toggleMinimized();
            return;
        }
        if (this.minimized)
            return;
        if (matchesKey(data, "d")) {
            const selected = items.find((item) => item.key === this.selectedKey);
            const link = selected?.kind === "todo" ? delegateLink(selected.todo.taskInfo) : undefined;
            if (link)
                void this.openLinkedDelegate(link);
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
        }
        else if (this.keybindings.matches(data, "tui.select.down")) {
            this.select(items, index + 1);
        }
        else if (this.keybindings.matches(data, "tui.select.pageUp")) {
            this.detailOffset = Math.max(0, this.detailOffset - this.detailPageSize);
            this.message = "Moved detail view up.";
        }
        else if (this.keybindings.matches(data, "tui.select.pageDown")) {
            this.detailOffset += this.detailPageSize;
            this.message = "Moved detail view down.";
        }
        else if (this.keybindings.matches(data, "tui.select.confirm")) {
            this.detailsVisible = !this.detailsVisible;
            this.detailOffset = 0;
            this.message = this.detailsVisible ? "Details shown." : "Details hidden.";
        }
        this.tui.requestRender();
    }
    handleMouse(event) {
        if (this.disposed)
            return undefined;
        if (event.type === "press" && event.button === "left") {
            const delegateHit = this.delegateHits.some((region) => event.y === region.y && this.isHit(event.x, region));
            const headerHit = event.y === 1 && [this.copyHitRegion, this.openHitRegion, this.toggleHitRegion].some((region) => this.isHit(event.x, region));
            // Own the gesture so Pi does not turn repeated control clicks into text selection.
            if (delegateHit || headerHit)
                return { handled: true };
        }
        // Legacy mouse releases omit the button; Pi still normalizes the gesture as a click.
        if (event.type !== "click" || (event.button !== "left" && event.button !== "none"))
            return undefined;
        const hit = this.delegateHits.find((region) => event.y === region.y && this.isHit(event.x, region));
        if (hit) {
            void this.openLinkedDelegate(hit.link);
            return { handled: true, focus: true, render: true };
        }
        if (event.y !== 1)
            return undefined;
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
    invalidate() { }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.unsubscribeGit();
        clearInterval(this.refreshTimer);
    }
    items(works = this.state.listWorks()) {
        const items = [];
        for (const work of works) {
            items.push({ key: `work:${work.workId}`, kind: "work", work });
            for (const todo of work.tasks)
                items.push({ key: `todo:${todo.taskId}`, kind: "todo", todo, work });
        }
        return items;
    }
    syncSelection(items) {
        if (items.some((item) => item.key === this.selectedKey))
            return;
        this.selectedKey = items[0]?.key;
        this.scrollOffset = 0;
    }
    select(items, index) {
        if (items.length === 0)
            return;
        this.selectedKey = items[Math.max(0, Math.min(index, items.length - 1))]?.key;
        this.detailOffset = 0;
    }
    keepSelectionVisible(items, height) {
        const index = Math.max(0, items.findIndex((item) => item.key === this.selectedKey));
        if (index < this.scrollOffset)
            this.scrollOffset = index;
        if (index >= this.scrollOffset + height)
            this.scrollOffset = index - height + 1;
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, items.length - height)));
    }
    renderRow(item, width, y) {
        const selected = item.key === this.selectedKey;
        const prefix = selected ? this.theme.fg("accent", "▶ ") : "  ";
        if (item.kind === "work") {
            const done = item.work.tasks.filter((todo) => todo.status === "completed").length;
            const metadata = this.theme.fg("dim", `${item.work.status} · ${done}/${item.work.tasks.length}`);
            const nameWidth = width - visibleWidth(prefix) - 3 - visibleWidth(metadata);
            return truncateToWidth(`${prefix}${workIcon(item.work.status, this.theme)} ${this.theme.bold(progressName(item.work.workName, workCompletion(item.work), nameWidth, `${recordId(item.work.workId, this.theme)} `))} ${metadata}`, width, "");
        }
        const metadata = this.theme.fg("dim", item.todo.status);
        const nameWidth = width - visibleWidth(prefix) - 5 - visibleWidth(metadata);
        const line = truncateToWidth(`${prefix}  ${todoIcon(item.todo.status, this.theme)} ${progressName(item.todo.taskName, taskCompletion(item.todo), nameWidth, `${recordId(item.todo.taskId, this.theme)} ${ownerBadge(item.todo.taskInfo, this.theme, Boolean(delegateLink(item.todo.taskInfo)))} `)} ${metadata}`, width, "");
        const start = visibleWidth(`${prefix}  ${todoIcon(item.todo.status, this.theme)} ${recordId(item.todo.taskId, this.theme)} `);
        const hit = delegateHitRegion(delegateLink(item.todo.taskInfo), start, line, y);
        if (hit)
            this.delegateHits.push(hit);
        return line;
    }
    renderDetails(items, width, budget) {
        if (!this.detailsVisible || budget === 0)
            return [];
        const item = items.find((candidate) => candidate.key === this.selectedKey);
        if (!item)
            return [this.theme.fg("muted", "No works or todos in this session.")].slice(0, budget);
        let heading;
        if (item.kind === "work") {
            const lead = `${recordId(item.work.workId, this.theme)} `;
            const tail = ` · ${item.work.status}`;
            heading = `${lead}${progressName(item.work.workName, workCompletion(item.work), width - visibleWidth(lead + tail))}${tail}`;
        }
        else {
            const taskName = safeSingleLine(item.todo.taskName);
            const taskLead = `${recordId(item.todo.taskId, this.theme)} ${ownerBadge(item.todo.taskInfo, this.theme, Boolean(delegateLink(item.todo.taskInfo)))} `;
            const workName = safeSingleLine(item.work.workName);
            const taskProgress = formatCompletion(taskCompletion(item.todo));
            const workProgress = formatCompletion(workCompletion(item.work));
            const workId = recordId(item.todo.workId, this.theme);
            const fixed = `${taskLead} · ${taskProgress} · ${item.todo.status} · ${workId}  · ${workProgress}`;
            const available = Math.max(0, width - visibleWidth(fixed));
            const taskWidth = Math.min(visibleWidth(taskName), available - Math.min(visibleWidth(workName), Math.floor(available / 2)));
            const shownTask = truncateToWidth(taskName, taskWidth, "…");
            const shownWork = truncateToWidth(workName, available - taskWidth, "…");
            heading = `${taskLead}${shownTask} · ${taskProgress} · ${item.todo.status} · ${workId} ${shownWork} · ${workProgress}`;
        }
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
    renderHeader(width, workCount, todoCount) {
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
    toggleMinimized() {
        this.minimized = !this.minimized;
        if (!this.minimized) {
            this.message = "Dashboard maximized.";
            this.messageColor = "warning";
        }
        this.tui.requestRender();
    }
    isHit(x, region) {
        return region !== undefined && x >= region.start && x < region.end;
    }
    async openLinkedDelegate(link) {
        if (this.openingDelegate)
            return;
        this.openingDelegate = true;
        this.message = "Opening delegated agent in Herdr…";
        this.messageColor = "warning";
        this.tui.requestRender();
        try {
            await focusPane(link.paneId, this.cwd);
            this.message = "Opened delegated agent in Herdr.";
            this.messageColor = "success";
        }
        catch (error) {
            const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
            this.message = `Could not open delegate. ${reason}`;
            this.messageColor = "error";
            if (!this.disposed)
                this.notify(this.message, "error");
        }
        finally {
            this.openingDelegate = false;
            if (!this.disposed)
                this.tui.requestRender();
        }
    }
    async openInCursor() {
        if (this.opening)
            return;
        this.opening = true;
        this.message = "Opening repository in Cursor…";
        this.messageColor = "warning";
        this.tui.requestRender();
        try {
            await openRepository(this.cwd);
            this.message = "Opened repository in Cursor.";
            this.messageColor = "success";
        }
        catch (error) {
            const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
            this.message = `Could not open Cursor. Check cursor is on PATH.${reason}`;
            this.messageColor = "error";
            if (!this.disposed)
                this.notify(this.message, "error");
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
        this.message = "Copying all works and todos as Markdown…";
        this.messageColor = "warning";
        this.tui.requestRender();
        const works = this.state.listWorks();
        try {
            await copyToClipboard(formatWorksMarkdown(works));
            const todoCount = works.reduce((total, work) => total + work.tasks.length, 0);
            this.message = `Copied ${works.length} work${works.length === 1 ? "" : "s"} and ${todoCount} todo${todoCount === 1 ? "" : "s"} as Markdown.`;
            this.messageColor = "success";
        }
        catch (error) {
            const reason = error instanceof Error && error.message ? ` ${safeSingleLine(error.message)}` : "";
            this.message = `Could not copy works and todos.${reason}`;
            this.messageColor = "error";
        }
        finally {
            this.copying = false;
            if (!this.disposed)
                this.tui.requestRender();
        }
    }
    renderFooter(width) {
        const text = "C copy all · O open Cursor · D open delegate · M minimize · configured ↑/↓ select · PgUp/PgDn scroll details · confirm toggles · cancel closes";
        return truncateToWidth(this.theme.fg("muted", text), width, "");
    }
}

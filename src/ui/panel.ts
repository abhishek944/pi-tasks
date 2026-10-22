import { stripVTControlCharacters } from "node:util";
import { copyToClipboard, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayHandle, sliceByColumn, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type DelegateLink, delegateLink, focusPane } from "../agents/links.js";
import type { GitSnapshot, GitStatusCache } from "../git-status.js";
import { formatWorksMarkdown } from "../markdown.js";
import { openRepository, openSession } from "../open-repository.js";
import { taskOwner } from "../ownership.js";
import { formatCompletion, taskCompletion, workCompletion } from "../progress.js";
import type { TaskState } from "../state.js";
import { safeSingleLine } from "../text.js";
import type { TodoStatus } from "../types.js";

export type TasksPanelMode = "floating" | "widget" | "off";
type HeaderHitRegion = { start: number; end: number };
type Notify = (message: string, type?: "info" | "warning" | "error") => void;
const EMPTY_COMPONENT: Component = { render: () => [], invalidate: () => {} };
const PROGRESS_VALUE_WIDTH = 4;
const PROGRESS_COLUMN_WIDTH = PROGRESS_VALUE_WIDTH + 3;

export class TasksPanelHost {
  private tui: TUI | undefined;
  private panel: TasksPanel | undefined;
  private handle: OverlayHandle | undefined;
  private ui: ExtensionUIContext | undefined;
  private mode: TasksPanelMode = "floating";
  private minimized = false;
  private cwd = "";
  private sessionId = "Session unavailable";

  constructor(private readonly state: TaskState, private readonly git: GitStatusCache) {}

  attach(ui: ExtensionUIContext, cwd: string, sessionId: string): void {
    this.hideCurrent();
    this.cwd = cwd;
    this.sessionId = safeSingleLine(sessionId) || "Session unavailable";
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
          this.cwd,
          this.git,
          this.sessionId,
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
        this.cwd,
        this.git,
        this.sessionId,
      );
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

  private hideCurrent(): void {
    this.panel?.dispose();
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
  private opening = false;
  private openingDelegate = false;
  private delegateHits: DelegateHitRegion[] = [];
  private disposed = false;
  private unsubscribeGit: (() => void) | undefined;
  private copyHitRegion: HeaderHitRegion | undefined;
  private openHitRegion: HeaderHitRegion | undefined;
  private sessionHitRegion: HeaderHitRegion | undefined;
  private toggleHitRegion: HeaderHitRegion | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly state: TaskState,
    private readonly theme: Theme,
    private readonly placement: "floating" | "widget",
    private minimized: boolean,
    private readonly onMinimizedChange: (minimized: boolean) => void,
    private readonly notify: Notify,
    private readonly cwd: string,
    private readonly git: GitStatusCache,
    private readonly sessionId: string,
  ) {}

  render(width: number): string[] {
    this.delegateHits = [];
    if (this.placement === "widget") this.setVisible(width >= 38);
    if (width < 38) return [];
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
    const content: string[] = [];
    const delegateRows = new Map<number, { agent: DelegateLink | undefined; start: number }>();
    if (works.length === 0) content.push(progressColumn(this.theme.fg("muted", "No works yet."), null, innerWidth, this.theme));
    for (const work of works) {
      const completed = work.tasks.filter((todo) => todo.status === "completed").length;
      const summary = workSummaryLine(work.workName, `${completed}/${work.tasks.length}`, contentWidth, this.theme, work.workId);
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
    } else if (this.followTail) {
      this.scrollOffset = this.maxScrollOffset();
    } else {
      this.clampScrollOffset();
    }
    const shown = content.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
    shown.forEach((line, index) => {
      const row = delegateRows.get(this.scrollOffset + index);
      if (!row) return;
      const hit = delegateHitRegion(row.agent, row.start, line, 3 + index, leftPad.length);
      if (hit) this.delegateHits.push(hit);
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

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.disposed) return undefined;
    if (event.type === "press" && event.button === "left") {
      const delegateHit = this.delegateHits.some((region) => event.y === region.y && this.isHit(event.x, region));
      const headerHit = event.y === 1 && [this.copyHitRegion, this.sessionHitRegion, this.openHitRegion, this.toggleHitRegion].some((region) => this.isHit(event.x, region));
      // Own the gesture so Pi does not turn repeated control clicks into text selection.
      if (delegateHit || headerHit) return { handled: true };
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
    if (this.minimized || this.placement !== "floating" || event.type !== "wheel" || !event.wheelDelta) return undefined;
    const changed = this.scrollBy(event.wheelDelta < 0 ? -1 : 1);
    return { handled: true, render: changed };
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.setVisible(false);
    this.disposed = true;
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    if (visible) {
      this.unsubscribeGit ??= this.git.subscribe(() => this.tui.requestRender());
    } else {
      this.unsubscribeGit?.();
      this.unsubscribeGit = undefined;
    }
  }

  setMinimized(minimized: boolean): void {
    if (this.minimized === minimized) return;
    this.minimized = minimized;
    this.onMinimizedChange(minimized);
    this.tui.requestRender();
  }

  private renderHeader(width: number, leftPadWidth: number, suffix = ""): string {
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

  private isHit(x: number, region: HeaderHitRegion | undefined): boolean {
    return region !== undefined && x >= region.start && x < region.end;
  }

  private async openLinkedDelegate(link: DelegateLink): Promise<void> {
    if (this.openingDelegate) return;
    this.openingDelegate = true;
    try {
      await focusPane(link.paneId, this.cwd);
    } catch (error) {
      const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
      if (!this.disposed) this.notify(`Could not open delegate. ${reason}`, "error");
    } finally {
      this.openingDelegate = false;
    }
  }

  private async openInCursor(session = false): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    this.tui.requestRender();
    try {
      if (session) await openSession(this.cwd, this.sessionId);
      else await openRepository(this.cwd);
      if (!this.disposed) this.notify(session ? "Opened session artifacts in Cursor." : "Opened repository in Cursor.", "info");
    } catch (error) {
      const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
      if (!this.disposed) this.notify(session ? `Could not open session artifacts in Cursor.${reason}` : `Could not open Cursor. Check that cursor is installed on PATH.${reason}`, "error");
    } finally {
      this.opening = false;
      if (!this.disposed) this.tui.requestRender();
    }
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

export function recordId(id: string, theme: Theme): string {
  return theme.fg(id.startsWith("W") ? "accent" : "syntaxType", `[${safeSingleLine(id)}]`);
}

export function ownerBadge(taskInfo: string, theme: Theme, linked = false): string {
  const owner = taskOwner(taskInfo);
  const label = owner === "delegate" && linked ? theme.underline(`[${owner}]`) : `[${owner}]`;
  return theme.fg(owner === "self" ? "success" : owner === "delegate" ? "warning" : "muted", label);
}

export type DelegateHitRegion = { start: number; end: number; y: number; link: DelegateLink };

export function delegateHitRegion(link: DelegateLink | undefined, start: number, line: string, y: number, leftPad = 0): DelegateHitRegion | undefined {
  if (!link || stripVTControlCharacters(sliceByColumn(line, start, 10)) !== "[delegate]") return undefined;
  return { start: leftPad + 1 + start, end: leftPad + 1 + start + 10, y, link };
}

export function progressName(name: string, completion: number | null, width: number, prefix = ""): string {
  const suffix = ` · ${formatCompletion(completion)}`;
  return `${truncateToWidth(`${prefix}${safeSingleLine(name)}`, Math.max(0, width - visibleWidth(suffix)), "…")}${suffix}`;
}

function progressColumn(content: string, completion: number | null, width: number, theme: Theme): string {
  const contentWidth = width - PROGRESS_COLUMN_WIDTH;
  const left = truncateToWidth(content, contentWidth, "…");
  const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(left)));
  const value = theme.fg(completion === null ? "muted" : "accent", formatCompletion(completion).padStart(PROGRESS_VALUE_WIDTH));
  return `${left}${padding}${theme.fg("border", " │ ")}${value}`;
}

function workSummaryLine(name: string, count: string, width: number, theme: Theme, workId: string): string {
  const right = theme.fg("dim", count);
  const leftWidth = Math.max(0, width - visibleWidth(right) - 1);
  const left = `${recordId(workId, theme)} ${theme.fg("text", safeSingleLine(name))}`;
  const shownLeft = truncateToWidth(left, leftWidth, "…");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(shownLeft) - visibleWidth(right)));
  return `${shownLeft}${gap}${right}`;
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

export function gitBorder(innerWidth: number, theme: Theme, snapshot: GitSnapshot): string {
  if (snapshot.kind === "not-repository" || innerWidth < 6) return border(innerWidth, "top", theme);
  let label: string;
  if (snapshot.kind === "ready") {
    const clean = snapshot.staged === 0 && snapshot.unstaged === 0 && snapshot.untracked === 0;
    let suffix = clean ? " · clean" : ` · S${snapshot.staged} U${snapshot.unstaged} ?${snapshot.untracked}`;
    if (!clean && visibleWidth(suffix) > innerWidth - 13) {
      const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 });
      suffix = ` · S${compact.format(snapshot.staged)} U${compact.format(snapshot.unstaged)} ?${compact.format(snapshot.untracked)}`;
    }
    const branchWidth = Math.max(0, innerWidth - visibleWidth(`git ${suffix}`) - 4);
    label = `git ${truncateToWidth(safeSingleLine(snapshot.branch), branchWidth, "…")}${suffix}`;
  } else {
    label = snapshot.kind === "loading" ? "git loading…" : "git unavailable";
  }
  // Truncation may insert ANSI resets; color the complete plain label afterward.
  label = stripVTControlCharacters(truncateToWidth(label, innerWidth - 4, "…"));
  const slack = innerWidth - visibleWidth(label) - 2;
  const left = Math.floor(slack / 2);
  return theme.fg("border", `┌${"─".repeat(left)} ${label} ${"─".repeat(slack - left)}┐`);
}

export function border(innerWidth: number, edge: "top" | "bottom", theme: Theme): string {
  return theme.fg("border", `${edge === "top" ? "┌" : "└"}${"─".repeat(innerWidth)}${edge === "top" ? "┐" : "┘"}`);
}

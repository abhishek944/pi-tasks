/** Session-scoped work and todo tracking for Pi. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { delegateLink, focusPane } from "./agents/links.js";
import { registerAgentTools } from "./agents/tools.js";
import { registerTaskAutoContinue } from "./auto-continue.js";
import { registerWorksCommand } from "./command.js";
import { GitStatusCache } from "./git-status.js";
import { openRepository, openSession } from "./open-repository.js";
import { TaskState } from "./state.js";
import { safeSingleLine } from "./text.js";
import { registerTaskTools } from "./tools.js";
import { registerTrackingGuidance } from "./tracking.js";
import { TasksPanelHost } from "./ui/panel.js";

export default function tasksExtension(pi: ExtensionAPI): void {
  let panel: TasksPanelHost | undefined;
  const state = new TaskState(pi, () => panel?.update());
  const git = new GitStatusCache();
  panel = new TasksPanelHost(state, git);

  registerTaskTools(pi, state);
  registerAgentTools(pi, state);
  registerTrackingGuidance(pi);
  registerTaskAutoContinue(pi, state);
  registerWorksCommand(pi, state, git);
  pi.registerCommand("works-panel", {
    description: "Set the works panel display mode",
    handler: async (args, ctx) => {
      const requested = args.trim();
      const delegateTask = /^delegate\s+(T\d+)$/.exec(requested)?.[1];
      if (delegateTask) {
        const todo = state.getTodo(delegateTask);
        const link = todo ? delegateLink(todo.taskInfo) : undefined;
        if (!link) {
          ctx.ui.notify("This task has no Herdr delegate link, or Pi is not running inside Herdr.", "warning");
          return;
        }
        try {
          await focusPane(link.paneId, ctx.cwd);
          ctx.ui.notify("Opened delegated agent in Herdr.", "info");
        } catch (error) {
          const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
          ctx.ui.notify(`Could not open delegate. ${reason}`, "error");
        }
        return;
      }
      if (requested === "open" || requested === "open-session") {
        try {
          if (requested === "open-session") await openSession(ctx.cwd, ctx.sessionManager.getSessionId());
          else await openRepository(ctx.cwd);
          ctx.ui.notify(requested === "open-session" ? "Opened session artifacts in Cursor." : "Opened repository in Cursor.", "info");
        } catch (error) {
          const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
          ctx.ui.notify(`Could not open Cursor. Check cursor is on PATH.${reason}`, "error");
        }
        return;
      }
      if (requested === "minimize" || requested === "maximize") {
        panel?.setMinimized(requested === "minimize");
        ctx.ui.notify(`Works panel: ${requested}d`, "info");
        return;
      }
      const mode = requested === "floating" || requested === "widget" || requested === "off" ? requested : undefined;
      if (!mode) {
        ctx.ui.notify("Usage: /works-panel floating|widget|off|minimize|maximize|open|open-session or /works-panel delegate T<number>", "info");
        return;
      }
      panel?.setMode(mode);
      ctx.ui.notify(`Works panel: ${mode}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    state.restore(ctx);
    git.setCwd(ctx.cwd);
    if (ctx.mode === "tui") panel?.attach(ctx.ui, ctx.cwd, ctx.sessionManager.getSessionId());
  });

  pi.on("session_tree", (_event, ctx) => {
    state.restore(ctx);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "bash") git.invalidate();
  });

  pi.on("session_shutdown", () => {
    panel?.hide();
    git.dispose();
  });
}

export type { Todo, TodoStatus, Work, WorkStatus, WorkWithTodos } from "./types.js";

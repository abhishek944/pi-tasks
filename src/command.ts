import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "./state.js";
import { runWorksOverlay } from "./ui/overlay.js";
import { WorksDashboard } from "./ui/works-dashboard.js";

export function registerWorksCommand(pi: ExtensionAPI, state: TaskState): void {
  let closeActiveDashboard: (() => void) | undefined;

  pi.on("session_shutdown", () => {
    closeActiveDashboard?.();
    closeActiveDashboard = undefined;
  });

  pi.registerCommand("works", {
    description: "Open the session works and todos dashboard",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/works requires interactive TUI mode", "error");
        return;
      }
      let commandClose: (() => void) | undefined;
      try {
        closeActiveDashboard?.();
        await runWorksOverlay(ctx, (tui, theme, keybindings, close) => {
          const closeCurrent = () => {
            if (closeActiveDashboard === closeCurrent) closeActiveDashboard = undefined;
            close();
          };
          commandClose = closeCurrent;
          closeActiveDashboard = closeCurrent;
          return new WorksDashboard(tui, theme, keybindings, state, closeCurrent);
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "The works dashboard could not be opened.", "error");
      } finally {
        if (closeActiveDashboard === commandClose) closeActiveDashboard = undefined;
      }
    },
  });
}

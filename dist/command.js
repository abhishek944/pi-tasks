import { runWorksOverlay } from "./ui/overlay.js";
import { WorksDashboard } from "./ui/works-dashboard.js";
export function registerWorksCommand(pi, state) {
    let closeActiveDashboard;
    pi.on("session_shutdown", () => {
        closeActiveDashboard?.();
        closeActiveDashboard = undefined;
    });
    pi.registerCommand("works", {
        description: "Open the session works and todos dashboard",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("/works requires interactive TUI mode", "error");
                return;
            }
            let commandClose;
            try {
                closeActiveDashboard?.();
                await runWorksOverlay(ctx, (tui, theme, keybindings, close) => {
                    const closeCurrent = () => {
                        if (closeActiveDashboard === closeCurrent)
                            closeActiveDashboard = undefined;
                        close();
                    };
                    commandClose = closeCurrent;
                    closeActiveDashboard = closeCurrent;
                    return new WorksDashboard(tui, theme, keybindings, state, closeCurrent);
                });
            }
            catch (error) {
                ctx.ui.notify(error instanceof Error ? error.message : "The works dashboard could not be opened.", "error");
            }
            finally {
                if (closeActiveDashboard === commandClose)
                    closeActiveDashboard = undefined;
            }
        },
    });
}

import { registerWorksCommand } from "./command.js";
import { TaskState } from "./state.js";
import { registerTaskTools } from "./tools.js";
import { registerTrackingGuidance } from "./tracking.js";
import { TasksPanelHost } from "./ui/panel.js";
export default function tasksExtension(pi) {
    let panel;
    const state = new TaskState(pi, () => panel?.update());
    panel = new TasksPanelHost(state);
    registerTaskTools(pi, state);
    registerTrackingGuidance(pi);
    registerWorksCommand(pi, state);
    pi.registerCommand("works-panel", {
        description: "Set the works panel display mode",
        handler: async (args, ctx) => {
            const requested = args.trim();
            if (requested === "minimize" || requested === "maximize") {
                panel?.setMinimized(requested === "minimize");
                ctx.ui.notify(`Works panel: ${requested}d`, "info");
                return;
            }
            const mode = requested === "floating" || requested === "widget" || requested === "off" ? requested : undefined;
            if (!mode) {
                ctx.ui.notify("Usage: /works-panel floating|widget|off|minimize|maximize", "info");
                return;
            }
            panel?.setMode(mode);
            ctx.ui.notify(`Works panel: ${mode}`, "info");
        },
    });
    pi.on("session_start", (_event, ctx) => {
        state.restore(ctx);
        if (ctx.mode === "tui")
            panel?.attach(ctx.ui);
    });
    pi.on("session_tree", (_event, ctx) => {
        state.restore(ctx);
    });
    pi.on("session_shutdown", () => {
        panel?.hide();
    });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "./state.js";
import { areTrackingToolsActive } from "./tracking.js";

/** Runtime activity gates timing; task status never implies execution. */
export function registerTaskTiming(pi: ExtensionAPI, state: TaskState): void {
  let running = false;
  let prompts = 0;
  let detachAbort: (() => void) | undefined;
  const sync = () => state.setAgentRunning(running && prompts === 0 && areTrackingToolsActive(pi));
  const pause = () => {
    running = false;
    detachAbort?.();
    detachAbort = undefined;
    sync();
  };
  const reset = () => {
    pause();
    prompts = 0;
    state.clearWorking();
  };

  // A fresh prompt must explicitly select its task instead of inheriting focus.
  pi.on("before_agent_start", () => { reset(); });
  pi.on("agent_start", (_event, ctx) => {
    running = true;
    const signal = ctx.signal;
    if (signal?.aborted) { reset(); return; }
    if (signal) {
      signal.addEventListener("abort", reset, { once: true });
      detachAbort = () => signal.removeEventListener("abort", reset);
    }
    sync();
  });
  // Close every loop interval, including older hosts without agent_settled.
  // Native automatic continuation may resume the focus on its next agent_start.
  pi.on("agent_end", pause);
  pi.on("agent_settled", reset);
  pi.on("ui_prompt_start", () => { prompts += 1; sync(); });
  pi.on("ui_prompt_end", () => { prompts = Math.max(0, prompts - 1); sync(); });
  pi.on("session_before_switch", reset);
  pi.on("session_before_fork", reset);
  pi.on("session_before_tree", reset);
  pi.on("session_shutdown", reset);
  // restore() discards runtime state; these only reset the lifecycle gate.
  pi.on("session_start", reset);
  pi.on("session_tree", reset);
}

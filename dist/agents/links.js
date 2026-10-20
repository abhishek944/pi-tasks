import { taskOwner } from "../ownership.js";
import { herdr, object, PANE_ID } from "./herdr.js";
export function delegateLink(taskInfo) {
    if (process.env.HERDR_ENV !== "1" || taskOwner(taskInfo) !== "delegate")
        return undefined;
    const panes = [...taskInfo.matchAll(/^[ \t]*herdr-pane:[ \t]*([^\r\n]*)$/gim)].map((match) => match[1].trim());
    if (panes.length === 0 || panes.some((pane) => !PANE_ID.test(pane)) || new Set(panes).size !== 1)
        return undefined;
    return { paneId: panes[0] };
}
export async function focusPane(paneId, cwd, signal) {
    if (!PANE_ID.test(paneId))
        throw new Error("Use the paneId returned by Herdr.");
    const focused = await herdr(["agent", "focus", paneId], cwd, signal);
    const tabId = object(focused.agent)?.tab_id;
    if (typeof tabId !== "string" || !tabId)
        throw new Error("Herdr returned no tab for the delegate.");
    // Pane focus alone can leave the visible client on its previous tab.
    await herdr(["tab", "focus", tabId], cwd, signal);
}
export function preservePaneLink(current, next) {
    if (taskOwner(current) !== "delegate" || taskOwner(next) !== "delegate" || /^[ \t]*herdr-(?:pane|monitor):/im.test(next))
        return next;
    const metadata = current.split(/\r?\n/).filter((line) => /^[ \t]*herdr-(?:pane|monitor):/i.test(line));
    return metadata.length ? `${next.trim()}\n${metadata.join("\n")}` : next;
}
export function withPaneLink(taskInfo, paneId, monitorId) {
    const text = taskInfo.split(/\r?\n/).filter((line) => !/^[ \t]*herdr-(?:pane|monitor):/i.test(line)).join("\n").trim();
    return paneId ? `${text}\nherdr-pane: ${paneId}\nherdr-monitor: ${monitorId}` : text;
}

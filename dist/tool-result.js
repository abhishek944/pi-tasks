import { Text } from "@earendil-works/pi-tui";
import { safeSingleLine } from "./text.js";
export function taskResult(summary, action, data, displaySummary = summary) {
    return { content: [{ type: "text", text: summary }], details: { action, summary, displaySummary, data } };
}
export function renderTaskCall(label) {
    return (args, theme) => {
        const action = label.replace(/(?:Work|Todo)/, "").toLowerCase();
        const id = args.workId ?? args.taskId;
        const name = args.workName ?? args.taskName;
        const suffix = [id, name].filter(Boolean).map((value) => safeSingleLine(String(value))).join(" · ");
        return new Text(`${theme.fg("toolTitle", theme.bold(label))}${suffix ? ` ${theme.fg("muted", suffix)}` : ` ${theme.fg("muted", action)}`}`, 0, 0);
    };
}
export function renderTaskResult(result, options, theme, context) {
    const details = result.details;
    const raw = options.expanded ? details?.summary : details?.displaySummary;
    const text = raw ?? result.content.find((part) => part.type === "text")?.text ?? "";
    return new Text(theme.fg(context.isError ? "error" : "success", safeDisplayText(text)), 0, 0);
}
function safeDisplayText(value) {
    return value.split(/\r?\n/).map(safeSingleLine).join("\n");
}

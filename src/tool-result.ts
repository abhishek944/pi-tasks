import { Text } from "@earendil-works/pi-tui";
import { safeSingleLine } from "./text.js";

export interface TaskToolDetails {
  action: string;
  summary: string;
  displaySummary: string;
  data?: unknown;
}

export function taskResult(summary: string, action: string, data?: unknown, displaySummary = summary): { content: Array<{ type: "text"; text: string }>; details: TaskToolDetails } {
  return { content: [{ type: "text", text: summary }], details: { action, summary, displaySummary, data } };
}

export function renderTaskCall(label: string) {
  return (args: Record<string, unknown>, theme: { fg(name: string, value: string): string; bold(value: string): string }) => {
    const action = label.replace(/(?:Work|Todo)/, "").toLowerCase();
    const id = args.workId ?? args.taskId;
    const name = args.workName ?? args.taskName;
    const suffix = [id, name].filter(Boolean).map((value) => safeSingleLine(String(value))).join(" · ");
    return new Text(`${theme.fg("toolTitle", theme.bold(label))}${suffix ? ` ${theme.fg("muted", suffix)}` : ` ${theme.fg("muted", action)}`}`, 0, 0);
  };
}

export function renderTaskResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean },
  theme: { fg(name: string, value: string): string },
  context: { isError: boolean },
) {
  const details = result.details as TaskToolDetails | undefined;
  const raw = options.expanded ? details?.summary : details?.displaySummary;
  const text = raw ?? result.content.find((part) => part.type === "text")?.text ?? "";
  return new Text(theme.fg(context.isError ? "error" : "success", safeDisplayText(text)), 0, 0);
}

function safeDisplayText(value: string): string {
  return value.split(/\r?\n/).map(safeSingleLine).join("\n");
}

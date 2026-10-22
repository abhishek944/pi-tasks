import { formatCompletion, taskCompletion, workCompletion } from "./progress.js";
import { safeMultiline, safeSingleLine } from "./text.js";
import { formatTime, taskTime, workTime } from "./time.js";
export function formatWorksMarkdown(works) {
    const lines = ["# Works and Todos", ""];
    if (works.length === 0)
        return `${lines.join("\n")}\n_No works or todos in this session._\n`;
    for (const work of works) {
        lines.push(`## ${work.workId} — ${escapeMarkdownInline(safeSingleLine(work.workName))}`, "", `**Completion:** ${formatCompletion(workCompletion(work))}`, `**Time (task effort):** ${formatTime(workTime(work))}`, "", "### Details", "", markdownBody(work.workInfo), "", "### Todos", "");
        if (work.tasks.length === 0) {
            lines.push("_No todos._", "");
            continue;
        }
        for (const todo of work.tasks) {
            lines.push(`#### ${todo.taskId} — ${escapeMarkdownInline(safeSingleLine(todo.taskName))}`, "", `**Status:** ${todo.status}`, `**Completion:** ${formatCompletion(taskCompletion(todo))}`, `**Time:** ${formatTime(taskTime(todo))}${todo.workingSince === undefined ? "" : " (running)"}`, "", markdownBody(todo.taskInfo), "");
        }
    }
    return `${lines.join("\n").trimEnd()}\n`;
}
function markdownBody(value) {
    return safeMultiline(value).join("\n").trim() || "_No details provided._";
}
function escapeMarkdownInline(value) {
    return value.replace(/([-\\`*_[\]{}()<>#+.!|])/g, "\\$1");
}

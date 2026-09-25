import { safeMultiline, safeSingleLine } from "./text.js";
import type { WorkWithTodos } from "./types.js";

export function formatWorksMarkdown(works: WorkWithTodos[]): string {
  const lines = ["# Works and Todos", ""];
  if (works.length === 0) return `${lines.join("\n")}\n_No works or todos in this session._\n`;

  for (const work of works) {
    lines.push(
      `## ${work.workId} — ${escapeMarkdownInline(safeSingleLine(work.workName))}`,
      "",
      `**Status:** ${work.status}`,
      "",
      "### Details",
      "",
      markdownBody(work.workInfo),
      "",
      "### Todos",
      "",
    );
    if (work.tasks.length === 0) {
      lines.push("_No todos._", "");
      continue;
    }
    for (const todo of work.tasks) {
      lines.push(
        `#### ${todo.taskId} — ${escapeMarkdownInline(safeSingleLine(todo.taskName))}`,
        "",
        `**Status:** ${todo.status}`,
        "",
        markdownBody(todo.taskInfo),
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function markdownBody(value: string): string {
  return safeMultiline(value).join("\n").trim() || "_No details provided._";
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([-\\`*_[\]{}()<>#+.!|])/g, "\\$1");
}

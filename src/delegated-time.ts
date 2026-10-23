import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { type ExtensionAPI, type ExtensionContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TaskState } from "./state.js";
import { formatTime, taskTime } from "./time.js";
import { renderTaskCall, renderTaskResult, taskResult } from "./tool-result.js";
import { areTrackingToolsActive } from "./tracking.js";

interface TimingReport {
  version: 1;
  parentSessionId: string;
  parentWorkId: string;
  parentTaskId: string;
  workerSessionId: string | null;
  tasks: Array<{ taskId: string; elapsedMs: number | null }>;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TASK_ID = /^T[1-9][0-9]*$/;
const WORK_ID = /^W[1-9][0-9]*$/;
const ElapsedSchema = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
const execution = { executionMode: "sequential" as const, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } };

function inside(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return !!suffix && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

/** All reports are regular files within the repository's real var/ tree. */
async function reportDirectory(cwd: string, path: string): Promise<string> {
  const root = resolve(await realpath(cwd), "var");
  const directory = await realpath(path);
  if (!inside(root, directory)) throw new Error("Timing reports must be below the repository's var/ directory.");
  return directory;
}

async function reportFile(cwd: string, path: string): Promise<string> {
  const requested = resolve(cwd, path);
  const directory = await reportDirectory(cwd, dirname(requested));
  const actual = await realpath(requested);
  if (actual !== resolve(directory, basename(requested)) || !(await stat(actual)).isFile()) {
    throw new Error("Timing reports must be regular files, not symlinks.");
  }
  return actual;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validElapsed(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

async function readReport(path: string): Promise<TimingReport> {
  if ((await stat(path)).size > 128_000) throw new Error("Timing report exceeds 128 KB.");
  const data = object(JSON.parse(await readFile(path, "utf8")));
  if (data?.version !== 1 || typeof data.parentSessionId !== "string" || !SESSION_ID.test(data.parentSessionId)
    || typeof data.parentWorkId !== "string" || !WORK_ID.test(data.parentWorkId)
    || typeof data.parentTaskId !== "string" || !TASK_ID.test(data.parentTaskId)
    || !(data.workerSessionId === null || (typeof data.workerSessionId === "string" && SESSION_ID.test(data.workerSessionId)))
    || !Array.isArray(data.tasks) || data.tasks.length > 500) throw new Error("Malformed timing report.");
  const ids = new Set<string>();
  for (const raw of data.tasks) {
    const task = object(raw);
    if (!task || typeof task.taskId !== "string" || !TASK_ID.test(task.taskId) || ids.has(task.taskId) || !validElapsed(task.elapsedMs)) {
      throw new Error("Malformed or duplicate timing report task.");
    }
    ids.add(task.taskId);
  }
  if ((data.workerSessionId === null) !== (data.tasks.length === 0)) throw new Error("Timing report has no worker measurement.");
  return data as unknown as TimingReport;
}

export async function createTimingReport(ctx: ExtensionContext, taskDir: string, workId: string, taskId: string): Promise<string> {
  const sessionId = ctx.sessionManager.getSessionId();
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid parent session ID for timing handoff.");
  const directory = await reportDirectory(ctx.cwd, resolve(ctx.cwd, taskDir));
  const path = resolve(directory, `delegated-time-${randomUUID()}.json`);
  const report: TimingReport = { version: 1, parentSessionId: sessionId, parentWorkId: workId, parentTaskId: taskId, workerSessionId: null, tasks: [] };
  await withFileMutationQueue(path, () => writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
  return path;
}

function measuredTotal(report: TimingReport): number | null {
  if (!report.tasks.length || report.tasks.some((task) => task.elapsedMs === null)) return null;
  const total = report.tasks.reduce((sum, task) => sum + (task.elapsedMs ?? 0), 0);
  if (!Number.isSafeInteger(total)) throw new Error("Timing report total is too large.");
  return total;
}

export function registerDelegatedTimeTools(pi: ExtensionAPI, state: TaskState): void {
  const requireMainWork = () => {
    if (!areTrackingToolsActive(pi)) throw new Error("Timing handoffs are available only in tracked main-conversation work, not /ask or /btw.");
  };
  pi.registerTool({
    name: "TaskTimeExport", label: "TaskTimeExport",
    description: "Export measured effort for this worker's assignment to the exact reportPath supplied by AgentCreate. Pause or complete every included task first. Supply all assignment task IDs, including cancelled tasks and imported nested delegates; exclude unrelated tasks. Re-export the cumulative set after follow-ups. Durations come from pi-tasks, never from the model. Does not complete the parent task.",
    parameters: Type.Object({
      reportPath: Type.String({ minLength: 1 }),
      taskIds: Type.Array(Type.String({ pattern: TASK_ID.source }), { minItems: 1, maxItems: 500, uniqueItems: true }),
    }, { additionalProperties: false }),
    ...{ outputSchema: Type.Object({ reportPath: Type.String(), workerSessionId: Type.String(), elapsedMs: ElapsedSchema, taskIds: Type.Array(Type.String()) }) },
    ...execution,
    async execute(_id, params, _signal, _update, ctx) {
      requireMainWork();
      const path = await reportFile(ctx.cwd, params.reportPath);
      return withFileMutationQueue(path, async () => {
        const previous = await readReport(path);
        const workerSessionId = ctx.sessionManager.getSessionId();
        if (!SESSION_ID.test(workerSessionId) || workerSessionId === previous.parentSessionId) throw new Error("Timing export requires a distinct worker session.");
        if (previous.workerSessionId !== null && previous.workerSessionId !== workerSessionId) throw new Error("Timing report belongs to another worker session.");
        const ids = new Set(params.taskIds);
        if (ids.size !== params.taskIds.length || previous.tasks.some((task) => !ids.has(task.taskId))) throw new Error("Re-export all previously reported tasks plus any new assignment tasks.");
        const now = Date.now();
        const tasks = params.taskIds.map((taskId) => {
          const todo = state.getTodo(taskId);
          if (!todo) throw new Error(`Todo ${taskId} not found in this worker session.`);
          if (todo.workingSince !== undefined) throw new Error(`Pause or complete ${taskId} before exporting timing.`);
          return { taskId, elapsedMs: taskTime(todo, now) };
        });
        const report: TimingReport = { ...previous, workerSessionId, tasks };
        const elapsedMs = measuredTotal(report);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        }
        const data = { reportPath: path, workerSessionId, elapsedMs, taskIds: params.taskIds };
        return { ...taskResult(`Exported ${tasks.length} task timings: ${formatTime(elapsedMs)}. Parent must call TaskTimeImport for ${report.parentTaskId}.`, "task-time-export", data), structuredContent: data };
      });
    },
    renderCall: renderTaskCall("TaskTimeExport"), renderResult: renderTaskResult,
  });
  pi.registerTool({
    name: "TaskTimeImport", label: "TaskTimeImport",
    description: "Import this delegated task's registered worker timing files after worker output is available. Repeated imports replace cumulative snapshots, never double-count. Parent status and completion are unchanged. Missing worker measurements stay unknown. Import nested delegate time before exporting to your own caller.",
    parameters: Type.Object({ taskId: Type.String({ pattern: TASK_ID.source }) }, { additionalProperties: false }),
    ...{ outputSchema: Type.Object({ taskId: Type.String(), elapsedMs: ElapsedSchema }) },
    ...execution,
    async execute(_id, params, _signal, _update, ctx) {
      requireMainWork();
      const todo = state.getTodo(params.taskId);
      if (!todo?.delegatedTimes?.length) throw new Error("This task has no timing handoff registered by AgentCreate.");
      const updates = [];
      for (const source of todo.delegatedTimes) {
        const path = await reportFile(ctx.cwd, source.reportPath);
        const report = await readReport(path);
        if (report.parentSessionId !== ctx.sessionManager.getSessionId() || report.parentWorkId !== todo.workId || report.parentTaskId !== todo.taskId) {
          throw new Error("Timing report belongs to another parent assignment.");
        }
        if (source.workerSessionId && source.workerSessionId !== report.workerSessionId) throw new Error("Timing report belongs to another worker session.");
        updates.push({ reportPath: source.reportPath, workerSessionId: report.workerSessionId ?? undefined, elapsedMs: measuredTotal(report) });
      }
      for (const source of updates) state.setDelegatedTime(todo.taskId, source);
      const elapsedMs = taskTime(state.getTodo(todo.taskId)!);
      const data = { taskId: todo.taskId, elapsedMs };
      return { ...taskResult(`Imported timing for ${todo.taskId}: ${formatTime(elapsedMs)}. Status remains ${todo.status}.${updates.some((source) => !source.workerSessionId) ? " A worker has not exported its measurement yet." : ""}`, "task-time-import", data), structuredContent: data };
    },
    renderCall: renderTaskCall("TaskTimeImport"), renderResult: renderTaskResult,
  });
}

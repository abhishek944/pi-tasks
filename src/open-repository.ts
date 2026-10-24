import { execFile } from "node:child_process";
import { glob, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Read the executable and fixed arguments from Pi's merged settings. */
export function readOpenCommand(settings: unknown): string[] {
  const config = settings !== null && typeof settings === "object" ? (settings as Record<string, unknown>)["pi-tasks"] : undefined;
  const command = config !== null && typeof config === "object" ? (config as Record<string, unknown>).openCommand : undefined;
  if (command === undefined) return ["cursor"];
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.includes("\0")) || !command[0].trim()) {
    throw new Error("pi-tasks.openCommand must be a nonempty array of strings starting with an executable, for example [\"code\", \"--new-window\"].");
  }
  return [...command];
}

/** Launch the configured command without a shell, appending the target directory. */
export async function openRepository(cwd: string, command: string[] = ["cursor"]): Promise<void> {
  const [executable, ...args] = command;
  if (!executable) throw new Error("An open command executable is required.");
  await execFileAsync(executable, [...args, "."], { cwd, timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
}

/** Open the existing direct or nested agent artifact root, creating a new root only if needed. */
export async function openSession(cwd: string, sessionId: string, command: string[] = ["cursor"]): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sessionId)) throw new Error("A valid Pi session ID is required to open session artifacts.");
  const repository = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true })
    .then(({ stdout }) => stdout.trim(), () => cwd);
  const varRoot = resolve(repository, "var");
  await mkdir(varRoot, { recursive: true });
  const matches: string[] = [];
  for await (const path of glob(`**/${sessionId}`, { cwd: varRoot })) {
    const directory = resolve(varRoot, path);
    if ((await stat(directory)).isDirectory()) matches.push(directory);
  }
  if (matches.length > 1) throw new Error("Multiple artifact folders match this session; open the intended folder explicitly.");
  const directory = matches[0] ?? resolve(varRoot, sessionId);
  await mkdir(directory, { recursive: true });
  await openRepository(directory, command);
}

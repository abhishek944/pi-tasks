import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/** Launch Cursor without a shell, using the active session's working directory. */
export async function openRepository(cwd) {
    await execFileAsync("cursor", ["."], { cwd, timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
}

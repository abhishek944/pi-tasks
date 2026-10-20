import { execFile } from "node:child_process";
import { glob, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/** Launch Cursor without a shell, using the active session's working directory. */
export async function openRepository(cwd) {
    await execFileAsync("cursor", ["."], { cwd, timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
}
/** Open the existing direct or nested agent artifact root, creating a new root only if needed. */
export async function openSession(cwd, sessionId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sessionId))
        throw new Error("A valid Pi session ID is required to open session artifacts.");
    const repository = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true })
        .then(({ stdout }) => stdout.trim(), () => cwd);
    const varRoot = resolve(repository, "var");
    await mkdir(varRoot, { recursive: true });
    const matches = [];
    for await (const path of glob(`**/${sessionId}`, { cwd: varRoot })) {
        const directory = resolve(varRoot, path);
        if ((await stat(directory)).isDirectory())
            matches.push(directory);
    }
    if (matches.length > 1)
        throw new Error("Multiple artifact folders match this session; open the intended folder explicitly.");
    const directory = matches[0] ?? resolve(varRoot, sessionId);
    await mkdir(directory, { recursive: true });
    await openRepository(directory);
}

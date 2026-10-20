import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export const PANE_ID = /^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/;
export function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export async function herdrText(args, cwd, signal, timeout = 15_000) {
    if (process.env.HERDR_ENV !== "1")
        throw new Error("Agent tools require Herdr (HERDR_ENV=1).");
    const { stdout } = await execFileAsync("herdr", args, { cwd, signal, timeout, maxBuffer: 256 * 1024, windowsHide: true });
    return stdout;
}
export async function herdr(args, cwd, signal, timeout) {
    const response = object(JSON.parse(await herdrText(args, cwd, signal, timeout)));
    const error = object(response?.error);
    if (error)
        throw new Error(typeof error.message === "string" ? error.message : "Herdr command failed.");
    const result = object(response?.result);
    if (!result)
        throw new Error("Herdr returned no result.");
    return result;
}

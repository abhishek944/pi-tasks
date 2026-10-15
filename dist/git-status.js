/**
 * Shared, read-only Git cache. Construction/rendering start no processes;
 * subscribers own polling, and refreshes retain the previous snapshot.
 * Independently authored, informed by pi-powerline-footer's cache behavior:
 * https://github.com/nicobailon/pi-powerline-footer/blob/main/git-status.ts
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
const REFRESH_INTERVAL_MS = 1_000;
const READ_TIMEOUT_MS = 5_000;
const READ_MAX_BUFFER = 4 * 1024 * 1024;
const DETACHED_COMMIT_LENGTH = 7;
const GIT_STATUS_ARGS = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];
const execFileAsync = promisify(execFile);
export class GitStatusCache {
    cwd;
    snapshot = { kind: "loading" };
    listeners = new Set();
    timer;
    request;
    controller;
    requestSeq = 0;
    refreshQueued = false;
    refreshedAt = Number.NEGATIVE_INFINITY;
    disposed = false;
    /**
     * Record the session working directory. Changing it resets the snapshot to
     * `loading` and cancels any read for the previous directory, so results from
     * the old directory can never be published for the new one.
     */
    setCwd(cwd) {
        const nextCwd = resolve(cwd);
        if (nextCwd === this.cwd)
            return;
        this.cwd = nextCwd;
        this.refreshedAt = Number.NEGATIVE_INFINITY;
        this.cancelRequest();
        this.refreshQueued = false;
        this.publish({ kind: "loading" });
        this.refresh();
    }
    /** Last known snapshot. Synchronous; never spawns a process. */
    getSnapshot() {
        return this.snapshot;
    }
    /**
     * Subscribe to visible snapshot changes. The first subscriber starts the
     * async read and one-second polling; the last unsubscribe stops polling and
     * cancels pending work. A later subscribe starts polling again.
     */
    subscribe(listener) {
        this.disposed = false;
        this.listeners.add(listener);
        if (this.listeners.size === 1)
            this.startPolling();
        return () => {
            this.unsubscribe(listener);
        };
    }
    /**
     * Expire the current data and refresh sooner than the next poll. The last
     * snapshot keeps being served until the refresh lands, so the UI never
     * flashes a loading state for a change that may not affect the counts. When a
     * read is already running, one more read is queued for its completion.
     */
    invalidate() {
        if (this.cwd === undefined)
            return;
        this.refreshedAt = Number.NEGATIVE_INFINITY;
        this.refreshQueued = true;
        this.refresh();
    }
    /**
     * Stop polling and cancel pending work. Idempotent. A later `subscribe()`
     * starts a fresh cycle, which lets an extension reuse one cache across
     * sessions.
     */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.stopPolling();
        this.cancelRequest();
        this.refreshQueued = false;
        this.listeners.clear();
    }
    startPolling() {
        if (this.timer !== undefined || this.disposed)
            return;
        this.timer = setInterval(() => this.poll(), REFRESH_INTERVAL_MS);
        this.timer.unref();
        this.refresh();
    }
    /** One poll tick; a slow read is never overlapped and simply waits its turn. */
    poll() {
        if (this.request !== undefined)
            return;
        this.refreshQueued = true;
        this.refresh();
    }
    stopPolling() {
        if (this.timer === undefined)
            return;
        clearInterval(this.timer);
        this.timer = undefined;
    }
    unsubscribe(listener) {
        if (!this.listeners.delete(listener))
            return;
        if (this.listeners.size > 0)
            return;
        this.stopPolling();
        this.cancelRequest();
        this.refreshQueued = false;
    }
    /** Start a read when one is needed and nothing is already running. */
    refresh() {
        if (this.disposed || this.listeners.size === 0)
            return;
        const cwd = this.cwd;
        if (cwd === undefined)
            return;
        if (this.request !== undefined) {
            this.refreshQueued = true;
            return;
        }
        if (!this.refreshQueued && performance.now() - this.refreshedAt < REFRESH_INTERVAL_MS)
            return;
        this.refreshQueued = false;
        this.refreshedAt = performance.now();
        const controller = new AbortController();
        const seq = ++this.requestSeq;
        this.controller = controller;
        this.request = readGitSnapshot(cwd, controller.signal).then((snapshot) => {
            this.settle(seq, cwd, controller, snapshot);
        }, () => {
            this.settle(seq, cwd, controller, undefined);
        });
    }
    settle(seq, cwd, controller, snapshot) {
        if (seq !== this.requestSeq)
            return; // Superseded by a cancellation or a newer read.
        this.request = undefined;
        if (this.controller === controller)
            this.controller = undefined;
        // An invalidation during the read keeps serving the prior snapshot until its queued refresh.
        if (!this.refreshQueued && !controller.signal.aborted && !this.disposed && cwd === this.cwd) {
            if (snapshot === undefined)
                this.publishFailure();
            else
                this.publish(snapshot);
        }
        if (this.refreshQueued && !this.disposed && this.listeners.size > 0)
            this.refresh();
    }
    /** Keep the previous result; only a first read can become unavailable. */
    publishFailure() {
        if (this.snapshot.kind === "loading")
            this.publish({ kind: "unavailable" });
    }
    publish(next) {
        if (sameSnapshot(this.snapshot, next))
            return;
        this.snapshot = next;
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch {
                // A failing listener must not break polling or other listeners.
            }
        }
    }
    /** Abort the current child process and make its completion irrelevant. */
    cancelRequest() {
        const controller = this.controller;
        this.controller = undefined;
        this.request = undefined;
        this.requestSeq += 1;
        controller?.abort();
    }
}
function sameSnapshot(a, b) {
    if (a.kind !== b.kind)
        return false;
    if (a.kind === "ready" && b.kind === "ready") {
        return a.branch === b.branch && a.staged === b.staged && a.unstaged === b.unstaged && a.untracked === b.untracked;
    }
    return true;
}
/** Read-only git environment: no index refresh, stable English diagnostics. */
function readOnlyGitEnv() {
    return { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", LANG: "C" };
}
async function readGitSnapshot(cwd, signal) {
    try {
        const { stdout } = await execFileAsync("git", GIT_STATUS_ARGS, {
            cwd,
            env: readOnlyGitEnv(),
            encoding: "utf8",
            timeout: READ_TIMEOUT_MS,
            maxBuffer: READ_MAX_BUFFER,
            signal,
            windowsHide: true,
        });
        return parseGitStatus(stdout);
    }
    catch (error) {
        if (isOutsideRepository(error))
            return { kind: "not-repository" };
        throw error;
    }
}
function isOutsideRepository(error) {
    if (!(error instanceof Error))
        return false;
    const stderr = error.stderr;
    const details = typeof stderr === "string" ? `${error.message}\n${stderr}` : error.message;
    const text = details.toLowerCase();
    return text.includes("not a git repository") || text.includes("must be run in a work tree");
}
/**
 * Parse `--porcelain=v2 --branch -z` NUL-separated records.
 *
 * Tracked records carry XY at offsets 2 and 3, so one file can count as staged
 * and unstaged at once. Rename/copy records keep their source path in the next
 * NUL field and are skipped, and paths containing newlines stay single
 * records, so neither can inflate the counts.
 */
function parseGitStatus(stdout) {
    const fields = stdout.split("\0");
    let branchHead;
    let branchOid;
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field === undefined || field.length === 0)
            continue;
        if (field.startsWith("# ")) {
            const header = field.slice(2);
            if (header.startsWith("branch.head ")) {
                branchHead = header.slice("branch.head ".length);
            }
            else if (header.startsWith("branch.oid ")) {
                branchOid = header.slice("branch.oid ".length);
            }
            continue;
        }
        const record = field.charAt(0);
        if (record === "?") {
            untracked += 1;
            continue;
        }
        if (record === "1" || record === "2" || record === "u") {
            if (isChanged(field.charAt(2)))
                staged += 1;
            if (isChanged(field.charAt(3)))
                unstaged += 1;
            if (record === "2")
                index += 1; // Skip the rename/copy source path.
        }
    }
    if (branchHead === undefined)
        throw new Error("git status did not report a branch");
    return { kind: "ready", branch: formatBranch(branchHead, branchOid), staged, unstaged, untracked };
}
function isChanged(status) {
    return status !== "" && status !== "." && status !== " ";
}
function formatBranch(head, oid) {
    if (head !== "(detached)")
        return head;
    if (oid === undefined || oid === "(initial)")
        return "detached";
    return `@${oid.slice(0, DETACHED_COMMIT_LENGTH)}`;
}

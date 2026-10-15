/**
 * Shared, read-only Git cache. Construction/rendering start no processes;
 * subscribers own polling, and refreshes retain the previous snapshot.
 * Independently authored, informed by pi-powerline-footer's cache behavior:
 * https://github.com/nicobailon/pi-powerline-footer/blob/main/git-status.ts
 */
export type GitSnapshot = {
    kind: "loading";
} | {
    kind: "not-repository";
} | {
    kind: "unavailable";
} | {
    kind: "ready";
    branch: string;
    staged: number;
    unstaged: number;
    untracked: number;
};
export declare class GitStatusCache {
    private cwd;
    private snapshot;
    private readonly listeners;
    private timer;
    private request;
    private controller;
    private requestSeq;
    private refreshQueued;
    private refreshedAt;
    private disposed;
    /**
     * Record the session working directory. Changing it resets the snapshot to
     * `loading` and cancels any read for the previous directory, so results from
     * the old directory can never be published for the new one.
     */
    setCwd(cwd: string): void;
    /** Last known snapshot. Synchronous; never spawns a process. */
    getSnapshot(): GitSnapshot;
    /**
     * Subscribe to visible snapshot changes. The first subscriber starts the
     * async read and one-second polling; the last unsubscribe stops polling and
     * cancels pending work. A later subscribe starts polling again.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Expire the current data and refresh sooner than the next poll. The last
     * snapshot keeps being served until the refresh lands, so the UI never
     * flashes a loading state for a change that may not affect the counts. When a
     * read is already running, one more read is queued for its completion.
     */
    invalidate(): void;
    /**
     * Stop polling and cancel pending work. Idempotent. A later `subscribe()`
     * starts a fresh cycle, which lets an extension reuse one cache across
     * sessions.
     */
    dispose(): void;
    private startPolling;
    /** One poll tick; a slow read is never overlapped and simply waits its turn. */
    private poll;
    private stopPolling;
    private unsubscribe;
    /** Start a read when one is needed and nothing is already running. */
    private refresh;
    private settle;
    /** Keep the previous result; only a first read can become unavailable. */
    private publishFailure;
    private publish;
    /** Abort the current child process and make its completion irrelevant. */
    private cancelRequest;
}

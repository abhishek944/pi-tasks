/** Launch Cursor without a shell, using the active session's working directory. */
export declare function openRepository(cwd: string): Promise<void>;
/** Open the existing direct or nested agent artifact root, creating a new root only if needed. */
export declare function openSession(cwd: string, sessionId: string): Promise<void>;

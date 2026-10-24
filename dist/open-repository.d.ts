/** Read the executable and fixed arguments from Pi's merged settings. */
export declare function readOpenCommand(settings: unknown): string[];
/** Launch the configured command without a shell, appending the target directory. */
export declare function openRepository(cwd: string, command?: string[]): Promise<void>;
/** Open the existing direct or nested agent artifact root, creating a new root only if needed. */
export declare function openSession(cwd: string, sessionId: string, command?: string[]): Promise<void>;

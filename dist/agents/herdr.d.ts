export declare const PANE_ID: RegExp;
export declare function object(value: unknown): Record<string, unknown> | undefined;
export declare function herdrText(args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<string>;
export declare function herdr(args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<Record<string, unknown>>;

export interface DelegateLink {
    paneId: string;
}
export declare function delegateLink(taskInfo: string): DelegateLink | undefined;
export declare function focusPane(paneId: string, cwd: string, signal?: AbortSignal): Promise<void>;
export declare function preservePaneLink(current: string, next: string): string;
export declare function withPaneLink(taskInfo: string, paneId?: string, monitorId?: string): string;

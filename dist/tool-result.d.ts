import { Text } from "@earendil-works/pi-tui";
export interface TaskToolDetails {
    action: string;
    summary: string;
    displaySummary: string;
    data?: unknown;
}
export declare function taskResult(summary: string, action: string, data?: unknown, displaySummary?: string): {
    content: Array<{
        type: "text";
        text: string;
    }>;
    details: TaskToolDetails;
};
export declare function renderTaskCall(label: string): (args: Record<string, unknown>, theme: {
    fg(name: string, value: string): string;
    bold(value: string): string;
}) => Text;
export declare function renderTaskResult(result: {
    content: Array<{
        type: string;
        text?: string;
    }>;
    details?: unknown;
}, options: {
    expanded: boolean;
}, theme: {
    fg(name: string, value: string): string;
}, context: {
    isError: boolean;
}): Text;

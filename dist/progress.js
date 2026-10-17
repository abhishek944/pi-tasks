export function taskCompletion(todo) {
    if (todo.status === "completed")
        return 100;
    const value = todo.completionPercent;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100 ? value : null;
}
export function workCompletion(work) {
    const tasks = work.tasks.filter((todo) => todo.status !== "cancelled");
    if (tasks.length === 0)
        return work.status === "completed" ? 100 : null;
    let total = 0;
    for (const todo of tasks) {
        const value = taskCompletion(todo);
        if (value === null)
            return null;
        total += value;
    }
    return Math.floor(total / tasks.length);
}
export function formatCompletion(value) {
    return value === null ? "—" : `${value}%`;
}

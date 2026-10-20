export function taskOwner(taskInfo) {
    const owners = new Set([...taskInfo.matchAll(/^[ \t]*owner:[ \t]*(self|delegate)(?=[ \t.,;:\r]|$)/gim)]
        .map((match) => match[1]?.toLowerCase()));
    if (owners.size !== 1)
        return "unassigned";
    if (owners.has("self"))
        return "self";
    return owners.has("delegate") ? "delegate" : "unassigned";
}

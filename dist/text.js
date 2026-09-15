export function safeSingleLine(value) {
    return [...value]
        .map((character) => {
        const code = character.charCodeAt(0);
        if (character === "\n" || character === "\r" || character === "\t")
            return " ";
        if (code <= 31 || (code >= 127 && code <= 159))
            return `\\x${code.toString(16).padStart(2, "0")}`;
        return character;
    })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}
export function safeMultiline(value) {
    return value.split(/\r?\n/).map((line) => [...line].map((character) => {
        const code = character.charCodeAt(0);
        if (character === "\t")
            return "  ";
        if (code <= 31 || (code >= 127 && code <= 159))
            return `\\x${code.toString(16).padStart(2, "0")}`;
        return character;
    }).join(""));
}

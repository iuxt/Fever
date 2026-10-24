// Bound both text parsing and the number of rich-text DOM blocks at first open.
export function isLargeDocument(content: string) {
 if (content.length >= 200_000) return true;
 let lines = 0;
 for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10 && ++lines >= 2_000) return true;
 return false;
}

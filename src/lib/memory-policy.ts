/**
 * Memory is personal data. We only inject or extract it when the persisted
 * preference was read successfully and is explicitly enabled. Missing or
 * unreadable state must fail closed.
 */
export function allowsMemoryUse(memoryEnabled: boolean | null | undefined): boolean {
	return memoryEnabled === true;
}

/** An explicit tool attempt owns the turn, even if it failed or memory is off.
 * Background extraction must not duplicate, undo, or silently retry that action.
 */
export function usedMemoryTools(parts: readonly { type: string }[]): boolean {
	return parts.some((part) => ["tool-listMemories", "tool-saveMemory", "tool-updateMemory", "tool-deleteMemories"].includes(part.type));
}

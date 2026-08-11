/**
 * Memory is personal data. We only inject or extract it when the persisted
 * preference was read successfully and is explicitly enabled. Missing or
 * unreadable state must fail closed.
 */
export function allowsMemoryUse(memoryEnabled: boolean | null | undefined): boolean {
	return memoryEnabled === true;
}

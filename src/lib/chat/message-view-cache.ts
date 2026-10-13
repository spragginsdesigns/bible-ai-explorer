/** Per-hook cache: SDK updates replace the active row while settled row identities remain stable. */
export function createMessageViewCache<Source extends { id: string }, View extends { timestamp: number }>() {
	const entries = new Map<string, { source: Source; context: string; view: View }>();
	return {
		get(source: Source, context: string, convert: (timestamp: number) => View): View {
			const old = entries.get(source.id);
			if (old?.source === source && old.context === context) return old.view;
			const view = convert(old?.view.timestamp ?? Date.now());
			entries.delete(source.id);
			entries.set(source.id, { source, context, view });
			return view;
		},
		retain(ids: Set<string>): void {
			for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
		},
	};
}

export function latestMessageIds(messages: { id: string; role: string }[]): { assistant?: string; user?: string } {
	const ids: { assistant?: string; user?: string } = {};
	for (let i = messages.length - 1; i >= 0; i--) {
		if (!ids.assistant && messages[i].role === "assistant") ids.assistant = messages[i].id;
		if (!ids.user && messages[i].role === "user") ids.user = messages[i].id;
		if (ids.assistant && ids.user) break;
	}
	return ids;
}

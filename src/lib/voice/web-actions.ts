/** Only semantic actions registered by the currently mounted, active UI. */
export interface VoiceAction {
	label: string;
	run: () => void | Promise<void>;
}
export interface VoiceActionScope {
	key: string;
	question: string;
	actions: readonly VoiceAction[];
	/** A visible church search field, or the canonical chat send. */
	onText?: (text: string) => void | Promise<void>;
	priority?: number;
	/** Tour/search instructions have no separate welcome narration. */
	narrateQuestion?: boolean;
}
/** Captured labels and their refreshed callbacks must still describe one surface. */
export function voiceScopeSignature(scope: VoiceActionScope | null): string {
	return scope ? JSON.stringify([scope.key, scope.question, scope.priority, scope.narrateQuestion, scope.actions.map(action => action.label), Boolean(scope.onText)]) : "";
}
export function currentVoiceAction(scope: VoiceActionScope | null, capturedSignature: string, index: number): VoiceAction | null {
	if (!scope || voiceScopeSignature(scope) !== capturedSignature) return null;
	return scope.actions[index] ?? null;
}

export class VoiceActionRegistry {
	revision = 0;
	private scopes = new Map<symbol, VoiceActionScope>();
	constructor(private readonly changed: () => void = () => {}) {}
	register(scope: VoiceActionScope): () => void {
		const token = Symbol(scope.key);
		this.scopes.set(token, scope);
		this.bump();
		return () => { if (this.scopes.delete(token)) this.bump(); };
	}
	get current(): VoiceActionScope | undefined {
		return [...this.scopes.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
	}
	get options(): string[] { return this.current?.actions.map(action => action.label) ?? []; }
	readOptions(includeQuestion = true): string {
		const scope = this.current;
		return scope && scope.actions.length
			? `${(includeQuestion || scope.narrateQuestion) ? scope.question : "Available choices."} ${scope.actions.map((action, i) => `Option ${i + 1}. ${action.label}.`).join(" ")} Say the option's name or number.`
			: "No choice card is open. Say open Today, Bible, Chat, Connections, Study, Notes, or Settings. In Chat, you can ask your question.";
	}
	async choose(index: number, revision: number): Promise<boolean> {
		if (revision !== this.revision) return false;
		const action = this.current?.actions[index];
		if (!action) return false;
		// Remove the entire previous surface before executing. Repeated results
		// cannot repeat a setting write or send the same answer twice.
		this.scopes.clear();
		this.bump();
		await action.run();
		return true;
	}
	clear(): void { this.scopes.clear(); this.bump(); }
	private bump(): void { this.revision += 1; this.changed(); }
}

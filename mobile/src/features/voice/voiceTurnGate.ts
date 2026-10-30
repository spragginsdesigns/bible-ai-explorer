/** Tokens make a final result unusable after backgrounding, account or card changes. */
export class VoiceTurnGate {
	private generation = 0;
	private active: { generation: number; scope: unknown } | null = null;
	invalidate() { this.generation += 1; this.active = null; }
	begin(scope: unknown) {
		const token = { generation: this.generation, scope };
		this.active = token;
		return token;
	}
	consume(token: { generation: number; scope: unknown }, scope: unknown, final: boolean, blocked: boolean) {
		if (!final || blocked || this.active !== token || token.generation !== this.generation || token.scope !== scope) return false;
		this.active = null;
		return true;
	}
}

export function voiceControlsEligible(response: unknown): boolean {
	return typeof response === "object" && response !== null && "pro" in response && response.pro === true;
}

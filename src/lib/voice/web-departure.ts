/** Voice navigation waits for mounted editors to confirm their pending saves. */
export type VoiceDepartureGuard = () => boolean | Promise<boolean>;
export class VoiceDepartureGuardRegistry {
	private guards = new Map<symbol, VoiceDepartureGuard>();
	private revision = 0;
	register(guard: VoiceDepartureGuard): () => void {
		const token = Symbol("voice-departure");
		this.guards.set(token, guard);
		this.revision += 1;
		return () => { if (this.guards.delete(token)) this.revision += 1; };
	}
	async check(): Promise<boolean> {
		const revision = this.revision;
		const results = await Promise.allSettled([...this.guards.values()].map(async guard => guard()));
		// A different editor appearing during a save requires a new command.
		return revision === this.revision && results.every(result => result.status === "fulfilled" && result.value === true);
	}
}
const voiceDepartureGuards = new VoiceDepartureGuardRegistry();
export const registerVoiceDepartureGuard = (guard: VoiceDepartureGuard): (() => void) => voiceDepartureGuards.register(guard);
export const confirmVoiceDeparture = (): Promise<boolean> => voiceDepartureGuards.check();

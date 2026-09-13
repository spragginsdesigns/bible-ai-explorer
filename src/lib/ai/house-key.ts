/** Only the included Luna path may use the dedicated service credential. */
export function houseKeyFor(env: Record<string, string | undefined>): string | undefined {
	return env.OPENAI_FREE_TIER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;
}

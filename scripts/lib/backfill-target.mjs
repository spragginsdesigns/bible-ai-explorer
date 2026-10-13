/** Backfills deliberately target the configured production index, never an inherited shell URL. */
export function assertBackfillTarget(connectionString) {
	const url = new URL(connectionString);
	const host = url.hostname.replace("-pooler", "");
	if (url.protocol !== "postgresql:" || host !== "ep-mute-waterfall-akrqxqaz.c-3.us-west-2.aws.neon.tech" || url.pathname !== "/neondb") {
		throw new Error("Refusing backfill: the configured endpoint is not the production index.");
	}
}

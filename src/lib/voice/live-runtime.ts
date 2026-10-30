import { resolve } from "node:path";
import { openLiveLedger } from "./live-ledger.mjs";
import { liveAppOrigin, liveRelayUrl, liveSecret } from "./live-policy";

/** This private trial intentionally cannot point at an unspecified shared DB. */
export function liveConfigured(): boolean {
	try {
		if (process.env.SUREWORD_LIVE_ENABLED !== "true") return false;
		liveSecret(process.env); liveRelayUrl(process.env); liveAppOrigin(process.env);
		const expected = process.env.SUREWORD_LIVE_ISOLATED_DATABASE_HOST;
		return !!process.env.OPENAI_API_KEY && !!expected && new URL(process.env.DATABASE_URL || "").hostname === expected;
	} catch { return false; }
}

const globalLedger = globalThis as unknown as { surewordLiveLedger?: ReturnType<typeof openLiveLedger> };
export function liveLedger() {
	if (!globalLedger.surewordLiveLedger) {
		globalLedger.surewordLiveLedger = openLiveLedger(process.env.SUREWORD_LIVE_LEDGER_PATH || resolve(process.cwd(), ".private/live-voice.sqlite"));
	}
	return globalLedger.surewordLiveLedger;
}

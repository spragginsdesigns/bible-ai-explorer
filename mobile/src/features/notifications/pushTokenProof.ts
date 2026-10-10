import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The device proof the server hands out for this phone's Expo push token
 * (src/lib/push-token-proof.ts on the server). Sending it back on every
 * registration binds the token to this device, so knowing the token alone is
 * no longer enough for another account to take it. The proof comes from the
 * token, not the account, so it survives signing in as someone else and must
 * NOT be cleared on sign-out.
 *
 * Kept as one token/proof pair: a phone has one Expo token, and a proof for an
 * old token is worthless for a new one.
 */
const PROOF_KEY = "sureword.notifications.pushTokenProof";

interface StoredProof {
	token: string;
	proof: string;
}

function parseStored(raw: string | null): StoredProof | null {
	if (!raw) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return null;
		const { token, proof } = value as Record<string, unknown>;
		return typeof token === "string" && typeof proof === "string" && token && proof
			? { token, proof }
			: null;
	} catch {
		return null;
	}
}

/** The stored proof for `token`, or undefined when there is none for it. */
export async function readPushTokenProof(token: string): Promise<string | undefined> {
	const stored = parseStored(await AsyncStorage.getItem(PROOF_KEY).catch(() => null));
	return stored?.token === token ? stored.proof : undefined;
}

/**
 * Keep the proof the server returned for `token`. A missing or malformed one
 * (a server from before the proof existed, or with the feature off) leaves
 * whatever is stored alone. Returns whether a new proof was stored.
 */
export async function savePushTokenProof(token: string, proof: unknown): Promise<boolean> {
	if (typeof proof !== "string" || !proof) return false;
	if ((await readPushTokenProof(token)) === proof) return false;
	await AsyncStorage.setItem(PROOF_KEY, JSON.stringify({ token, proof })).catch(() => {});
	return true;
}

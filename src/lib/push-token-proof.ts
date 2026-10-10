/**
 * Device proof for Expo push tokens (docs/FEATURES.md, "Who owns a push
 * token").
 *
 * Expo issues no device-held secret, so knowing a token used to be enough to
 * move it to another account. The server now hands the device a proof when it
 * registers: an HMAC under PUSH_TOKEN_PROOF_SECRET of the token and the row's
 * random `proofNonce`. The proof does not depend on the account, so a second
 * account signed in on the same phone still holds it. The nonce is what makes
 * a proof revocable: it is replaced whenever a row changes owner WITHOUT a
 * valid proof, which kills every proof handed out before, so whoever once
 * registered a token cannot keep a working proof for it. A row whose device
 * has sent the proof back is `deviceBound`, and only a caller holding the
 * current proof can move it (see mayRegisterExistingPushToken).
 *
 * Server only (node:crypto). Kept out of push-routing.ts because the web
 * client imports that module.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PROOF_CONTEXT = "push-token-proof:v2:";

/** The proof secret, or null when unset: the whole proof feature is then off. */
export function pushTokenProofSecret(env: Record<string, string | undefined> = process.env): string | null {
	const secret = env.PUSH_TOKEN_PROOF_SECRET?.trim();
	return secret ? secret : null;
}

/** A fresh `PushToken.proofNonce`. */
export function createPushTokenNonce(): string {
	return randomBytes(16).toString("base64url");
}

/** The proof a device holding `token` is given for the row's current nonce, as base64url. */
export function pushTokenProof(secret: string, token: string, nonce: string): string {
	return createHmac("sha256", secret).update(`${PROOF_CONTEXT}${token}:${nonce}`).digest("base64url");
}

/**
 * Whether `proof` is the proof for this token under the row's current nonce,
 * compared in constant time. A row with no nonce has no valid proof yet.
 */
export function isValidPushTokenProof(
	secret: string,
	token: string,
	nonce: string | null | undefined,
	proof: unknown,
): boolean {
	if (!nonce || typeof proof !== "string" || !proof) return false;
	const expected = Buffer.from(pushTokenProof(secret, token, nonce));
	const given = Buffer.from(proof);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

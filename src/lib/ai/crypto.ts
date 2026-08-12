import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for provider API keys at rest. The KEK lives in
 * CREDENTIAL_ENCRYPTION_KEY (64 hex chars = 32 bytes) and must be set in every
 * environment that touches ProviderCredential rows — we fail loudly rather
 * than fall back to plaintext.
 */
function encryptionKey(): Buffer {
	const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
	if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
		throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set to 64 hex characters.");
	}
	return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return [iv, cipher.getAuthTag(), ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(encrypted: string): string {
	const [iv, authTag, ciphertext] = encrypted.split(".").map((part) => Buffer.from(part, "base64"));
	const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

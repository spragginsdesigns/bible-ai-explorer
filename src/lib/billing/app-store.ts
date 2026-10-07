import "server-only";

import {
	Environment,
	SignedDataVerifier,
	VerificationException,
	VerificationStatus,
} from "@apple/app-store-server-library";
import { prisma } from "@/lib/prisma";
import { APPLE_ROOT_CA_G3_BASE64 } from "./apple-root-ca";
import {
	appAccountToken,
	appStoreConfig,
	applyNotification,
	assertProTransaction,
	HANDLED_NOTIFICATION_TYPES,
	sameToken,
	shouldApplyDeviceTransaction,
	stateFromTransaction,
	type AppStoreConfig,
	type AppStoreEnvironmentName,
	type DecodedRenewal,
	type DecodedTransaction,
} from "./app-store-rules";

/**
 * SureWord Pro through StoreKit 2: verify what Apple signed, bind it to the
 * SureWord account, and keep the row current from App Store Server
 * Notifications V2. The rules live in `app-store-rules.ts`.
 *
 * Only Apple's signed-data verification is used (Apple Root CA G3 + the
 * certificate chain in each JWS, with OCSP online checks). Nothing here calls
 * the App Store Server API, so no In-App Purchase key is needed, and every
 * verifier is constructed for SureWord's bundle id only.
 */

/** Verification failed. `retryable` = Apple's revocation check was unreachable. */
export class AppStoreVerificationError extends Error {
	constructor(message: string, readonly retryable: boolean) {
		super(message);
	}
}

/** The purchase is genuine but belongs to (or is bound to) a different account. */
export class AppStoreBindingError extends Error {}

const ENVIRONMENTS: Record<AppStoreEnvironmentName, Environment> = {
	Production: Environment.PRODUCTION,
	Sandbox: Environment.SANDBOX,
	Xcode: Environment.XCODE,
};

const verifiers = new Map<string, SignedDataVerifier>();

function verifierFor(name: AppStoreEnvironmentName, config: AppStoreConfig): SignedDataVerifier {
	const key = `${name}:${config.bundleId}:${config.appAppleId ?? ""}`;
	let verifier = verifiers.get(key);
	if (!verifier) {
		verifier = new SignedDataVerifier(
			[Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64")],
			true,
			ENVIRONMENTS[name],
			config.bundleId,
			name === "Production" ? config.appAppleId : undefined,
		);
		verifiers.set(key, verifier);
	}
	return verifier;
}

/** Try each configured environment in order (Production, then Sandbox). */
async function decodeWithFallback<T>(
	config: AppStoreConfig,
	decode: (verifier: SignedDataVerifier) => Promise<T>,
): Promise<{ value: T; environment: AppStoreEnvironmentName }> {
	let retryable = false;
	for (const environment of config.environments) {
		try {
			return { value: await decode(verifierFor(environment, config)), environment };
		} catch (error) {
			if (error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)
				retryable = true;
		}
	}
	throw new AppStoreVerificationError(
		retryable ? "Apple could not be reached to verify this purchase." : "This App Store purchase could not be verified.",
		retryable,
	);
}

function looksLikeJws(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 32_768 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

export interface DeviceVerificationResult {
	active: boolean;
	status: string;
	expiresAt: Date;
}

/**
 * `POST /api/billing/app-store/verify`: a StoreKit 2 `jwsRepresentation` from
 * the signed-in user's device, after a purchase, a restore, or a
 * `Transaction.updates` delivery.
 */
export async function verifyDeviceTransaction(userId: string, signedTransaction: unknown): Promise<DeviceVerificationResult> {
	const config = appStoreConfig();
	if (!config.available) throw new AppStoreVerificationError("App Store billing is not available yet.", true);
	if (!looksLikeJws(signedTransaction)) throw new AppStoreVerificationError("A signed App Store transaction is required.", false);
	const { value, environment } = await decodeWithFallback(config, (verifier) =>
		verifier.verifyAndDecodeTransaction(signedTransaction),
	);
	const tx = value as DecodedTransaction;
	assertProTransaction(tx);
	const now = new Date();
	const token = appAccountToken(userId);

	return prisma.$transaction(
		async (db) => {
			await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
			const existing = await db.appStoreSubscription.findUnique({
				where: { originalTransactionId: tx.originalTransactionId },
			});
			if (existing && existing.userId !== userId)
				throw new AppStoreBindingError("This App Store purchase belongs to another account.");
			// A purchase made in SureWord always carries the token. Only a row
			// this account already owns may be refreshed by a token-less one (a
			// resubscribe from iOS Settings can arrive without it).
			if (tx.appAccountToken ? !sameToken(tx.appAccountToken, token) : !existing)
				throw new AppStoreBindingError("This App Store purchase is not bound to this account.");
			const next = stateFromTransaction(tx, undefined, now, existing ?? undefined);
			if (!shouldApplyDeviceTransaction(existing, next, now)) {
				return {
					active: existing!.status === "active" && existing!.expiresAt > now,
					status: existing!.status,
					expiresAt: existing!.expiresAt,
				};
			}
			const row = existing
				? await db.appStoreSubscription.update({
						where: { originalTransactionId: tx.originalTransactionId },
						data: { ...next, environment, appAccountToken: tx.appAccountToken ?? existing.appAccountToken },
					})
				: await db.appStoreSubscription.create({
						data: {
							...next,
							userId,
							originalTransactionId: tx.originalTransactionId,
							environment,
							appAccountToken: tx.appAccountToken ?? null,
							lastSignedAt: new Date(0),
						},
					});
			return { active: row.status === "active" && row.expiresAt > now, status: row.status, expiresAt: row.expiresAt };
		},
		{ timeout: 20_000 },
	);
}

export type NotificationOutcome =
	| { result: "applied" | "duplicate" | "ignored" | "unknown-subscription" | "test" };

/**
 * `POST /api/billing/app-store/notifications`: App Store Server Notifications
 * V2. Idempotent by notificationUUID (recorded in `BillingEvent` as
 * `app-store:<uuid>` in the same transaction as the row change).
 */
export async function processNotification(signedPayload: unknown): Promise<NotificationOutcome> {
	const config = appStoreConfig();
	if (!config.available) throw new AppStoreVerificationError("App Store billing is not available yet.", true);
	if (!looksLikeJws(signedPayload)) throw new AppStoreVerificationError("A signed notification is required.", false);
	const { value: notification, environment } = await decodeWithFallback(config, (verifier) =>
		verifier.verifyAndDecodeNotification(signedPayload),
	);
	if (notification.data?.bundleId && notification.data.bundleId !== config.bundleId) return { result: "ignored" };
	if (notification.notificationType === "TEST") return { result: "test" };
	const uuid = notification.notificationUUID;
	if (!uuid) throw new AppStoreVerificationError("The notification has no id.", false);
	const eventId = `app-store:${uuid}`;
	if (await prisma.billingEvent.findUnique({ where: { id: eventId } })) return { result: "duplicate" };

	// The nested JWS are verified with the same environment's verifier.
	const verifier = verifierFor(environment, config);
	const signedTx = notification.data?.signedTransactionInfo;
	const signedRenewal = notification.data?.signedRenewalInfo;
	let transaction: DecodedTransaction | undefined;
	let renewal: DecodedRenewal | undefined;
	try {
		transaction = signedTx ? ((await verifier.verifyAndDecodeTransaction(signedTx)) as DecodedTransaction) : undefined;
		renewal = signedRenewal ? ((await verifier.verifyAndDecodeRenewalInfo(signedRenewal)) as DecodedRenewal) : undefined;
	} catch (error) {
		const retryable =
			error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
		throw new AppStoreVerificationError("The notification's transaction could not be verified.", retryable);
	}

	const handled = (HANDLED_NOTIFICATION_TYPES as readonly string[]).includes(notification.notificationType ?? "");
	const originalTransactionId = transaction?.originalTransactionId ?? renewal?.originalTransactionId;
	if (!handled || !originalTransactionId) {
		await prisma.billingEvent.create({ data: { id: eventId } }).catch(() => undefined);
		return { result: "ignored" };
	}
	const known = await prisma.appStoreSubscription.findUnique({ where: { originalTransactionId } });
	// Not bound yet (the device's verify call creates the row and carries the
	// account binding); nothing to move.
	if (!known) return { result: "unknown-subscription" };

	return prisma.$transaction(
		async (db) => {
			await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${known.userId} FOR UPDATE`;
			if (await db.billingEvent.findUnique({ where: { id: eventId } })) return { result: "duplicate" as const };
			const current = await db.appStoreSubscription.findUnique({ where: { originalTransactionId } });
			if (!current) return { result: "unknown-subscription" as const };
			const decision = applyNotification(
				current,
				{
					notificationType: notification.notificationType,
					subtype: notification.subtype,
					notificationUUID: uuid,
					signedDate: notification.signedDate,
					transaction,
					renewal,
				},
				new Date(),
			);
			if (decision.kind === "update")
				await db.appStoreSubscription.update({ where: { originalTransactionId }, data: decision.data });
			await db.billingEvent.create({ data: { id: eventId } });
			return { result: decision.kind === "update" ? ("applied" as const) : ("ignored" as const) };
		},
		{ timeout: 20_000 },
	);
}

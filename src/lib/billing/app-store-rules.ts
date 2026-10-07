/**
 * Pure App Store (StoreKit 2) subscription rules: configuration, the
 * account binding token, and how a signed transaction or an App Store Server
 * Notification V2 moves an `AppStoreSubscription` row.
 *
 * Split from `app-store.ts` (server-only, Prisma, Apple's verifier) so the
 * rules that decide who is Pro are testable directly
 * (`tests/app-store-billing.test.mjs`), like `entitlements-rules.ts`.
 *
 * Scope: SureWord shares its Apple developer team with another app. Every
 * value here is SureWord's own bundle id; `appStoreConfig` refuses any bundle
 * id that is not SureWord's, so a misconfigured env var can never point this
 * code at another app's purchases.
 */

import { createHash } from "node:crypto";

/** The one auto-renewable subscription (group "SureWord Pro", 1 month). */
export const APP_STORE_PRODUCT_ID = "com.spragginsdesigns.sureword.pro.monthly";
export const APP_STORE_DEFAULT_BUNDLE_ID = "com.spragginsdesigns.sureword";

/**
 * Fixed UUIDv5 namespace for `appAccountToken`. Never change it: every
 * existing purchase is bound to the token derived under this namespace.
 * Mirrored in `macos/Shared/Billing/AppAccountToken.swift`.
 */
export const APP_ACCOUNT_TOKEN_NAMESPACE = "2f58cff8-d92f-43e2-93d6-d21633bffbe5";

/**
 * The StoreKit `appAccountToken` for a SureWord account: UUIDv5(namespace,
 * Clerk user id), lowercase. Deterministic, so the device and the server agree
 * without a round trip, and opaque, so Apple never sees the Clerk id.
 */
export function appAccountToken(userId: string): string {
	const namespace = Buffer.from(APP_ACCOUNT_TOKEN_NAMESPACE.replace(/-/g, ""), "hex");
	const hash = createHash("sha1").update(namespace).update(Buffer.from(userId, "utf8")).digest();
	const bytes = Buffer.from(hash.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
	return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export type AppStoreEnvironmentName = "Production" | "Sandbox" | "Xcode";

export interface AppStoreConfig {
	bundleId: string;
	appAppleId?: number;
	/** Verifier environments to try, in order. Empty = not configured. */
	environments: AppStoreEnvironmentName[];
	/** True when purchases can be verified and will count toward Pro. */
	available: boolean;
}

type Env = Record<string, string | undefined>;

/**
 * - `APP_STORE_APP_ID`: SureWord's numeric Apple ID in App Store Connect.
 *   Required for Production verification.
 * - `APP_STORE_BUNDLE_ID`: defaults to com.spragginsdesigns.sureword; anything
 *   outside that bundle (or its own sub-ids) is refused.
 * - `APP_STORE_ENVIRONMENT`: unset = Production, then Sandbox fallback (what
 *   Apple recommends: App Review and TestFlight purchase in Sandbox against the
 *   production server). "Production" or "Sandbox" pins one. "Xcode" accepts
 *   unsigned local StoreKit-configuration transactions and is refused on any
 *   production deployment.
 */
export function appStoreConfig(env: Env = process.env): AppStoreConfig {
	const bundleId = env.APP_STORE_BUNDLE_ID?.trim() || APP_STORE_DEFAULT_BUNDLE_ID;
	const raw = env.APP_STORE_APP_ID?.trim();
	const parsed = raw && /^\d{1,15}$/.test(raw) ? Number(raw) : undefined;
	const appAppleId = parsed && parsed > 0 ? parsed : undefined;
	const sureWordBundle =
		bundleId === APP_STORE_DEFAULT_BUNDLE_ID || bundleId.startsWith(`${APP_STORE_DEFAULT_BUNDLE_ID}.`);
	const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
	const mode = env.APP_STORE_ENVIRONMENT?.trim();
	let environments: AppStoreEnvironmentName[] = [];
	if (!sureWordBundle) environments = [];
	else if (!mode) environments = appAppleId ? ["Production", "Sandbox"] : [];
	else if (mode === "Production") environments = appAppleId ? ["Production"] : [];
	else if (mode === "Sandbox") environments = ["Sandbox"];
	else if (mode === "Xcode") environments = production ? [] : ["Xcode"];
	return {
		bundleId,
		appAppleId,
		environments,
		available: env.SUREWORD_USAGE_ENABLED === "true" && environments.length > 0,
	};
}

/** Row statuses. Only "active" with a future `expiresAt` is Pro. */
export type AppStoreStatus = "active" | "billing_retry" | "expired" | "revoked";

/** The decoded fields this code reads (Apple's JWSTransactionDecodedPayload). */
export interface DecodedTransaction {
	transactionId?: string;
	originalTransactionId?: string;
	productId?: string;
	bundleId?: string;
	purchaseDate?: number;
	expiresDate?: number;
	revocationDate?: number;
	appAccountToken?: string;
	signedDate?: number;
	environment?: string;
	type?: string;
}

/** The decoded fields this code reads (Apple's JWSRenewalInfoDecodedPayload). */
export interface DecodedRenewal {
	originalTransactionId?: string;
	autoRenewStatus?: number;
	isInBillingRetryPeriod?: boolean;
	gracePeriodExpiresDate?: number;
	signedDate?: number;
}

export interface AppStoreState {
	status: AppStoreStatus;
	periodStart: Date;
	expiresAt: Date;
	cancelAtPeriodEnd: boolean;
	gracePeriodExpiresAt: Date | null;
	latestTransactionId: string;
	productId: string;
}

/** The persisted fields the transitions read. */
export interface AppStoreRow extends Omit<AppStoreState, "status"> {
	/** As stored; anything unrecognised reads as "expired". */
	status: string;
	userId: string;
	originalTransactionId: string;
	lastSignedAt: Date;
}

const STATUSES: readonly AppStoreStatus[] = ["active", "billing_retry", "expired", "revoked"];

/** A stored status, with any unrecognised value read as "expired" (never Pro). */
export function storedStatus(value: string): AppStoreStatus {
	return (STATUSES as readonly string[]).includes(value) ? (value as AppStoreStatus) : "expired";
}

/** Throws unless the transaction is a well-formed SureWord Pro subscription. */
export function assertProTransaction(tx: DecodedTransaction): asserts tx is DecodedTransaction & {
	transactionId: string;
	originalTransactionId: string;
	purchaseDate: number;
	expiresDate: number;
} {
	if (tx.productId !== APP_STORE_PRODUCT_ID) throw new Error("This App Store purchase is not SureWord Pro.");
	if (tx.type !== undefined && tx.type !== "Auto-Renewable Subscription")
		throw new Error("This App Store purchase is not a subscription.");
	if (!tx.transactionId || !tx.originalTransactionId) throw new Error("App Store transaction is missing its ids.");
	if (!Number.isFinite(tx.purchaseDate) || !Number.isFinite(tx.expiresDate))
		throw new Error("App Store transaction has no subscription period.");
	if ((tx.expiresDate as number) <= (tx.purchaseDate as number))
		throw new Error("App Store transaction has an invalid period.");
}

/**
 * State from a verified transaction, optionally with its renewal info.
 * A revoked transaction (refund, Family Sharing revoke) is never active.
 */
export function stateFromTransaction(
	tx: DecodedTransaction,
	renewal: DecodedRenewal | undefined,
	now: Date,
	previous?: Pick<AppStoreState, "cancelAtPeriodEnd">,
): AppStoreState {
	assertProTransaction(tx);
	const expires = new Date(tx.expiresDate);
	// Only consulted once the paid period has lapsed: Apple keeps access during
	// the billing grace period while it retries the renewal.
	const grace = Number.isFinite(renewal?.gracePeriodExpiresDate)
		? new Date(renewal?.gracePeriodExpiresDate as number)
		: null;
	let status: AppStoreStatus;
	let expiresAt = expires;
	if (tx.revocationDate !== undefined) status = "revoked";
	else if (expires > now) status = "active";
	else if (grace && grace > now) {
		status = "active";
		expiresAt = grace;
	} else if (renewal?.isInBillingRetryPeriod) status = "billing_retry";
	else status = "expired";
	return {
		status,
		periodStart: new Date(tx.purchaseDate),
		expiresAt,
		cancelAtPeriodEnd:
			renewal?.autoRenewStatus !== undefined ? renewal.autoRenewStatus === 0 : (previous?.cancelAtPeriodEnd ?? false),
		gracePeriodExpiresAt: status === "active" && expiresAt === grace ? grace : null,
		latestTransactionId: tx.transactionId,
		productId: tx.productId as string,
	};
}

/**
 * Whether a transaction the device sent should replace the stored row.
 * Notifications are authoritative for a transaction the server already knows,
 * so a device can never un-revoke a refunded purchase by replaying it, and an
 * older transaction (a restore) never rolls the period back.
 */
export function shouldApplyDeviceTransaction(existing: AppStoreRow | null, next: AppStoreState, now: Date): boolean {
	if (!existing) return true;
	if (next.latestTransactionId === existing.latestTransactionId) {
		return existing.status !== "revoked" && next.status === "revoked";
	}
	if (next.expiresAt > existing.expiresAt) return true;
	const existingActive = existing.status === "active" && existing.expiresAt > now;
	return !existingActive && next.status === "active" && next.expiresAt > now;
}

export const HANDLED_NOTIFICATION_TYPES = [
	"SUBSCRIBED",
	"DID_RENEW",
	"DID_FAIL_TO_RENEW",
	"EXPIRED",
	"GRACE_PERIOD_EXPIRED",
	"REFUND",
	"REVOKE",
	"DID_CHANGE_RENEWAL_STATUS",
] as const;

export interface DecodedNotification {
	notificationType?: string;
	subtype?: string;
	notificationUUID?: string;
	signedDate?: number;
	transaction?: DecodedTransaction;
	renewal?: DecodedRenewal;
}

export type NotificationDecision =
	| { kind: "update"; data: AppStoreState & { lastSignedAt: Date; lastNotificationType: string; lastNotificationSubtype: string | null } }
	| { kind: "ignore"; reason: "unhandled" | "stale" | "mismatch" };

/**
 * How one App Store Server Notification V2 moves an existing row. Pure: the
 * caller has already verified the signature, looked the row up by
 * originalTransactionId and checked idempotency by notificationUUID.
 */
export function applyNotification(row: AppStoreRow, notification: DecodedNotification, now: Date): NotificationDecision {
	const type = notification.notificationType ?? "";
	if (!(HANDLED_NOTIFICATION_TYPES as readonly string[]).includes(type)) return { kind: "ignore", reason: "unhandled" };
	const tx = notification.transaction;
	if (!tx || tx.originalTransactionId !== row.originalTransactionId || tx.productId !== APP_STORE_PRODUCT_ID)
		return { kind: "ignore", reason: "mismatch" };
	const signedAt = new Date(notification.signedDate ?? 0);
	// Apple does not guarantee delivery order; an older event never overwrites
	// a newer one.
	if (signedAt < row.lastSignedAt) return { kind: "ignore", reason: "stale" };
	const subtype = notification.subtype ?? null;
	let state: AppStoreState;
	try {
		state = stateFromTransaction(tx, notification.renewal, now, row);
	} catch {
		return { kind: "ignore", reason: "mismatch" };
	}
	switch (type) {
		case "SUBSCRIBED":
		case "DID_RENEW":
			break;
		case "DID_FAIL_TO_RENEW":
			if (state.status !== "revoked" && subtype !== "GRACE_PERIOD") {
				// No grace period: access ends at the lapsed expiry while Apple retries.
				state = { ...state, status: state.expiresAt > now ? "active" : "billing_retry", gracePeriodExpiresAt: null };
			}
			break;
		case "EXPIRED":
			state = { ...state, status: state.status === "revoked" ? "revoked" : "expired", gracePeriodExpiresAt: null };
			break;
		case "GRACE_PERIOD_EXPIRED":
			state = {
				...state,
				status: state.status === "revoked" ? "revoked" : "billing_retry",
				expiresAt: tx.expiresDate !== undefined ? new Date(tx.expiresDate) : state.expiresAt,
				gracePeriodExpiresAt: null,
			};
			break;
		case "REFUND":
		case "REVOKE":
			state = { ...state, status: "revoked", gracePeriodExpiresAt: null };
			break;
		case "DID_CHANGE_RENEWAL_STATUS":
			// Only the renewal flag moves; the period stays what it was.
			state = {
				...row,
				status: storedStatus(row.status),
				cancelAtPeriodEnd:
					subtype === "AUTO_RENEW_DISABLED" ? true : subtype === "AUTO_RENEW_ENABLED" ? false : row.cancelAtPeriodEnd,
			};
			break;
	}
	return {
		kind: "update",
		data: {
			status: state.status,
			periodStart: state.periodStart,
			expiresAt: state.expiresAt,
			cancelAtPeriodEnd: state.cancelAtPeriodEnd,
			gracePeriodExpiresAt: state.gracePeriodExpiresAt,
			latestTransactionId: state.latestTransactionId,
			productId: state.productId,
			lastSignedAt: signedAt,
			lastNotificationType: type,
			lastNotificationSubtype: subtype,
		},
	};
}

/** The row in the shape `accountSubscription` and the usage window read. */
export function asAccountSubscription(row: {
	status: string;
	periodStart: Date;
	expiresAt: Date;
	cancelAtPeriodEnd: boolean;
}) {
	return {
		status: row.status,
		periodStart: row.periodStart,
		periodEnd: row.expiresAt,
		cancelAtPeriodEnd: row.cancelAtPeriodEnd,
		provider: "app_store" as const,
	};
}

/** Pick the row that speaks for the account: an active one, else the latest. */
export function pickAppStoreRow<T extends { status: string; expiresAt: Date }>(rows: T[], now = new Date()): T | null {
	const active = rows.filter((row) => row.status === "active" && row.expiresAt > now);
	const pool = active.length ? active : rows;
	return pool.reduce<T | null>((best, row) => (!best || row.expiresAt > best.expiresAt ? row : best), null);
}

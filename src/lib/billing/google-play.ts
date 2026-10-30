import "server-only";

import { createHash, createPrivateKey, createSign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { GooglePlaySubscription, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import { activeSubscription } from "./plans";

export const GOOGLE_PLAY_PRODUCT_ID = "sureword_pro";
const PACKAGE_NAME = process.env.SUREWORD_PLAY_PACKAGE_NAME ?? "com.spragginsdesigns.sureword";

type PlayLineItem = { productId?: string; expiryTime?: string; latestSuccessfulOrderId?: string };
type PlayAccountIdentifiers = { obfuscatedExternalAccountId?: string };
export type PlaySubscription = {
  subscriptionState?: string;
  startTime?: string;
  lineItems?: PlayLineItem[];
  acknowledgementState?: string;
  externalAccountIdentifiers?: PlayAccountIdentifiers;
  linkedPurchaseToken?: string;
  outOfAppPurchaseContext?: { expiredExternalAccountIdentifiers?: PlayAccountIdentifiers; expiredPurchaseToken?: string };
};

export function userBinding(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function billingEnabled(): boolean {
  return process.env.SUREWORD_USAGE_ENABLED === "true" && process.env.SUREWORD_PLAY_BILLING_ENABLED === "true";
}

function serviceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Google Play service account is not configured.");
  const value = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!value.client_email || !value.private_key) throw new Error("Invalid Google Play service account.");
  return { client_email: value.client_email, private_key: value.private_key };
}

let accessToken: { value: string; expiresAt: number } | null = null;
async function googleAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const account = serviceAccount();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const input = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  const jwt = `${input}.${signer.sign(createPrivateKey(account.private_key)).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Google Play authorization failed.");
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google Play authorization returned no token.");
  accessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

class PlayPurchaseReadError extends Error {
  constructor(readonly status: number) { super("Google Play could not verify this purchase."); }
}

export async function getSubscription(purchaseToken: string): Promise<PlaySubscription> {
  const token = await googleAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new PlayPurchaseReadError(response.status);
  return (await response.json()) as PlaySubscription;
}

export async function acknowledgeSubscription(productId: string, purchaseToken: string, obfuscatedAccountId?: string): Promise<void> {
  const token = await googleAccessToken();
  const body = obfuscatedAccountId ? { externalAccountIds: { obfuscatedAccountId } } : {};
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  // A 409 is a concurrent update, not proof of acknowledgement. Let RTDN retry
  // and skip the POST once Google's next read reports ACKNOWLEDGED.
  if (!response.ok) throw new Error("Google Play acknowledgement failed.");
}

/** 404 and 410: Google no longer knows the token (long expired or never valid). */
const purchaseGone = (status: number) => status === 404 || status === 410;

/** Live subscriptionState for account deletion, or null when the token is gone. */
export async function readSubscriptionState(purchaseToken: string): Promise<string | null> {
  const token = await googleAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (purchaseGone(response.status)) return null;
  if (!response.ok) throw new Error(`Google Play subscription read failed (HTTP ${response.status}).`);
  const purchase = (await response.json()) as PlaySubscription;
  return purchase.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
}

/**
 * Turn renewal off before the account (and with it the only copy of the
 * purchase token) is deleted. purchases.subscriptions.cancel, not
 * subscriptionsv2.revoke: cancel is the server-side twin of the member
 * cancelling in Play (no further charges, nothing refunded), which matches the
 * Stripe side of deletion; revoke ends access at once and requires choosing a
 * refund, a money decision deletion should not make silently. It is the same
 * v1 per-product token path acknowledgeSubscription already uses.
 */
export async function cancelSubscriptionRenewal(productId: string, purchaseToken: string): Promise<void> {
  const token = await googleAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok && !purchaseGone(response.status)) throw new Error(`Google Play cancellation failed (HTTP ${response.status}).`);
}

type PreviousPeriod = Pick<GooglePlaySubscription, "periodStart" | "periodEnd"> & { latestSuccessfulOrderId?: string | null };

function previousMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function stateForPlayPurchase(purchase: PlaySubscription, now = new Date(), previous?: PreviousPeriod): { status: "active" | "revoked"; periodStart: Date; periodEnd: Date; cancelAtPeriodEnd: boolean; productId: string; latestSuccessfulOrderId: string | null } {
  const item = purchase.lineItems?.find((candidate) => candidate.productId === GOOGLE_PLAY_PRODUCT_ID);
  if (!item?.expiryTime) throw new Error("Google Play purchase does not contain SureWord Pro.");
  const periodEnd = new Date(item.expiryTime);
  if (Number.isNaN(periodEnd.getTime())) throw new Error("Google Play purchase has an invalid expiry.");
  const lifetimeStart = purchase.startTime ? new Date(purchase.startTime) : undefined;
  if (lifetimeStart && Number.isNaN(lifetimeStart.getTime())) throw new Error("Google Play purchase has an invalid start.");
  // V2 startTime is lifetime start. This parser's monthly estimate is replaced
  // before active persistence by validated Orders accounting or a retained bucket.
  const state = purchase.subscriptionState;
  // Grace expiry can move daily without a successful renewal. Repeated verification
  // of the same expiry must also keep the original usage bucket.
  const latestSuccessfulOrderId = item.latestSuccessfulOrderId ?? previous?.latestSuccessfulOrderId ?? null;
  const sameOrder = item.latestSuccessfulOrderId && item.latestSuccessfulOrderId === previous?.latestSuccessfulOrderId;
  const preservePeriod = previous && (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || sameOrder || periodEnd.getTime() === previous.periodEnd.getTime());
  let periodStart = preservePeriod ? new Date(previous.periodStart) : previousMonth(periodEnd);
  // A zero-price re-signup can change startTime and the token while keeping the
  // paid renewal date. A preserved usage bucket must survive that new startTime.
  if (!preservePeriod && lifetimeStart && lifetimeStart > periodStart) periodStart = lifetimeStart;
  if (periodStart >= periodEnd || (lifetimeStart && lifetimeStart >= periodEnd)) throw new Error("Google Play purchase has an invalid period.");
  const active = (state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || state === "SUBSCRIPTION_STATE_CANCELED") && periodEnd > now;
  return { status: active ? "active" : "revoked", periodStart, periodEnd, cancelAtPeriodEnd: state === "SUBSCRIPTION_STATE_CANCELED", productId: item.productId!, latestSuccessfulOrderId };
}

function previousPeriodForPurchase(purchase: PlaySubscription, current: GooglePlaySubscription | null, hash: string): PreviousPeriod | undefined {
  if (!current) return undefined;
  if (current.purchaseTokenHash === hash) return current;
  const linkedHash = purchase.linkedPurchaseToken ? tokenHash(purchase.linkedPurchaseToken) : undefined;
  const expiry = purchase.lineItems?.find((item) => item.productId === GOOGLE_PLAY_PRODUCT_ID)?.expiryTime;
  // Call only after ownership verification. A direct replacement with the same
  // expiry continues the paid period; a purchase after expiry starts a new one.
  return linkedHash === current.purchaseTokenHash && expiry && new Date(expiry).getTime() === current.periodEnd.getTime() ? current : undefined;
}

type PendingAcknowledgement = { obfuscatedAccountId?: string };
type PlayRefreshResult = { acknowledgement?: PendingAcknowledgement; accountingPending: boolean };

async function accountQuotaPeriod(purchase: PlaySubscription, purchaseToken: string, current: GooglePlaySubscription | null, state: ReturnType<typeof stateForPlayPurchase>) {
  if (state.status !== "active") return { state, accountingPending: false };
  const hash = tokenHash(purchaseToken);
  const sameAccountedOrder = current && current.lastVerifiedAt.getTime() > 0 && Boolean(current.latestSuccessfulOrderId) &&
    state.latestSuccessfulOrderId === current.latestSuccessfulOrderId;
  const unchangedReplacement = current && purchase.linkedPurchaseToken && state.periodEnd.getTime() === current.periodEnd.getTime() &&
    (current.purchaseTokenHash !== hash ? tokenHash(purchase.linkedPurchaseToken) === current.purchaseTokenHash :
      sameAccountedOrder && new Date(purchase.startTime ?? "") > current.periodStart);
  // A recovered paid order can share the previous grace expiry. Known tokens
  // preserve only an already-accounted order; epoch still requires Orders retry.
  // Grace extends access without buying a quota period. A zero-price token
  // replacement with the same renewal date also keeps the existing bucket.
  if (current && (purchase.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || unchangedReplacement))
    return { state: { ...state, periodStart: current.periodStart }, accountingPending: false };
  try {
    const orderId = purchase.lineItems?.find((item) => item.productId === GOOGLE_PLAY_PRODUCT_ID)?.latestSuccessfulOrderId;
    if (!orderId) throw new Error("Google Play accounting order is missing.");
    const access = await googleAccessToken();
    const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Google Play accounting order is unavailable.");
    const order = await response.json() as {
      orderId?: string; purchaseToken?: string;
      lineItems?: { productId?: string; subscriptionDetails?: { basePlanId?: string; servicePeriodStartTime?: string; servicePeriodEndTime?: string } }[];
    };
    const items = order.lineItems?.filter((item) => item.productId === GOOGLE_PLAY_PRODUCT_ID);
    const details = items?.length === 1 ? items[0].subscriptionDetails : undefined;
    const start = new Date(details?.servicePeriodStartTime ?? "");
    const end = new Date(details?.servicePeriodEndTime ?? "");
    if (order.orderId !== orderId || order.purchaseToken !== purchaseToken || details?.basePlanId !== "monthly" ||
      !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || start >= state.periodEnd || end > state.periodEnd)
      throw new Error("Google Play accounting order does not match this purchase.");
    // Orders funds the quota period; subscriptionsv2 still owns access expiry.
    // Re-reading the same order also repairs periods derived by older servers.
    return { state: { ...state, periodStart: start }, accountingPending: false };
  } catch {
    const lifetimeStart = purchase.startTime ? new Date(purchase.startTime) : undefined;
    return { state: { ...state, periodStart: current?.periodStart ?? lifetimeStart ?? state.periodStart }, accountingPending: true };
  }
}

// Failed optional accounting must retry on the next V2 refresh, even if the
// entitlement itself was successfully verified and committed just now.
const verificationTime = (accountingPending: boolean) => accountingPending ? new Date(0) : new Date();

function pendingAcknowledgement(purchase: PlaySubscription, userId: string): PendingAcknowledgement | undefined {
  if (purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING") return undefined;
  // Google removes the expired-account context after acknowledgement. Preserve
  // the verified account binding on Play-center resubscriptions for the next one.
  return purchase.outOfAppPurchaseContext ? { obfuscatedAccountId: userBinding(userId) } : {};
}

function predecessorHashes(purchase: PlaySubscription): string[] {
  return [purchase.linkedPurchaseToken, purchase.outOfAppPurchaseContext?.expiredPurchaseToken]
    .filter((token): token is string => Boolean(token)).map(tokenHash);
}

async function purchaseOwnershipError(tx: Prisma.TransactionClient, userId: string, hash: string, purchase: PlaySubscription, current: GooglePlaySubscription | null): Promise<string | null> {
  const expectedBinding = userBinding(userId);
  const binding = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  const expiredBinding = purchase.outOfAppPurchaseContext?.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId;
  if ((binding !== undefined && binding !== expectedBinding) || (expiredBinding !== undefined && expiredBinding !== expectedBinding)) return "This purchase is not bound to this account.";
  for (const predecessorHash of predecessorHashes(purchase)) {
    const predecessor = await tx.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: predecessorHash } });
    if (predecessor && predecessor.userId !== userId) return "This replacement purchase belongs to another account.";
  }
  const known = current?.purchaseTokenHash === hash;
  const newStart = new Date(purchase.startTime ?? "");
  const freshAfterExpiry = current && current.periodEnd <= new Date() && newStart >= current.periodEnd;
  const expiredHash = purchase.outOfAppPurchaseContext?.expiredPurchaseToken ? tokenHash(purchase.outOfAppPurchaseContext.expiredPurchaseToken) : undefined;
  // The expired token is an ownership hint only when it is still stored for this
  // account. A client-supplied token or matching hash alone cannot grant Pro.
  const expiredReplacement = current && expiredHash === current.purchaseTokenHash && expiredBinding === expectedBinding && freshAfterExpiry;
  if (!known && binding !== expectedBinding && !expiredReplacement) return "This purchase is not bound to this account.";
  if (current && !known) {
    const linkedHash = purchase.linkedPurchaseToken ? tokenHash(purchase.linkedPurchaseToken) : undefined;
    if (linkedHash !== current.purchaseTokenHash && !freshAfterExpiry) return "This purchase does not replace the account's current subscription.";
  }
  return null;
}

async function competingSubscriptionError(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  // Existing paid periods still matter when a store's new checkout is disabled.
  const [stripe, appStore] = await Promise.all([
    tx.billingSubscription.findUnique({ where: { userId } }),
    tx.appStoreSubscription.findFirst({ where: { userId, status: "active", expiresAt: { gt: new Date() } }, select: { id: true } }),
  ]);
  if (stripe && activeSubscription(stripe)) return "An active web subscription already exists for this account.";
  if (appStore) return "An active App Store subscription already exists for this account.";
  return null;
}

export async function verifyAndBindPurchase(userId: string, purchaseToken: string, productId: string): Promise<void> {
  if (productId !== GOOGLE_PLAY_PRODUCT_ID || !purchaseToken || purchaseToken.length > 512) throw new Error("Invalid Google Play purchase.");
  const hash = tokenHash(purchaseToken);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: hash } });
    if (existing && existing.userId !== userId) throw new Error("This purchase belongs to another account.");
    const current = await tx.googlePlaySubscription.findUnique({ where: { userId } });
    // Restore and renew an existing Play relationship even if legacy duplicate
    // billing exists. A new Play relationship must not add another paid store.
    if (!current || (current.purchaseTokenHash !== hash && !activeSubscription(current))) {
      const conflict = await competingSubscriptionError(tx, userId);
      if (conflict) throw new Error(conflict);
    }
    // Read Google only after acquiring the lock. A delayed RTDN cannot commit a
    // snapshot taken before a more recent refresh of this user's subscription.
    const purchase = await getSubscription(purchaseToken);
    const ownershipError = await purchaseOwnershipError(tx, userId, hash, purchase, current);
    if (ownershipError) throw new Error(ownershipError);
    let state: ReturnType<typeof stateForPlayPurchase>;
    try {
      state = stateForPlayPurchase(purchase, new Date(), previousPeriodForPurchase(purchase, current, hash));
    } catch (error) {
      if (!existing) throw error;
      await revokeBoundPurchase(tx, userId);
      return { active: false, acknowledgement: undefined };
    }
    if (state.status === "revoked") {
      if (existing) await tx.googlePlaySubscription.update({ where: { userId }, data: { ...state, lastVerifiedAt: new Date() } });
      return { active: false, acknowledgement: undefined };
    }
    const accounted = await accountQuotaPeriod(purchase, purchaseToken, current, state);
    await tx.googlePlaySubscription.upsert({ where: { userId }, update: { purchaseTokenHash: hash, encryptedPurchaseToken: encryptSecret(purchaseToken), ...accounted.state, lastVerifiedAt: verificationTime(accounted.accountingPending) }, create: { userId, purchaseTokenHash: hash, encryptedPurchaseToken: encryptSecret(purchaseToken), ...accounted.state, lastVerifiedAt: verificationTime(accounted.accountingPending) } });
    return { active: true, acknowledgement: pendingAcknowledgement(purchase, userId) };
  }, { timeout: 45_000 });
  // Throw after commit so an invalid known purchase actually loses entitlement.
  if (!result.active) throw new Error("This Google Play subscription is not active.");
  if (result.acknowledgement) await acknowledgeSubscription(GOOGLE_PLAY_PRODUCT_ID, purchaseToken, result.acknowledgement.obfuscatedAccountId);
}

async function revokeBoundPurchase(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.googlePlaySubscription.update({ where: { userId }, data: { status: "revoked", cancelAtPeriodEnd: false, lastVerifiedAt: new Date() } });
}

async function refreshLockedPurchase(tx: Prisma.TransactionClient, current: GooglePlaySubscription, purchaseToken: string): Promise<PlayRefreshResult> {
  // Transport/auth failures throw before any mutation. A successfully fetched
  // malformed entitlement is different: revoke the bound row atomically.
  const purchase = await getSubscription(purchaseToken);
  const ownershipError = await purchaseOwnershipError(tx, current.userId, current.purchaseTokenHash, purchase, current);
  let state: ReturnType<typeof stateForPlayPurchase>;
  try {
    if (ownershipError) throw new Error(ownershipError);
    state = stateForPlayPurchase(purchase, new Date(), current);
  } catch {
    await revokeBoundPurchase(tx, current.userId);
    return { accountingPending: false };
  }
  const accounted = await accountQuotaPeriod(purchase, purchaseToken, current, state);
  await tx.googlePlaySubscription.update({ where: { userId: current.userId }, data: { ...accounted.state, lastVerifiedAt: verificationTime(accounted.accountingPending) } });
  return { accountingPending: accounted.accountingPending, acknowledgement: state.status === "active" ? pendingAcknowledgement(purchase, current.userId) : undefined };
}

export async function refreshBoundPurchase(purchaseToken: string): Promise<void> {
  const hash = tokenHash(purchaseToken);
  let existing = await prisma.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: hash } });
  if (!existing) {
    // An RTDN can be the first sighting of a Play-center resubscription. This
    // unlocked read discovers the owner only. Never persist its snapshot.
    let discovery: PlaySubscription;
    try { discovery = await getSubscription(purchaseToken); } catch (error) {
      // Old replaced tokens eventually disappear from Google. They cannot affect
      // any bound row and must not cause endless Pub/Sub redelivery.
      if (error instanceof PlayPurchaseReadError && purchaseGone(error.status)) return;
      throw error;
    }
    for (const predecessorHash of predecessorHashes(discovery)) {
      existing = await prisma.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: predecessorHash } });
      if (existing) break;
    }
  }
  if (!existing) return;
  const owner = existing;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId} FOR UPDATE`;
    const current = await tx.googlePlaySubscription.findUnique({ where: { userId: owner.userId } });
    if (!current || current.purchaseTokenHash !== owner.purchaseTokenHash) return;
    if (current.purchaseTokenHash === hash) return refreshLockedPurchase(tx, current, purchaseToken);
    const purchase = await getSubscription(purchaseToken);
    // Discovery cannot authorize a new token. Recheck both the current chain and
    // Google's account evidence under the same lock used by authenticated bind.
    if (!predecessorHashes(purchase).includes(current.purchaseTokenHash)) return;
    if (await purchaseOwnershipError(tx, current.userId, hash, purchase, current)) return;
    if (!activeSubscription(current) && await competingSubscriptionError(tx, current.userId)) return;
    let state: ReturnType<typeof stateForPlayPurchase>;
    try { state = stateForPlayPurchase(purchase, new Date(), previousPeriodForPurchase(purchase, current, hash)); } catch { return; }
    if (state.status !== "active") return;
    const accounted = await accountQuotaPeriod(purchase, purchaseToken, current, state);
    await tx.googlePlaySubscription.update({ where: { userId: current.userId }, data: { purchaseTokenHash: hash, encryptedPurchaseToken: encryptSecret(purchaseToken), ...accounted.state, lastVerifiedAt: verificationTime(accounted.accountingPending) } });
    return { accountingPending: accounted.accountingPending, acknowledgement: pendingAcknowledgement(purchase, current.userId) };
  }, { timeout: 45_000 });
  // Keep the verified binding committed if acknowledgement fails. Throw so
  // Pub/Sub redelivers and retries instead of silently allowing a refund.
  if (result?.acknowledgement) await acknowledgeSubscription(GOOGLE_PLAY_PRODUCT_ID, purchaseToken, result.acknowledgement.obfuscatedAccountId);
  if (result?.accountingPending) throw new Error("Google Play accounting retry required.");
}

function freshVerification(current: GooglePlaySubscription): boolean {
  return current.lastVerifiedAt > new Date(Date.now() - 5 * 60_000) && (current.status !== "active" || current.periodEnd > new Date());
}

/** Refresh a user's Play entitlement when its cached verification is stale.
 * A failed subscription read or decryption leaves the last known row untouched so a
 * transient outage cannot revoke a paid user. The caller can then apply the
 * normal expiry check to that unchanged authoritative snapshot.
 * Acknowledgement errors keep the freshly verified row and are retried on a
 * later refresh or RTDN delivery.
 * Resolves true only when the row was re-read from Google.
 */
export async function refreshGooglePlaySubscription(userId: string): Promise<boolean> {
  // Disabling new checkout must not stop existing paid receipts from renewing.
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()) return false;
  let refreshed = false;
  try {
    const existing = await prisma.googlePlaySubscription.findUnique({ where: { userId } });
    if (!existing || freshVerification(existing)) return false;
    let purchaseToken: string | undefined;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.googlePlaySubscription.findUnique({ where: { userId } });
      if (!current || freshVerification(current)) return;
      purchaseToken = decryptSecret(current.encryptedPurchaseToken);
      return refreshLockedPurchase(tx, current, purchaseToken);
    }, { timeout: 45_000 });
    // Only a committed verification lets callers re-read the paid state. A
    // later acknowledgement failure must not hide that successful renewal.
    refreshed = Boolean(result);
    if (result?.acknowledgement && purchaseToken) await acknowledgeSubscription(GOOGLE_PLAY_PRODUCT_ID, purchaseToken, result.acknowledgement.obfuscatedAccountId);
  } catch {
    // Keep committed entitlement updates visible while acknowledgement retries.
    return refreshed;
  }
  return refreshed;
}

const oidcClient = new OAuth2Client();

export async function verifyRtdnOidc(rawToken: string): Promise<Record<string, unknown>> {
  const audience = process.env.SUREWORD_PLAY_RTDN_AUDIENCE?.trim();
  const email = process.env.SUREWORD_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim();
  if (!audience || !email) throw new Error("RTDN claims configuration is missing.");
  const segments = rawToken.split(".");
  if (segments.length !== 3 || segments.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid RTDN token.");
  const header = JSON.parse(Buffer.from(segments[0], "base64url").toString()) as { alg?: string };
  if (header.alg !== "RS256") throw new Error("Invalid RTDN claims.");
  const ticket = await oidcClient.verifyIdToken({ idToken: rawToken, audience });
  const payload = ticket.getPayload();
  if (!payload || payload.aud !== audience || payload.email !== email || payload.email_verified !== true || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) throw new Error("Invalid RTDN claims.");
  return { ...payload };
}

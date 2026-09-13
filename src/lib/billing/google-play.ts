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
export type PlaySubscription = {
  subscriptionState?: string;
  startTime?: string;
  lineItems?: PlayLineItem[];
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  linkedPurchaseToken?: string;
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

export async function getSubscription(purchaseToken: string): Promise<PlaySubscription> {
  const token = await googleAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Google Play could not verify this purchase.");
  return (await response.json()) as PlaySubscription;
}

export async function acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void> {
  const token = await googleAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  if (!response.ok && response.status !== 409) throw new Error("Google Play acknowledgement failed.");
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
  // SureWord Pro is a monthly base plan. startTime is the subscription lifetime
  // start, so derive the current quota period from its current expiry.
  const state = purchase.subscriptionState;
  // Grace expiry can move daily without a successful renewal. Repeated verification
  // of the same expiry must also keep the original usage bucket.
  const latestSuccessfulOrderId = item.latestSuccessfulOrderId ?? previous?.latestSuccessfulOrderId ?? null;
  const sameOrder = item.latestSuccessfulOrderId && item.latestSuccessfulOrderId === previous?.latestSuccessfulOrderId;
  const preservePeriod = previous && (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || sameOrder || periodEnd.getTime() === previous.periodEnd.getTime());
  let periodStart = preservePeriod ? new Date(previous.periodStart) : previousMonth(periodEnd);
  if (lifetimeStart && lifetimeStart > periodStart) periodStart = lifetimeStart;
  if (periodStart >= periodEnd) throw new Error("Google Play purchase has an invalid period.");
  const active = (state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || state === "SUBSCRIPTION_STATE_CANCELED") && periodEnd > now;
  return { status: active ? "active" : "revoked", periodStart, periodEnd, cancelAtPeriodEnd: state === "SUBSCRIPTION_STATE_CANCELED", productId: item.productId!, latestSuccessfulOrderId };
}

export async function verifyAndBindPurchase(userId: string, purchaseToken: string, productId: string): Promise<void> {
  if (productId !== GOOGLE_PLAY_PRODUCT_ID || !purchaseToken || purchaseToken.length > 512) throw new Error("Invalid Google Play purchase.");
  const hash = tokenHash(purchaseToken);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const stripe = await tx.billingSubscription.findUnique({ where: { userId } });
    if (stripe && activeSubscription(stripe)) throw new Error("An active web subscription already exists for this account.");
    const existing = await tx.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: hash } });
    if (existing && existing.userId !== userId) throw new Error("This purchase belongs to another account.");
    const current = await tx.googlePlaySubscription.findUnique({ where: { userId } });
    // Read Google only after acquiring the lock. A delayed RTDN cannot commit a
    // snapshot taken before a more recent refresh of this user's subscription.
    const purchase = await getSubscription(purchaseToken);
    const binding = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if ((!existing || binding !== undefined) && binding !== userBinding(userId)) throw new Error("This purchase is not bound to this account.");
    const linkedHash = purchase.linkedPurchaseToken ? tokenHash(purchase.linkedPurchaseToken) : undefined;
    if (linkedHash) {
      const linked = await tx.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: linkedHash } });
      if (linked && linked.userId !== userId) throw new Error("This replacement purchase belongs to another account.");
    }
    if (current && current.purchaseTokenHash !== hash) {
      const newStart = new Date(purchase.startTime ?? "");
      const freshAfterExpiry = current.periodEnd <= new Date() && newStart >= current.periodEnd;
      if (linkedHash !== current.purchaseTokenHash && !freshAfterExpiry) throw new Error("This purchase does not replace the account's current subscription.");
    }
    let state: ReturnType<typeof stateForPlayPurchase>;
    try {
      state = stateForPlayPurchase(purchase, new Date(), current?.purchaseTokenHash === hash ? current : undefined);
    } catch (error) {
      if (!existing) throw error;
      await revokeBoundPurchase(tx, userId);
      return { active: false, acknowledge: false };
    }
    if (state.status === "revoked") {
      if (existing) await tx.googlePlaySubscription.update({ where: { userId }, data: { ...state, lastVerifiedAt: new Date() } });
      return { active: false, acknowledge: false };
    }
    await tx.googlePlaySubscription.upsert({ where: { userId }, update: { purchaseTokenHash: hash, encryptedPurchaseToken: encryptSecret(purchaseToken), ...state, lastVerifiedAt: new Date() }, create: { userId, purchaseTokenHash: hash, encryptedPurchaseToken: encryptSecret(purchaseToken), ...state, lastVerifiedAt: new Date() } });
    return { active: true, acknowledge: purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" };
  }, { timeout: 45_000 });
  // Throw after commit so an invalid known purchase actually loses entitlement.
  if (!result.active) throw new Error("This Google Play subscription is not active.");
  if (result.acknowledge) await acknowledgeSubscription(GOOGLE_PLAY_PRODUCT_ID, purchaseToken);
}

async function revokeBoundPurchase(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.googlePlaySubscription.update({ where: { userId }, data: { status: "revoked", cancelAtPeriodEnd: false, lastVerifiedAt: new Date() } });
}

async function refreshLockedPurchase(tx: Prisma.TransactionClient, current: GooglePlaySubscription, purchaseToken: string): Promise<void> {
  // Transport/auth failures throw before any mutation. A successfully fetched
  // malformed entitlement is different: revoke the bound row atomically.
  const purchase = await getSubscription(purchaseToken);
  let state: ReturnType<typeof stateForPlayPurchase>;
  try {
    const binding = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (binding !== undefined && binding !== userBinding(current.userId)) throw new Error("Invalid account binding.");
    state = stateForPlayPurchase(purchase, new Date(), current);
  } catch {
    await revokeBoundPurchase(tx, current.userId);
    return;
  }
  await tx.googlePlaySubscription.update({ where: { userId: current.userId }, data: { ...state, lastVerifiedAt: new Date() } });
}

export async function refreshBoundPurchase(purchaseToken: string): Promise<void> {
  const hash = tokenHash(purchaseToken);
  const existing = await prisma.googlePlaySubscription.findUnique({ where: { purchaseTokenHash: hash } });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${existing.userId} FOR UPDATE`;
    const current = await tx.googlePlaySubscription.findUnique({ where: { userId: existing.userId } });
    if (!current || current.purchaseTokenHash !== hash) return;
    await refreshLockedPurchase(tx, current, purchaseToken);
  }, { timeout: 45_000 });
}

/** Refresh a user's Play entitlement when its cached verification is stale.
 * A failed Google/API/decryption call leaves the last known row untouched so a
 * transient outage cannot revoke a paid user. The caller can then apply the
 * normal expiry check to that unchanged authoritative snapshot.
 */
export async function refreshGooglePlaySubscription(userId: string): Promise<void> {
  if (!billingEnabled()) return;
  try {
    const existing = await prisma.googlePlaySubscription.findUnique({ where: { userId } });
    if (!existing || existing.lastVerifiedAt > new Date(Date.now() - 5 * 60_000)) return;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.googlePlaySubscription.findUnique({ where: { userId } });
      if (!current || current.lastVerifiedAt > new Date(Date.now() - 5 * 60_000)) return;
      await refreshLockedPurchase(tx, current, decryptSecret(current.encryptedPurchaseToken));
    }, { timeout: 45_000 });
  } catch {
    // Preserve the last verified state on transient failures.
  }
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

/**
 * The rules behind "Try before you sign up" (docs/FEATURES.md).
 *
 * Pure apart from `node:crypto`, so tests/guest-rules.test.mjs imports it
 * directly through Node's type stripper, the same way shared-answer.ts is
 * tested. The routes own the database; this module decides what the rows
 * mean.
 */
import { createHmac, randomBytes } from "node:crypto";

/** httpOnly cookie holding the random guest id the turns are filed under. */
export const GUEST_COOKIE = "sw_guest";

/** How long the cookie, and so an unclaimed guest trail, is kept. */
export const GUEST_RETENTION_DAYS = 30;

/** Answers a guest gets before the sign-up card, per rolling 24 hours. */
export const GUEST_ANSWERS_PER_DAY = 3;

/** The window both the per-guest and per-address ceilings count over. */
export const GUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Guest answers across everybody per UTC day. This is the ceiling that bounds
 * the bill: per-guest and per-address counts only share it out fairly, since a
 * cleared cookie or a new mobile address resets both. `GUEST_DAILY_CAP=0`
 * turns guest answers off without a deploy.
 */
export const DEFAULT_GUEST_DAILY_CAP = 150;

/** Long enough for a real question, short enough that it is never a paste. */
export const MAX_GUEST_QUESTION_LENGTH = 1000;

const GUEST_ID_BYTES = 16;
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TITLE_LENGTH = 60;

export function createGuestId(): string {
	return randomBytes(GUEST_ID_BYTES).toString("base64url");
}

export function isGuestId(value: unknown): value is string {
	return typeof value === "string" && GUEST_ID_PATTERN.test(value);
}

/** `GUEST_DAILY_CAP` as a non-negative integer, or the default when unset or malformed. */
export function guestDailyCap(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_GUEST_DAILY_CAP;
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_GUEST_DAILY_CAP;
}

/** The question as it will be stored and sent, or null when it cannot be asked. */
export function normalizeGuestQuestion(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.replace(/\r\n?/g, "\n").trim();
	if (!trimmed || trimmed.length > MAX_GUEST_QUESTION_LENGTH) return null;
	return trimmed;
}

/**
 * The address is keyed, never stored: an HMAC under a server secret, so the
 * column cannot be reversed by hashing the IPv4 space.
 */
export function guestIpHash(ip: string, secret: string): string {
	return createHmac("sha256", secret).update(`guest-ip:${ip}`).digest("hex");
}

export type GuestLimitReason = "guest" | "address" | "global";

export interface GuestQuotaDecision {
	allowed: boolean;
	reason: GuestLimitReason | null;
	/** Answers this guest has left after this one, when allowed. */
	remaining: number;
}

/**
 * Counts INCLUDE the row just reserved for this request: the route writes
 * first and counts second, so two requests racing for the last answer both
 * see each other and neither slips past the ceiling.
 */
export function guestQuotaDecision(counts: {
	guest: number;
	address: number;
	global: number;
	cap: number;
}): GuestQuotaDecision {
	if (counts.cap <= 0 || counts.global > counts.cap) {
		return { allowed: false, reason: "global", remaining: 0 };
	}
	if (counts.guest > GUEST_ANSWERS_PER_DAY) {
		return { allowed: false, reason: "guest", remaining: 0 };
	}
	if (counts.address > GUEST_ANSWERS_PER_DAY) {
		return { allowed: false, reason: "address", remaining: 0 };
	}
	return {
		allowed: true,
		reason: null,
		remaining: Math.max(0, GUEST_ANSWERS_PER_DAY - Math.max(counts.guest, counts.address)),
	};
}

/** The saved conversation's title: the first question, on one line, clipped. */
export function guestConversationTitle(question: string): string {
	const line = question.replace(/\s+/g, " ").trim();
	if (line.length <= TITLE_LENGTH) return line || "New Conversation";
	const head = line.slice(0, TITLE_LENGTH - 1);
	const lastSpace = head.lastIndexOf(" ");
	return `${(lastSpace > TITLE_LENGTH / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/**
 * Appended to the chat system prompt for a guest. The persona and every
 * Scripture rule are the chat prompt's own; this only removes what a guest
 * cannot have and keeps the first impression readable.
 */
export const GUEST_SYSTEM_GUIDANCE = `GUEST CONTEXT: This reader is trying SureWord from the website without an account. You have no memories, notes, highlights, reading history or church for them, and no tools that save anything, so never offer to save, remember, highlight, add to a note, or set a reminder. Answer the question itself warmly from Scripture in under 400 words. This is a hard limit, including when the reader asks for something longer: if a request cannot fit (a whole book, a chapter-by-chapter commentary, a long essay), give a focused overview of its heart and end with one narrower follow-up question they could ask next. Do not mention accounts, signing up, or limits; the page handles that.`;

/**
 * Share an answer, browser half (docs/FEATURES.md, "Share an answer: a public
 * page, and a card image").
 *
 * A share is a capability handed to somebody else, so the browser never mints
 * one: it asks `/api/shared` for the link and shows whatever the route returns.
 * This module is the only place the web client talks to those routes, and it
 * holds no React so the rules stay testable on their own, exactly as
 * `feedback-client.ts` does for the thumbs.
 */

/** What POST /api/shared answers with: the link for one assistant answer. */
export interface SharedAnswerLink {
	id: string;
	url: string;
	createdAt: string;
}

/** A row of GET /api/shared, for Settings -> Shared answers. */
export interface SharedAnswerSummary {
	id: string;
	url: string;
	question: string;
	createdAt: string;
	revokedAt: string | null;
}

/**
 * What `presentShareLink` actually did. "dismissed" is its own outcome because
 * a reader who closes the share sheet has not failed at anything, and must not
 * be told a link was copied.
 */
export type ShareOutcome = "shared" | "copied" | "dismissed";

/** The share sheet's descriptive line: long enough to recognise, short enough to read. */
export const SHARE_TEXT_MAX_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asText(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** The route's own wording wherever it gave one; it is written for a reader. */
function routeError(body: unknown): string | null {
	return isRecord(body) ? asText(body.error) : null;
}

async function readBody(response: Response): Promise<unknown> {
	return response.json().catch(() => null);
}

/**
 * Mint (or reuse) the public link for one settled assistant answer.
 *
 * The route is idempotent on the message, so a second tap on an answer that is
 * already shared returns the same id rather than a second capability for the
 * same text. Nothing here caches that: the round trip is one row and no model
 * call, and a stale local link would survive a revoke.
 */
export async function shareAnswer(
	conversationId: string,
	messageId: string
): Promise<SharedAnswerLink> {
	const response = await fetch("/api/shared", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ conversationId, messageId }),
	});

	const body = await readBody(response);
	if (!response.ok) {
		throw new Error(routeError(body) ?? `Could not create a link (${response.status}).`);
	}
	const id = isRecord(body) ? asText(body.id) : null;
	const url = isRecord(body) ? asText(body.url) : null;
	if (!id || !url) throw new Error("Could not create a link.");

	return { id, url, createdAt: (isRecord(body) ? asText(body.createdAt) : null) ?? "" };
}

/** Every link this reader has ever minted, newest first, revoked ones included. */
export async function listShares(): Promise<SharedAnswerSummary[]> {
	const response = await fetch("/api/shared", { credentials: "same-origin" });
	const body = await readBody(response);
	if (!response.ok) {
		throw new Error(routeError(body) ?? `Could not load your shared answers (${response.status}).`);
	}

	const rows = isRecord(body) && Array.isArray(body.shares) ? body.shares : [];
	const shares: SharedAnswerSummary[] = [];
	for (const row of rows) {
		if (!isRecord(row)) continue;
		const id = asText(row.id);
		const url = asText(row.url);
		if (!id || !url) continue;
		shares.push({
			id,
			url,
			question: asText(row.question) ?? "",
			createdAt: asText(row.createdAt) ?? "",
			revokedAt: asText(row.revokedAt),
		});
	}
	return shares;
}

/** Take a link back. The row survives, stamped, so the list can still show it. */
export async function revokeShare(id: string): Promise<void> {
	const response = await fetch(`/api/shared/${encodeURIComponent(id)}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (!response.ok) {
		const body = await readBody(response);
		throw new Error(routeError(body) ?? `Could not revoke that link (${response.status}).`);
	}
}

/**
 * The one line that travels beside the link in a share sheet. Markdown is left
 * alone beyond the whitespace: the sheet shows a preview, and stripping syntax
 * here would be a second, drifting copy of the renderer's rules.
 */
export function shareSheetText(source: string): string {
	const text = source.replace(/\s+/g, " ").trim();
	if (text.length <= SHARE_TEXT_MAX_LENGTH) return text;
	return `${text.slice(0, SHARE_TEXT_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Hand the link to the reader: the system share sheet where the browser has
 * one, the clipboard everywhere else. Desktop Chrome and Firefox have no
 * `navigator.share`, so the clipboard is the common path rather than the
 * exception, and the caller shows "Link copied" for it.
 */
export async function presentShareLink(payload: {
	title: string;
	text: string;
	url: string;
}): Promise<ShareOutcome> {
	if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
		try {
			await navigator.share(payload);
			return "shared";
		} catch (error) {
			// A dismissed sheet is the reader changing their mind. Copying behind
			// their back would be a surprise, so only a real failure falls through
			// to the clipboard.
			if (error instanceof Error && error.name === "AbortError") return "dismissed";
		}
	}
	await navigator.clipboard.writeText(payload.url);
	return "copied";
}

/**
 * What a Ways to Serve button does on the web (docs/FEATURES.md, GitHub issue
 * #28). The server decides which ways a reader sees and what each one says;
 * this only maps a way's `action` onto a web destination, so the page and the
 * Today card stay thin and the mapping is pinned by
 * `tests/serve-actions.test.mjs`.
 *
 * Import-free (type imports only) so `node --test` can load it directly.
 */

import type { WayAction } from "@/lib/serve-rules";

export interface ServeActionWay {
	title: string;
	action: WayAction;
	verse: { reference: string };
}

export interface ServeActionContext {
	/** The server offered the nearby search (mode includes nearby and Places is configured). */
	nearbyAvailable: boolean;
	/** The reader's saved church website, or null. */
	churchWebsite: string | null;
}

export type ServeActionTarget =
	| { type: "send-word"; reference: string }
	| { type: "chat"; href: string }
	| { type: "focus"; section: "nearby" | "journal" }
	| { type: "link"; href: string; external: boolean };

/** Where SureWord's chat opens with the composer filled in, never sent. */
export function chatPrefillHref(prompt: string): string {
	return `/?prompt=${encodeURIComponent(prompt)}`;
}

export const PRAY_PROMPT = "I want to pray for someone by name today.";
export const NEARBY_FALLBACK_PROMPT = "Where could I help or give near me?";
export const MY_CHURCH_HREF = "/settings#church";

export function sendVersePrompt(reference: string): string {
	return `Help me send someone ${reference} with a word of encouragement`;
}

export function reachOutPrompt(title: string): string {
	return `Help me write a kind message to ${title.toLowerCase()}.`;
}

/** Only http(s) church sites open from the page; anything else is ignored. */
function safeExternal(url: string | null): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The button's destination, or null when the way has no button here (no
 * action, or "Give to your church" without a church website to open).
 */
export function serveActionTarget(way: ServeActionWay, context: ServeActionContext): ServeActionTarget | null {
	const reference = way.verse.reference.trim();
	switch (way.action) {
		case "share-verse":
			return reference
				? { type: "send-word", reference }
				: { type: "chat", href: chatPrefillHref(sendVersePrompt("a verse")) };
		case "pray":
			return { type: "chat", href: chatPrefillHref(PRAY_PROMPT) };
		case "reach-out":
			return { type: "chat", href: chatPrefillHref(reachOutPrompt(way.title)) };
		case "nearby":
		case "give-need":
			return context.nearbyAvailable
				? { type: "focus", section: "nearby" }
				: { type: "chat", href: chatPrefillHref(NEARBY_FALLBACK_PROMPT) };
		case "church":
			return { type: "link", href: MY_CHURCH_HREF, external: false };
		case "give-church": {
			const href = safeExternal(context.churchWebsite);
			return href ? { type: "link", href, external: true } : null;
		}
		case "journal":
			return { type: "focus", section: "journal" };
		default:
			return null;
	}
}

/** The button's words; the way's own title already says what it is. */
export function serveActionLabel(action: WayAction, target: ServeActionTarget): string {
	switch (action) {
		case "share-verse":
			return target.type === "send-word" ? "Send a verse" : "Help me send one";
		case "pray":
			return "Pray with SureWord";
		case "reach-out":
			return "Help me write it";
		case "nearby":
		case "give-need":
			return target.type === "focus" ? "Find places near me" : "Ask SureWord";
		case "church":
			return "Open My church";
		case "give-church":
			return "Visit church website";
		case "journal":
			return "Write it down";
		default:
			return "Open";
	}
}

/**
 * One label for consecutive verses in one chapter ("Ephesians 2:8" through
 * "Ephesians 2:10" reads "Ephesians 2:8-10"); anything else is listed as is.
 */
export function verseRangeLabel(references: readonly string[]): string {
	if (references.length < 2) return references[0] ?? "";
	const parsed = references.map((reference) => /^(.+\s\d+):(\d+)$/.exec(reference.trim()));
	const chapter = parsed[0]?.[1];
	const consecutive = parsed.every(
		(match, index) => match !== null && match[1] === chapter && Number(match[2]) === Number(parsed[0]?.[2]) + index
	);
	if (!consecutive || !chapter) return references.join("; ");
	return `${chapter}:${parsed[0]?.[2]}-${parsed[parsed.length - 1]?.[2]}`;
}

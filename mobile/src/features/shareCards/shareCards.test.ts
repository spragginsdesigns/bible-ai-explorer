import { describe, expect, it } from "vitest";
import {
	SHARE_CARD_DESIGN_VERSION,
	canDrawCard,
	cardVerseCount,
	cardNeedsSession,
	cardTranslation,
	parseStoredShareCardPrefs,
	shareCardFileName,
	shareCardPath,
	verseDoorUrl,
	verseSlug,
	type ShareCardTarget,
} from "./shareCards";

const verse: ShareCardTarget = { kind: "verse", reference: "Psalms 23:1-4", translation: "KJV" };
const cross: ShareCardTarget = { kind: "cross", id: "cmabc123def456ghi789", reference: "Isaiah 41:10" };
const answer: ShareCardTarget = { kind: "answer", conversationId: "c1", messageId: "m1" };

function query(path: string | null): URLSearchParams {
	expect(path).not.toBeNull();
	return new URL(path as string, "https://sureword.app").searchParams;
}

describe("share card paths", () => {
	it("asks the public verse route by reference, never by text", () => {
		const path = shareCardPath(verse, { style: "parchment", format: "square", size: "preview" });
		expect(path?.startsWith("/api/cards/verse?")).toBe(true);
		const params = query(path);
		expect(params.get("ref")).toBe("Psalms 23:1-4");
		expect(params.get("translation")).toBe("KJV");
		expect(params.get("style")).toBe("parchment");
		expect(params.get("format")).toBe("square");
		expect(params.get("size")).toBe("preview");
		expect(params.get("v")).toBe(SHARE_CARD_DESIGN_VERSION);
		expect(params.has("text")).toBe(false);
	});

	it("builds the server's canonical query, note included, so a card never costs a redirect", () => {
		const path = shareCardPath(verse, { style: "dawn", format: "story", size: "preview", note: true });
		expect(path).toBe(`/api/cards/verse?ref=Psalms+23%3A1-4&translation=KJV&style=dawn&format=story&note=1&size=preview&v=${SHARE_CARD_DESIGN_VERSION}`);
	});

	it("omits size for the full card, which is what gets shared", () => {
		expect(query(shareCardPath(verse, { style: "dawn", format: "story", size: "full" })).has("size")).toBe(false);
	});

	it("sends the device zone with the personal cross card", () => {
		const path = shareCardPath(cross, { style: "dawn", format: "story", size: "full", timeZone: "America/Chicago" });
		expect(path?.startsWith("/api/cards/cross/cmabc123def456ghi789?")).toBe(true);
		expect(query(path).get("tz")).toBe("America/Chicago");
	});

	it("has no answer card until its public link exists", () => {
		expect(shareCardPath(answer, { style: "dawn", format: "story", size: "full" })).toBeNull();
		const path = shareCardPath(answer, { style: "sanctuary", format: "story", size: "full" }, "abcDEF123ghi456J");
		expect(path?.startsWith("/api/shared/abcDEF123ghi456J/image?")).toBe(true);
	});

	it("draws only the translations the server can look up", () => {
		expect(cardTranslation("nkjv")).toBe("NKJV");
		expect(cardTranslation("LC Greek")).toBeNull();
		expect(canDrawCard({ kind: "verse", reference: "John 1:1", translation: "LC Greek" })).toBe(false);
		expect(canDrawCard({ kind: "verse", reference: "John 1:1", translation: "" })).toBe(false);
		expect(shareCardPath({ kind: "verse", reference: "John 1:1", translation: "LC Greek" }, { style: "dawn", format: "story", size: "full" })).toBeNull();
		expect(canDrawCard(cross)).toBe(true);
		expect(canDrawCard(answer)).toBe(true);
	});

	it("shares a passage longer than a card as text, with no door that would 404", () => {
		expect(cardVerseCount("1 Corinthians 13:1-13")).toBe(13);
		expect(cardVerseCount("John 3:16")).toBe(1);
		expect(cardVerseCount("Psalms 23:1-4")).toBe(4);
		expect(canDrawCard({ kind: "verse", reference: "1 Corinthians 13:1-13", translation: "KJV" })).toBe(false);
		expect(canDrawCard({ kind: "verse", reference: "Romans 8:31-40", translation: "KJV" })).toBe(true);
		expect(verseDoorUrl("1 Corinthians 13:1-13")).toBeNull();
	});

	it("sends the session only for the personal card", () => {
		expect(cardNeedsSession(cross)).toBe(true);
		expect(cardNeedsSession(verse)).toBe(false);
		expect(cardNeedsSession(answer)).toBe(false);
	});
});

describe("share card details", () => {
	it("points the door at the passage's public page", () => {
		expect(verseSlug("1 John 1:9")).toBe("1-john-1-9");
		expect(verseSlug("Song of Solomon 2:1-3")).toBe("song-of-solomon-2-1-3");
		expect(verseDoorUrl("Psalms 23:1-4")).toBe("https://sureword.app/v/psalms-23-1-4");
	});

	it("names the file after what it shows, safely", () => {
		expect(shareCardFileName(verse, "dawn", "story")).toBe("SureWord Psalms 23-1-4 dawn story.jpg");
		expect(shareCardFileName(answer, "parchment", "square")).toBe("SureWord Answer parchment square.jpg");
	});

	it("remembers a valid style and size, and ignores anything else", () => {
		expect(parseStoredShareCardPrefs(JSON.stringify({ style: "sanctuary", format: "square" }))).toEqual({
			style: "sanctuary",
			format: "square",
			encourage: true,
		});
		expect(parseStoredShareCardPrefs(JSON.stringify({ style: "neon", format: "wide" }))).toEqual({
			style: "dawn",
			format: "story",
			encourage: true,
		});
		expect(parseStoredShareCardPrefs("{not json")).toEqual({ style: "dawn", format: "story", encourage: true });
		expect(parseStoredShareCardPrefs(null)).toEqual({ style: "dawn", format: "story", encourage: true });
		expect(parseStoredShareCardPrefs(JSON.stringify({ encourage: false })).encourage).toBe(false);
	});
});

/**
 * Web routes for receipt targets. The contract lives in docs/FEATURES.md
 * ("Receipts: one line for everything the assistant saves"); the parser that
 * produces the targets is src/lib/chat/receipts.ts.
 *
 * Pure and React-free so tests can import it directly. Every URL shape here
 * already exists in the app: the chapter shape mirrors
 * `chapterHrefForReference` in src/lib/chat/verseActions.ts, and the settings
 * anchors are the section ids listed in
 * src/components/settings/SettingsSectionNav.tsx.
 */
import type { ChatReceiptTarget } from "./receipts";

/**
 * Settings has no "preferences" anchor: the preference rows are spread over
 * Appearance, Bible translation and Web search, so a preference receipt lands
 * on the page itself rather than claiming a section that does not exist.
 */
const SETTINGS_SECTION_HASH: Record<NonNullable<Extract<ChatReceiptTarget, { screen: "settings" }>["section"]>, string> = {
	memory: "#memory",
	church: "#church",
	preferences: "",
};

/** The href a receipt fragment navigates to. Total over every target shape. */
export function receiptHref(target: ChatReceiptTarget): string {
	switch (target.screen) {
		case "note":
			// The notes page auto-selects the note named by ?note=.
			return `/notes?note=${encodeURIComponent(target.noteId)}`;
		case "memories":
			// Memory lives in a dialog on Settings, so a single memory is not
			// separately addressable; the section anchor is as close as web gets.
			return "/settings#memory";
		case "chapter": {
			const params = new URLSearchParams({
				book: String(target.book),
				chapter: String(target.chapter),
			});
			if (target.verse !== undefined) params.set("verse", String(target.verse));
			if (target.translation !== undefined) params.set("translation", target.translation);
			return `/bible/chapter?${params.toString()}`;
		}
		case "plan":
			return "/bible/plan";
		case "readingHistory":
			return "/bible/history";
		case "cross":
			return "/cross";
		case "learn":
			return "/bible/learn";
		case "settings":
			return `/settings${target.section ? SETTINGS_SECTION_HASH[target.section] : ""}`;
	}
}

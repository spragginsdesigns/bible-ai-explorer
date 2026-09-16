/**
 * Where a receipt fragment goes when it is tapped. The receipts contract lives
 * in docs/FEATURES.md ("Receipts: one line for everything the assistant
 * saves"); this module is the Android half of "each fragment navigates by its
 * parsed target".
 *
 * Pure on purpose: no React, no router instance, no side effects, so every
 * target shape is asserted in receiptRoutes.test.ts without a renderer. The
 * caller (ReceiptLine) does the one impure thing, `router.push`.
 */
import type { ChatReceiptTarget } from "@/lib/receipts";

/**
 * The reader route's params, exactly as `readerRouteParams` in
 * `@/features/chat/verseActions` builds them (book/chapter/verse stringified,
 * optional source translation). Rebuilt here rather than imported because
 * verseActions pulls in `react-native` and `expo-clipboard`, which the Node
 * vitest environment cannot load; change one and change the other.
 */
type ChapterRouteParams = {
	book: string;
	chapter: string;
	verse?: string;
	translation?: "KJV" | "NKJV" | "BSB";
};

/**
 * Every href a receipt can produce. Written as literal pathnames so expo-router's
 * generated typed routes check each one: a route renamed under `app/(app)` fails
 * the typecheck here instead of dead-ending on a tap.
 */
export type ReceiptHref =
	| { pathname: "/notes/[id]"; params: { id: string } }
	| { pathname: "/(app)/memories" }
	| { pathname: "/bible/chapter"; params: ChapterRouteParams }
	| { pathname: "/(app)/bible/plan" }
	| { pathname: "/bible/history" }
	| { pathname: "/(app)/bible/cross" }
	| { pathname: "/(app)/bible/learn" }
	| { pathname: "/(app)/settings" };

export interface ReceiptNavigation {
	href: ReceiptHref;
	/**
	 * `true` only for Cross, which lives in the nested `bible` stack: the Cross
	 * card and the Bible home both push it with an anchor so Back returns to the
	 * stack's first screen rather than unwinding to a bare tab root.
	 */
	withAnchor?: true;
}

/**
 * The route for one receipt target.
 *
 * `memories` carries a `memoryId` that this route deliberately drops: the
 * memories screen takes no row param, so the fragment opens the list. The undo
 * affordance, not the route, is what acts on that single memory.
 */
export function receiptNavigation(target: ChatReceiptTarget): ReceiptNavigation {
	switch (target.screen) {
		case "note":
			return { href: { pathname: "/notes/[id]", params: { id: target.noteId } } };
		case "memories":
			return { href: { pathname: "/(app)/memories" } };
		case "chapter":
			return {
				href: {
					pathname: "/bible/chapter",
					params: {
						book: String(target.book),
						chapter: String(target.chapter),
						...(target.verse ? { verse: String(target.verse) } : {}),
						...(target.translation ? { translation: target.translation } : {}),
					},
				},
			};
		case "plan":
			return { href: { pathname: "/(app)/bible/plan" } };
		case "readingHistory":
			return { href: { pathname: "/bible/history" } };
		case "cross":
			return { href: { pathname: "/(app)/bible/cross" }, withAnchor: true };
		case "learn":
			return { href: { pathname: "/(app)/bible/learn" } };
		case "settings":
			return { href: { pathname: "/(app)/settings" } };
	}
}

/**
 * The spoken half of a fragment's accessibility label: the receipt's own label
 * says what happened, this says where the tap goes. TalkBack reads
 * "Saved to Romans study. Opens the note."
 */
export function receiptDestinationLabel(target: ChatReceiptTarget): string {
	switch (target.screen) {
		case "note":
			return "Opens the note.";
		case "memories":
			return "Opens your memories.";
		case "chapter":
			return "Opens the chapter in the Bible reader.";
		case "plan":
			return "Opens your reading plan.";
		case "readingHistory":
			return "Opens your reading history.";
		case "cross":
			return "Opens Pick Up Your Cross.";
		case "learn":
			return "Opens Learn.";
		case "settings":
			return "Opens Settings.";
	}
}

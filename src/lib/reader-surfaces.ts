/**
 * The Bible reader's pages (LC-17770): the sheet a chapter is read on, chosen
 * in Settings → Appearance the way Chessmaster let you pick a board. Every page
 * has a light and a dark face that follow the site theme; their colours live
 * in globals.css as `.reader-page-<id>`. "Plain" is no sheet at all, which is
 * the synced parchment switch turned off.
 *
 * Pure, with no imports, so tests load it with Node's type stripping.
 */

export const READER_SURFACES = [
	{ id: "parchment", label: "Parchment", note: "Aged scroll paper" },
	{ id: "vellum", label: "Vellum", note: "Smooth warm cream" },
	{ id: "paper", label: "Paper", note: "A crisp printed page" },
	{ id: "linen", label: "Linen", note: "Fine woven cloth" },
	{ id: "olive", label: "Olive Grove", note: "Soft garden green" },
	{ id: "stone", label: "Jerusalem Stone", note: "Warm limestone" },
	{ id: "twilight", label: "Twilight", note: "Cool evening blue" },
] as const;

export type ReaderSurfaceId = (typeof READER_SURFACES)[number]["id"];

/** A page, or "plain" for the reader with no sheet. */
export type ReaderPageChoice = ReaderSurfaceId | "plain";

export const DEFAULT_READER_SURFACE: ReaderSurfaceId = "parchment";

export const PLAIN_READER_PAGE = { id: "plain", label: "Plain", note: "Just the text" } as const;

/** A stored value as a page id; anything unknown is the default parchment. */
export function parseReaderSurface(raw: unknown): ReaderSurfaceId {
	return READER_SURFACES.find((surface) => surface.id === raw)?.id ?? DEFAULT_READER_SURFACE;
}

/** What the reader draws: the chosen page while the sheet is on, else plain. */
export function readerPageChoice(sheetOn: boolean, surface: ReaderSurfaceId): ReaderPageChoice {
	return sheetOn ? surface : "plain";
}

export function readerPageLabel(choice: ReaderPageChoice): string {
	if (choice === "plain") return PLAIN_READER_PAGE.label;
	return READER_SURFACES.find((surface) => surface.id === choice)?.label ?? PLAIN_READER_PAGE.label;
}

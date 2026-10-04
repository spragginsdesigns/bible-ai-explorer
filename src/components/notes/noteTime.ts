const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact "3h ago" style timestamp used on note cards, the wikilink picker and
 * backlinks. Mirrors Android's relativeTime (mobile/src/features/notes/utils.ts).
 */
export function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const diff = Date.now() - then;
	if (diff < MINUTE) return "Just now";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;

	const date = new Date(then);
	const thisYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(thisYear ? {} : { year: "numeric" }),
	});
}

/** "3h ago · 120 words", the card meta line Android shows under each note. */
export function noteMetaLine(updatedAt: string, wordCount: number): string {
	const time = relativeTime(updatedAt);
	return wordCount > 0 ? `${time} · ${wordCount} words` : time;
}

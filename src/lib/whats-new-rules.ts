/**
 * Pure rules for SureWord's release notes ("What's new"): parsing the public
 * half of `mobile/CHANGELOG.md`, joining it with the hand-written editorial
 * layer, and choosing what the once-per-release catch-up sheet shows.
 *
 * Import-free on purpose, like `preferences-contract.ts`: the sync script
 * (`scripts/sync-whats-new.mjs`) and `tests/whats-new.test.mjs` load it under
 * plain Node with type stripping.
 *
 * Only the `**What's new (Play):**` block of each entry is ever published.
 * That block is already written for readers and goes to Google Play verbatim;
 * the Dev notes beside it name migrations, security fixes and internals, and
 * must never reach this page. Entries before 1.19.0 (versionCode 13) have no
 * Play block and are summarised once in the editorial "beginning" card.
 */

export type WhatsNewKind = "new" | "improved" | "fixed";

export interface WhatsNewSection {
	kind: WhatsNewKind;
	items: string[];
}

/** One published release, exactly as the changelog's Play block says it. */
export interface WhatsNewRelease {
	version: string;
	versionCode: number;
	/** YYYY-MM-DD, from the entry heading. */
	date: string;
	sections: WhatsNewSection[];
}

/**
 * Features a catch-up card can open. Named rather than pathed because web and
 * Android place them differently (web /sermons, Android /study/sermons).
 */
export const WHATS_NEW_TARGETS = [
	"today",
	"bible",
	"chat",
	"connections",
	"study",
	"sermons",
	"cross",
	"learn",
	"plan",
	"history",
	"timeline",
] as const;

export type WhatsNewTarget = (typeof WHATS_NEW_TARGETS)[number];

/** A KJV verse that sits under a release, quoted exactly. */
export interface WhatsNewVerse {
	text: string;
	reference: string;
}

/**
 * The editorial layer, keyed by version. Everything here is optional except
 * what the sidebar needs; every word must come from the release's documented
 * notes, never from a guess about why something changed.
 */
export interface WhatsNewEditorial {
	/** Short label for the release list ("Connections"). */
	title?: string;
	/** The reading-pane headline ("See how Scripture is woven together."). */
	headline?: string;
	/** One or two sentences of documented reasons. */
	why?: string;
	verse?: WhatsNewVerse;
	/** The feature the catch-up card's "Try it" opens; each client maps it to its own route. */
	target?: WhatsNewTarget;
}

export interface WhatsNewEditorialFile {
	releases: Record<string, WhatsNewEditorial>;
	beginning: {
		title: string;
		dateRange: string;
		summary: string;
		items: string[];
	};
}

/** A release joined with its editorial layer, ready for any client to render. */
export interface WhatsNewEntry extends WhatsNewRelease {
	title: string;
	headline: string | null;
	why: string | null;
	verse: WhatsNewVerse | null;
	target: WhatsNewTarget | null;
}

/** One card in the "Since you were last here" sheet. */
export interface CatchUpCard {
	version: string;
	versionCode: number;
	title: string;
	summary: string;
	target: WhatsNewTarget | null;
}

export interface CatchUp {
	/** Newest first, at most `max`. Empty means the sheet stays closed. */
	cards: CatchUpCard[];
	/** How many releases since the reader's last visit added something new. */
	newReleaseCount: number;
	/** What to record as seen once the sheet is dismissed. */
	seenUpTo: number;
}

/** The first entry with a Play block; everything older is the "beginning" card. */
export const FIRST_PUBLIC_VERSION_CODE = 13;

export const CATCH_UP_MAX_CARDS = 3;

const HEADING = /^## (\d+\.\d+\.\d+) \(versionCode (\d+)\) - (\d{4}-\d{2}-\d{2})/;
const KIND_LINES: Record<string, WhatsNewKind> = { NEW: "new", IMPROVED: "improved", FIXED: "fixed" };
const KIND_ORDER: WhatsNewKind[] = ["new", "improved", "fixed"];

/**
 * Every published release in the changelog, newest first. A version that was
 * built twice (1.61.0 is versionCodes 63 and 64) becomes one release under its
 * newest code, so a permalink by version is never ambiguous.
 */
export function parseChangelog(markdown: string): WhatsNewRelease[] {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const byVersion = new Map<string, WhatsNewRelease>();

	for (let i = 0; i < lines.length; i++) {
		const heading = HEADING.exec(lines[i]);
		if (!heading) continue;
		const [, version, code, date] = heading;
		const versionCode = Number(code);
		if (versionCode < FIRST_PUBLIC_VERSION_CODE) continue;

		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			if (/^## /.test(lines[j])) {
				end = j;
				break;
			}
		}
		const sections = parsePlayBlock(lines.slice(i + 1, end));
		if (sections.length === 0) continue;

		const existing = byVersion.get(version);
		if (!existing) {
			byVersion.set(version, { version, versionCode, date, sections });
			continue;
		}
		const newer = versionCode > existing.versionCode;
		byVersion.set(version, {
			version,
			versionCode: Math.max(versionCode, existing.versionCode),
			date: newer ? date : existing.date,
			sections: mergeSections(newer ? [sections, existing.sections] : [existing.sections, sections]),
		});
	}

	return [...byVersion.values()].sort((a, b) => b.versionCode - a.versionCode);
}

function parsePlayBlock(entry: string[]): WhatsNewSection[] {
	const start = entry.findIndex((l) => /^\*\*What's new \(Play\):?\*\*/.test(l));
	if (start < 0) return [];
	const sections: WhatsNewSection[] = [];
	let current: WhatsNewSection | null = null;

	for (const raw of entry.slice(start + 1)) {
		if (/^\*\*Dev notes/.test(raw) || /^---\s*$/.test(raw) || /^#/.test(raw)) break;
		const line = raw.trim();
		if (!line) continue;
		const kind = KIND_LINES[line];
		if (kind) {
			current = { kind, items: [] };
			sections.push(current);
			continue;
		}
		const item = line.replace(/^[-*]\s+/, "").trim();
		if (!item) continue;
		if (!current) {
			// A block with no NEW/IMPROVED/FIXED line (some early builds) is a
			// list of improvements; it never feeds the catch-up sheet.
			current = { kind: "improved", items: [] };
			sections.push(current);
		}
		if (/^[-*]\s/.test(line) || current.items.length === 0) current.items.push(item);
		else current.items[current.items.length - 1] += ` ${item}`;
	}

	return mergeSections([sections.filter((s) => s.items.length > 0)]);
}

function mergeSections(groups: WhatsNewSection[][]): WhatsNewSection[] {
	return KIND_ORDER.flatMap((kind) => {
		const items = groups.flatMap((g) => g.filter((s) => s.kind === kind).flatMap((s) => s.items));
		return items.length ? [{ kind, items }] : [];
	});
}

/**
 * A short list label when the editorial layer has none: the lead-in before a
 * colon ("Connections: a new tab ..." -> "Connections"), otherwise the first
 * item clipped at a word boundary.
 */
export function fallbackTitle(release: WhatsNewRelease): string {
	const first = release.sections[0]?.items[0] ?? `SureWord ${release.version}`;
	const colon = first.indexOf(":");
	if (colon > 0 && colon <= 40) return first.slice(0, colon).trim();
	const sentence = first.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
	if (sentence.length <= 48) return sentence;
	const clipped = sentence.slice(0, 48);
	return `${clipped.slice(0, clipped.lastIndexOf(" "))}...`;
}

export function joinEditorial(releases: WhatsNewRelease[], editorial: WhatsNewEditorialFile): WhatsNewEntry[] {
	return releases.map((release) => {
		const extra = editorial.releases[release.version] ?? {};
		return {
			...release,
			title: extra.title ?? fallbackTitle(release),
			headline: extra.headline ?? null,
			why: extra.why ?? null,
			verse: extra.verse ?? null,
			target: extra.target ?? null,
		};
	});
}

/**
 * What the catch-up sheet shows to someone who last saw `seenCode`.
 *
 * - `seenCode` null means a brand-new account: nothing to catch up on, and the
 *   caller records `seenUpTo` (the newest release under the cap, not the
 *   newest published) as seen so day one is never interrupted.
 * - `upToCode` caps the list at what this client actually has installed: an
 *   Android build that has not updated yet must not announce features it lacks.
 * - Only releases with a NEW section count; a fixes-only release never opens
 *   the sheet, though dismissing it still marks those releases seen.
 */
export function catchUpFor(
	entries: WhatsNewEntry[],
	seenCode: number | null,
	upToCode: number | null = null,
	max = CATCH_UP_MAX_CARDS
): CatchUp {
	const available = entries.filter((e) => upToCode == null || e.versionCode <= upToCode);
	const newest = available.reduce((top, e) => Math.max(top, e.versionCode), 0);
	if (seenCode == null) return { cards: [], newReleaseCount: 0, seenUpTo: newest };

	const fresh = available
		.filter((e) => e.versionCode > seenCode)
		.filter((e) => e.sections.some((s) => s.kind === "new"))
		.sort((a, b) => b.versionCode - a.versionCode);

	return {
		cards: fresh.slice(0, max).map((e) => ({
			version: e.version,
			versionCode: e.versionCode,
			title: e.title,
			summary: e.sections.find((s) => s.kind === "new")?.items[0] ?? "",
			target: e.target,
		})),
		newReleaseCount: fresh.length,
		seenUpTo: Math.max(seenCode, newest),
	};
}

/** Releases newer than a version the reader picks in "Catch me up". */
export function releasesSince(entries: WhatsNewEntry[], sinceCode: number): WhatsNewEntry[] {
	return entries.filter((e) => e.versionCode > sinceCode);
}

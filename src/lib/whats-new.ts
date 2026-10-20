import releasesFile from "@/content/whats-new/releases.json";
import editorialFile from "@/content/whats-new/editorial.json";
import {
	joinEditorial,
	type WhatsNewEditorialFile,
	type WhatsNewEntry,
	type WhatsNewRelease,
} from "./whats-new-rules";

/**
 * SureWord's published release notes, joined with the editorial layer. Both
 * files are committed: `releases.json` is generated from mobile/CHANGELOG.md
 * by `scripts/sync-whats-new.mjs` and `editorial.json` is written by hand
 * (rules in src/lib/whats-new-rules.ts). Served to every client by
 * `GET /api/whats-new` and rendered on the web at /whats-new.
 */
const editorial = editorialFile as WhatsNewEditorialFile;

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = joinEditorial(
	(releasesFile as { releases: WhatsNewRelease[] }).releases,
	editorial
);

export const WHATS_NEW_BEGINNING = editorial.beginning;

export const NEWEST_VERSION_CODE = WHATS_NEW_ENTRIES[0]?.versionCode ?? 0;

export function findEntry(version: string): WhatsNewEntry | undefined {
	return WHATS_NEW_ENTRIES.find((e) => e.version === version);
}

/**
 * Pure presentation rules for the Timeline, People & Places screens - what an
 * entry is called in a list, what the era chips say, and the words the "Ask
 * about this" button puts in the chat box.
 *
 * Kept out of the screens so the fiddly parts are tested directly. Mirrors
 * `src/components/atlas/atlasView.ts` on web.
 */
import { ATLAS_ERAS, type AtlasEntityView, type AtlasEra, type AtlasEraGroup, type AtlasEventView, type AtlasSearchHit } from "./atlasCore";

/** "People", "Places", "Events" - what a search hit is. */
const KIND_LABELS: Record<AtlasSearchHit["kind"], string> = {
	person: "Person",
	place: "Place",
	event: "Event",
};

export function hitKindLabel(kind: AtlasSearchHit["kind"]): string {
	return KIND_LABELS[kind];
}

/**
 * The short form of an era for a chip: the leading word or two, so nine of
 * them fit across a phone. "Creation & the Patriarchs" → "Patriarchs".
 */
const ERA_CHIPS: Record<AtlasEra, string> = {
	"Creation & the Patriarchs": "Patriarchs",
	"Egypt & the Exodus": "Exodus",
	"Conquest & Judges": "Judges",
	"United Kingdom": "Kingdom",
	"Divided Kingdom": "Divided",
	"Exile & Return": "Exile",
	"Between the Testaments": "Silence",
	"Life of Christ": "Christ",
	"The Early Church": "Church",
};

export function eraChipLabel(era: AtlasEra): string {
	return ERA_CHIPS[era];
}

/** Every era chip, in order, with the label the chip shows. */
export function eraChips(): { era: AtlasEra; label: string }[] {
	return ATLAS_ERAS.map((era) => ({ era, label: ERA_CHIPS[era] }));
}

/** "c. 4004 BC · Creation & the Patriarchs" */
export function eventCaption(event: AtlasEventView): string {
	return `${event.yearLabel} · ${event.era}`;
}

/** The line under an entity's name: what it is, and where it sits. */
export function entitySubtitle(entity: AtlasEntityView): string {
	const parts: string[] = [entity.kind === "person" ? "Person" : "Place"];
	if (entity.era) parts.push(entity.era);
	if (entity.modernRegion) parts.push(entity.modernRegion);
	return parts.join(" · ");
}

/** "Also called Abram" - or empty, when Scripture uses one name only. */
export function alsoCalledLine(entity: AtlasEntityView): string {
	if (entity.alsoCalled.length === 0) return "";
	return `Also called ${entity.alsoCalled.join(", ")}`;
}

/** How many events and connections an entry has, for a one-line footer. */
export function entityCounts(entity: AtlasEntityView): string {
	const parts: string[] = [`${entity.refs.length} key ${entity.refs.length === 1 ? "verse" : "verses"}`];
	if (entity.events.length > 0) {
		parts.push(`${entity.events.length} ${entity.events.length === 1 ? "event" : "events"}`);
	}
	return parts.join(" · ");
}

/**
 * The prompt "Ask about this" drops into the chat box. It names the thing and
 * asks the question the user actually has, so they can send it as it stands or
 * edit it first - the chat screen never sends it for them.
 */
export function askPromptForEntity(entity: AtlasEntityView): string {
	return entity.kind === "person"
		? `Who was ${entity.name} in the Bible, and what can I learn from them?`
		: `What happened at ${entity.name} in the Bible?`;
}

/** The same, for an event: its title and when it is traditionally dated. */
export function askPromptForEvent(event: AtlasEventView): string {
	return `Tell me about ${event.title} (${event.yearLabel}) from the KJV.`;
}

/** "12 events" / "1 event" - the count under an era heading. */
export function eraEventCount(group: AtlasEraGroup): string {
	return `${group.events.length} ${group.events.length === 1 ? "event" : "events"}`;
}

/**
 * What the screen says when a filter finds nothing. The chapter case is the
 * one users hit most, so it says which chapter rather than "no results".
 */
export function emptyTimelineMessage(scope: { book?: string; chapter?: number; era?: string }): string {
	if (scope.book && scope.chapter) {
		return `The atlas has no events, people or places recorded in ${scope.book} ${scope.chapter}.`;
	}
	if (scope.book) return `The atlas has no events recorded in ${scope.book}.`;
	if (scope.era) return `No events on the timeline for ${scope.era}.`;
	return "No events on the timeline.";
}

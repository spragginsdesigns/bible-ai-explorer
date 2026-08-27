/**
 * Pure presentation rules for Timeline, People & Places on web - what an entry
 * is called in a list, what the era chips say, and the words the "Ask about
 * this" button puts in the chat box.
 *
 * Mirrors `mobile/src/features/atlas/atlasView.ts`; keep the two in step, the
 * way `planView.ts` is kept in step. The shapes come from the server module,
 * as types only, so nothing of the atlas itself reaches the browser bundle.
 */
import type {
  AtlasEntityView,
  AtlasEra,
  AtlasEraGroup,
  AtlasEventDate,
  AtlasEventView,
  AtlasSearchHit,
} from "@/lib/bible/atlas-core";

const KIND_LABELS: Record<AtlasSearchHit["kind"], string> = {
  person: "Person",
  place: "Place",
  event: "Event",
};

export function hitKindLabel(kind: AtlasSearchHit["kind"]): string {
  return KIND_LABELS[kind];
}

/**
 * The short form of an era for a chip, so all nine fit on one row.
 * "Creation & the Patriarchs" → "Patriarchs".
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

export function eraChipLabel(era: string): string {
  return ERA_CHIPS[era as AtlasEra] ?? era;
}

/** "c. 4004 BC · Creation & the Patriarchs" */
export function eventCaption(event: AtlasEventView): string {
  return `${event.yearLabel} · ${event.era}`;
}

/** Display dates without presenting an inferred Ussher date as Scripture. */
export function atlasDateLabel(
  date: AtlasEventDate | null | undefined,
  yearLabel?: string,
): string {
  if (date?.provenance === "undated") return "Date not given";
  const label = date?.label ?? yearLabel;
  if (
    !label ||
    /^(?:undated|unknown|date not given|n\/a)$/i.test(label.trim())
  ) {
    return "Date not given";
  }
  return date?.provenance === "scripture-explicit"
    ? label
    : `Traditional chronology · ${label}`;
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

/** How many verses and events an entry has, for a one-line footer. */
export function entityCounts(entity: AtlasEntityView): string {
  const parts: string[] = [
    `${entity.refs.length} key ${entity.refs.length === 1 ? "verse" : "verses"}`,
  ];
  if (entity.events.length > 0) {
    parts.push(
      `${entity.events.length} ${entity.events.length === 1 ? "event" : "events"}`,
    );
  }
  return parts.join(" · ");
}

/**
 * The prompt "Ask about this" drops into the chat box. It names the thing and
 * asks the question the user actually has; sending it is still their move.
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

/** "12 events" / "1 event" - the count beside an era heading. */
export function eraEventCount(group: AtlasEraGroup): string {
  return `${group.events.length} ${group.events.length === 1 ? "event" : "events"}`;
}

/** What the screen says when a filter finds nothing. */
export function emptyTimelineMessage(scope: {
  book?: string;
  chapter?: number;
  era?: string;
}): string {
  if (scope.book && scope.chapter) {
    return `The atlas has no events, people or places recorded in ${scope.book} ${scope.chapter}.`;
  }
  if (scope.book) return `The atlas has no events recorded in ${scope.book}.`;
  if (scope.era) return `No events on the timeline for ${scope.era}.`;
  return "No events on the timeline.";
}

/** The footnote that keeps the Ussher dates honest, shown under the timeline. */
export const USSHER_NOTE =
  "Dates follow the traditional Ussher chronology carried in the margins of the King James Bible. They are a reckoning from the genealogies of Scripture, not part of the text itself.";

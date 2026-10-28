/**
 * The narrated KJV (the "audio Bible"): the shared contract for the
 * `/api/bible/audio` route and every client's chapter player.
 *
 * Every chapter is one pre-rendered MP3 plus the start and end of each verse
 * in it, narrated once by LineCrush's Fish Audio pipeline
 * (`backend/scripts/fish_audio_bible.py` in Context-Pro-AI, LC-15116) and
 * hosted in our S3 media bucket. Nothing is generated when someone presses
 * play, so listening is free for every account. The whole Bible is narrated:
 * the New Testament since LC-15116, the Old Testament since LC-15317.
 */

/**
 * Where the chapter MP3s and their verse timings live: `<base>/<book>/<chapter>.mp3|json`.
 * The bucket serves them with a day-long cache, so a re-render goes to a new
 * version folder rather than over the old files: v2 re-reads the New
 * Testament verses with parentheses or with wording changed by the 1769 text
 * rebuild, and a few that a transcription screen heard invented words in
 * (LC-15328).
 */
export const AUDIO_BIBLE_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/kjv/v2";

/** Book orders with narration: Genesis (1) through Revelation (66). */
export const NARRATED_BOOKS = { first: 1, last: 66 } as const;

/**
 * Books played as a full-cast production (a voice for every speaker, quiet
 * ambience, effects and music) instead of the single narrator, from their own
 * folder with the same per-chapter MP3 and verse timings. Matthew since
 * LC-15323; the narrated recording stays under AUDIO_BIBLE_BASE_URL.
 */
export const DRAMATIZED_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/kjv-drama/v1";
export const DRAMATIZED_BOOKS: ReadonlySet<number> = new Set([40]);

/**
 * Which recording of a chapter to play. "regular" is the book's usual one
 * above (the narrated KJV, or Matthew's full cast). "alive" is a second
 * recording offered beside it on Listen (LC-15532): a full-cast production
 * with no outside narrator. It keeps the KJV's verse numbering, so the
 * read-along highlight follows it verse for verse while the KJV stays on
 * screen.
 */
export type AudioEdition = "regular" | "alive";

/**
 * The text an Alive recording reads. "ASV" is the American Standard Version
 * (LC-17797), the text every Alive book is recorded on. "LC Greek" is
 * SureWord's own translation of the Textus Receptus, which the first four
 * Alive books read (Mark LC-15532, Matthew LC-15843, Luke LC-15844, John
 * LC-15845) until their ASV recordings replace them.
 */
export type AliveText = "ASV" | "LC Greek";

/** The ASV Alive recordings, `<base>/<book>/<chapter>.mp3|json` (LC-17800). */
export const ALIVE_ASV_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/alive-asv/v1";
/** The LC Greek Alive recordings of Matthew to John. */
export const ALIVE_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/alive/v1";
export const LC_GREEK_ALIVE_BOOKS: ReadonlySet<number> = new Set([40, 41, 42, 43]);

/**
 * Where `/api/bible/audio?edition=alive` looks for a chapter, in order: the
 * ASV folder, then the LC Greek folder for Matthew to John. There is no list
 * of books: a chapter has Alive when its recording is uploaded, and clients
 * ask the API rather than deciding per book (LC-17800).
 */
export function aliveSources(book: number): AliveText[] {
  return LC_GREEK_ALIVE_BOOKS.has(book) ? ["ASV", "LC Greek"] : ["ASV"];
}

/** How each recording is named in the Listen choice, the same on every client. */
export const EDITION_CHOICES: Record<AudioEdition, { label: string }> = {
  regular: { label: "Regular" },
  alive: { label: "Alive" },
};

/** The line under each recording in the Listen choice, naming the text it reads. */
export const EDITION_DETAILS = {
  regular: "The King James Version, read aloud",
  ASV: "Full cast, in the American Standard Version",
  "LC Greek": "Full cast, in our LC Greek translation",
} as const;

/** A recording's Listen detail. An Alive answer without `text` predates LC-17800 and reads the LC Greek. */
export function editionDetail(edition: AudioEdition, text?: AliveText | null): string {
  return edition === "alive" ? EDITION_DETAILS[text ?? "LC Greek"] : EDITION_DETAILS.regular;
}

/**
 * Listen recommends Alive wherever a book has it (LC-15842): the choice lists
 * it first, highlighted and marked with RECOMMENDED_LABEL.
 */
export const RECOMMENDED_EDITION: AudioEdition = "alive";
export const RECOMMENDED_LABEL = "Recommended";
/** The order every client lists the recordings in: the recommended one first. */
export const LISTEN_ORDER: readonly AudioEdition[] = ["alive", "regular"];

/**
 * The LC Greek (LC-15842): SureWord's own modern-English translation of the
 * Textus Receptus, Matthew to John only. The reader offers it beside its
 * translations on those books, verse for verse in the KJV's numbering. It is
 * a reading text only: highlights, Explain, Learn and Ask AI keep working on
 * the KJV verse with the same number. The source of each book is
 * Context-Pro-AI's docs/creative/sureword-audio-bible/<book>-alive/.
 */
export const LC_GREEK = {
  label: "LC Greek",
  note: "Our own translation of the Greek",
  /** Appended to the note while the chapter's Alive recording still reads the LC Greek. */
  aliveNote: "the text Alive reads",
  copyright: "SureWord's own translation of the Textus Receptus",
} as const;

export function hasLcGreek(book: number): boolean {
  return LC_GREEK_ALIVE_BOOKS.has(book);
}

/** The note under the LC Greek chip, given the text this chapter's Alive recording reads (if any). */
export function lcGreekNote(aliveText: AliveText | null | undefined): string {
  return aliveText === "LC Greek" ? `${LC_GREEK.note} · ${LC_GREEK.aliveNote}` : LC_GREEK.note;
}

export type LcGreekResponse =
  | { status: "ready"; book: number; chapter: number; verses: string[] }
  | { status: "unavailable" };

/** The `GET /api/bible/lc-greek` answer, or null when it is not a usable chapter. */
export function parseLcGreek(raw: unknown, book: number, chapter: number): string[] | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.status !== "ready" || value.book !== book || value.chapter !== chapter) return null;
  const verses = value.verses;
  if (!Array.isArray(verses) || verses.length === 0) return null;
  if (!verses.every((verse) => typeof verse === "string" && verse.trim() !== "")) return null;
  return verses as string[];
}

/** The `edition` query value: absent means regular; anything unknown is null (a bad request). */
export function parseEdition(raw: string | null): AudioEdition | null {
  if (raw === null || raw === "regular") return "regular";
  return raw === "alive" ? "alive" : null;
}

function bookBaseUrl(book: number, edition: AudioEdition, text: AliveText): string {
  if (edition === "alive") return text === "ASV" ? ALIVE_ASV_BASE_URL : ALIVE_BASE_URL;
  return DRAMATIZED_BOOKS.has(book) ? DRAMATIZED_BASE_URL : AUDIO_BIBLE_BASE_URL;
}

/**
 * After this long with no tap, key or media-key press while audio plays, the
 * player pauses and asks "Still listening?", so a phone left playing overnight
 * does not stream the Bible until morning.
 */
export const STILL_LISTENING_AFTER_MS = 60 * 60 * 1000;

export interface VerseTiming {
  verse: number;
  /** Seconds into the chapter MP3 where the verse starts. */
  start: number;
  end: number;
}

export interface ChapterAudio {
  status: "ready";
  book: number;
  chapter: number;
  /** Which recording this is (absent from servers before LC-15532: regular). */
  edition?: AudioEdition;
  /** The text an Alive recording reads (absent on regular, and from servers before LC-17800: the LC Greek). */
  text?: AliveText;
  audioUrl: string;
  /** Length of the MP3 in seconds. */
  duration: number;
  /**
   * One entry per verse read, in order. A verse the text leaves empty (the
   * ASV omits 16, e.g. Matthew 17:21) has no entry, so numbers can skip.
   */
  verses: VerseTiming[];
}

export type ChapterAudioResponse = ChapterAudio | { status: "unavailable" };

export function hasNarration(book: number): boolean {
  return book >= NARRATED_BOOKS.first && book <= NARRATED_BOOKS.last;
}

export function chapterAudioUrl(
  book: number,
  chapter: number,
  edition: AudioEdition = "regular",
  text: AliveText = "LC Greek"
): string {
  return `${bookBaseUrl(book, edition, text)}/${book}/${chapter}.mp3`;
}

export function chapterTimingUrl(
  book: number,
  chapter: number,
  edition: AudioEdition = "regular",
  text: AliveText = "LC Greek"
): string {
  return `${bookBaseUrl(book, edition, text)}/${book}/${chapter}.json`;
}

/**
 * The verse being read at `seconds`: the last verse that has started. Null
 * before verse 1 (the chapter's opening cue and spoken heading).
 */
export function verseAt(verses: readonly VerseTiming[], seconds: number): number | null {
  let current: number | null = null;
  for (const timing of verses) {
    if (timing.start > seconds) break;
    current = timing.verse;
  }
  return current;
}

/**
 * Where to seek to start reading at `verse`: its start, or the next verse
 * read when this one has no timing (a verse the text omits); the chapter
 * start if there is none.
 */
export function verseStart(verses: readonly VerseTiming[], verse: number): number {
  return verses.find((timing) => timing.verse >= verse)?.start ?? 0;
}

/**
 * The verse a "previous/next verse" control moves to from `verse`: the
 * neighbouring timing entry, so it steps over a verse with no timing and
 * still reaches the chapter's last verse. Before the first verse (null) both
 * directions go to the first verse. Null when there are no timings.
 */
export function adjacentVerse(verses: readonly VerseTiming[], verse: number | null, delta: 1 | -1): number | null {
  if (verses.length === 0) return null;
  if (verse === null) return verses[0].verse;
  const index = verses.findIndex((timing) => timing.verse === verse);
  const target = Math.max(0, Math.min(verses.length - 1, (index < 0 ? 0 : index) + delta));
  return verses[target].verse;
}

/** Whether a playing session has gone an hour without the listener doing anything. */
export function needsStillListening(lastActionAt: number, now: number): boolean {
  return now - lastActionAt >= STILL_LISTENING_AFTER_MS;
}

/**
 * Validate the timing file the render writes, so a malformed or mismatched
 * file reads as "no narration" rather than a player that highlights the wrong
 * verse. Verse numbers must rise from 1 or later; they may skip a verse the
 * text leaves empty (LC-17800). `text` names the Alive folder it came from.
 */
export function parseChapterTiming(
  raw: unknown,
  book: number,
  chapter: number,
  edition: AudioEdition = "regular",
  text: AliveText = "LC Greek"
): ChapterAudio | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.book !== book || value.chapter !== chapter) return null;
  if (typeof value.duration !== "number" || !(value.duration > 0)) return null;
  if (!Array.isArray(value.verses) || value.verses.length === 0) return null;
  const verses: VerseTiming[] = [];
  let previous = 0;
  for (const entry of value.verses) {
    const timing = entry as Record<string, unknown> | null;
    if (
      !timing ||
      typeof timing.verse !== "number" ||
      !Number.isInteger(timing.verse) ||
      timing.verse <= previous ||
      typeof timing.start !== "number" ||
      typeof timing.end !== "number" ||
      timing.end < timing.start
    ) {
      return null;
    }
    previous = timing.verse;
    verses.push({ verse: timing.verse, start: timing.start, end: timing.end });
  }
  return {
    status: "ready",
    book,
    chapter,
    edition,
    ...(edition === "alive" ? { text } : {}),
    audioUrl: chapterAudioUrl(book, chapter, edition, text),
    duration: value.duration,
    verses,
  };
}

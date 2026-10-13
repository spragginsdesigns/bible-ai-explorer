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
 * with no outside narrator, the evangelist telling it, in SureWord's own
 * modern-English translation of the Textus Receptus (the Greek the KJV was
 * translated from). It keeps the KJV's verse numbering, so the read-along
 * highlight follows it verse for verse while the KJV stays on screen.
 */
export type AudioEdition = "regular" | "alive";
export const ALIVE_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/alive/v1";
/**
 * Books with an Alive recording: Mark since LC-15532, Matthew since LC-15843.
 * Each one also has its LC Greek text (below), so a book is added here
 * together with its text.
 */
export const ALIVE_BOOKS: ReadonlySet<number> = new Set([40, 41]);

/** How each recording is named in the Listen choice, the same on every client. */
export const EDITION_CHOICES: Record<AudioEdition, { label: string; detail: string }> = {
  regular: { label: "Regular", detail: "The King James Version, read aloud" },
  alive: { label: "Alive", detail: "Full cast, in our LC Greek translation" },
};

/**
 * Listen recommends Alive wherever a book has it (LC-15842): the choice lists
 * it first, highlighted and marked with RECOMMENDED_LABEL.
 */
export const RECOMMENDED_EDITION: AudioEdition = "alive";
export const RECOMMENDED_LABEL = "Recommended";
/** The order every client lists the recordings in: the recommended one first. */
export const LISTEN_ORDER: readonly AudioEdition[] = ["alive", "regular"];

export function hasAlive(book: number): boolean {
  return ALIVE_BOOKS.has(book);
}

/**
 * The LC Greek (LC-15842): SureWord's own modern-English translation of the
 * Textus Receptus, the text every Alive recording reads. The reader offers it
 * beside its translations on a book that has it, verse for verse in the KJV's
 * numbering. It is a reading text only: highlights, Explain, Learn and Ask AI
 * keep working on the KJV verse with the same number. The source of each book
 * is Context-Pro-AI's docs/creative/sureword-audio-bible/<book>-alive/.
 */
export const LC_GREEK = {
  label: "LC Greek",
  note: "Our own translation of the Greek · the text Alive reads",
  copyright: "SureWord's own translation of the Textus Receptus",
} as const;

export function hasLcGreek(book: number): boolean {
  return hasAlive(book);
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

function bookBaseUrl(book: number, edition: AudioEdition): string {
  if (edition === "alive") return ALIVE_BASE_URL;
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
  audioUrl: string;
  /** Length of the MP3 in seconds. */
  duration: number;
  verses: VerseTiming[];
}

export type ChapterAudioResponse = ChapterAudio | { status: "unavailable" };

export function hasNarration(book: number): boolean {
  return book >= NARRATED_BOOKS.first && book <= NARRATED_BOOKS.last;
}

export function chapterAudioUrl(book: number, chapter: number, edition: AudioEdition = "regular"): string {
  return `${bookBaseUrl(book, edition)}/${book}/${chapter}.mp3`;
}

export function chapterTimingUrl(book: number, chapter: number, edition: AudioEdition = "regular"): string {
  return `${bookBaseUrl(book, edition)}/${book}/${chapter}.json`;
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

/** Where to seek to start reading at `verse`; the chapter start if unknown. */
export function verseStart(verses: readonly VerseTiming[], verse: number): number {
  return verses.find((timing) => timing.verse === verse)?.start ?? 0;
}

/** Whether a playing session has gone an hour without the listener doing anything. */
export function needsStillListening(lastActionAt: number, now: number): boolean {
  return now - lastActionAt >= STILL_LISTENING_AFTER_MS;
}

/**
 * Validate the timing file the render writes, so a malformed or mismatched
 * file reads as "no narration" rather than a player that highlights the wrong
 * verse.
 */
export function parseChapterTiming(
  raw: unknown,
  book: number,
  chapter: number,
  edition: AudioEdition = "regular"
): ChapterAudio | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.book !== book || value.chapter !== chapter) return null;
  if (typeof value.duration !== "number" || !(value.duration > 0)) return null;
  if (!Array.isArray(value.verses) || value.verses.length === 0) return null;
  const verses: VerseTiming[] = [];
  for (const [index, entry] of value.verses.entries()) {
    const timing = entry as Record<string, unknown> | null;
    if (
      !timing ||
      timing.verse !== index + 1 ||
      typeof timing.start !== "number" ||
      typeof timing.end !== "number" ||
      timing.end < timing.start
    ) {
      return null;
    }
    verses.push({ verse: timing.verse, start: timing.start, end: timing.end });
  }
  return {
    status: "ready",
    book,
    chapter,
    edition,
    audioUrl: chapterAudioUrl(book, chapter, edition),
    duration: value.duration,
    verses,
  };
}

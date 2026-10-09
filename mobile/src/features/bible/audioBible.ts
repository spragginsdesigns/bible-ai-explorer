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

/** Where the chapter MP3s and their verse timings live: `<base>/<book>/<chapter>.mp3|json`. */
export const AUDIO_BIBLE_BASE_URL =
  "https://contextproai-storage.s3.us-east-1.amazonaws.com/Audio/sureword-bible/kjv/v1";

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

function bookBaseUrl(book: number): string {
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
  audioUrl: string;
  /** Length of the MP3 in seconds. */
  duration: number;
  verses: VerseTiming[];
}

export type ChapterAudioResponse = ChapterAudio | { status: "unavailable" };

export function hasNarration(book: number): boolean {
  return book >= NARRATED_BOOKS.first && book <= NARRATED_BOOKS.last;
}

export function chapterAudioUrl(book: number, chapter: number): string {
  return `${bookBaseUrl(book)}/${book}/${chapter}.mp3`;
}

export function chapterTimingUrl(book: number, chapter: number): string {
  return `${bookBaseUrl(book)}/${book}/${chapter}.json`;
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
  chapter: number
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
    audioUrl: chapterAudioUrl(book, chapter),
    duration: value.duration,
    verses,
  };
}

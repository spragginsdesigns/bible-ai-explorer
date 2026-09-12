import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bookByOrder } from "@/lib/bible/books";
import { recordReadings, searchReadingLog, getReadingLogStats, correctReading, removeReading } from "@/lib/reading-log";
import { resolveReadingTime, readingTimezone, readingLocalDate } from "@/lib/reading-time";

export interface ReadingToolContext {
  userId: string;
  readingMessageId?: string;
  readingReceivedAt?: Date;
  timezone?: string;
}
// Strict tool schemas require every key; null represents an omitted option.
// Preserve that explicitly so providers never invent verses or an exact time.
function presentFields<T extends Record<string, unknown>>(value: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null)) as { [K in keyof T]: Exclude<T[K], null> };
}
const timeSchema = z.object({
  day: z.enum(["now", "today", "yesterday", "date"]).nullable().optional().describe("Omit or now for 'just read'; today for 'earlier today'; yesterday for yesterday; date for an explicitly stated date."),
  date: z.string().nullable().optional().describe("YYYY-MM-DD, only with day=date."),
  period: z.enum(["day", "morning", "afternoon", "evening"]).nullable().optional().describe("Preserve the user's precision. Never invent an hour for earlier today or this morning."),
  exactTime: z.string().nullable().optional().describe("ISO timestamp with offset ONLY if the user explicitly supplied an exact time. Usually omit; the backend supplies now automatically."),
});
const passageSchema = z.object({
  book: z.number().int().min(1).max(66).describe("Canonical Bible book number, Genesis=1, John=43, Revelation=66."),
  chapter: z.number().int().positive(),
  endChapter: z.number().int().positive().nullable().optional().describe("Inclusive end for a whole chapter range, e.g. John 1-3. Use null for a single chapter or verse passage."),
  verseStart: z.number().int().positive().nullable().optional().describe("Null for whole chapter readings. Set ONLY when the user explicitly named verses."),
  verseEnd: z.number().int().positive().nullable().optional().describe("Null for whole chapters or a single verse. Never infer chapter verse counts."),
});

export function buildReadingTools(context: ReadingToolContext) {
  return {
    logReading: tool({
      description: "Durably log reading the user explicitly reports from their physical Bible or outside SureWord. No extra confirmation needed. Whole chapters, chapter ranges, and partial verse ranges supported, no plan needed. Never log merely discussing a passage, planning to read, or mentioning reading in SureWord (the reader tracks that). Submit ALL passages from one occasion together. Distinct rereadings are distinct occasions even the same day. Timestamp and timezone are supplied by the backend; do not ask when for 'just read'. Do not use saveMemory for reading events.",
      inputSchema: z.object({
        passages: z.array(passageSchema).min(1).max(150),
        when: timeSchema.nullable().optional(),
        occasion: z.number().int().min(1).max(20).default(1).describe("The 1-based reading occasion in this user message, normally 1. Use 2 only when the user reports a second distinct reading occasion in the SAME message. Keep the same number on retries."),
      }),
      execute: async ({ passages, when, occasion }) => {
        if (!context.readingMessageId) throw new Error("Reading writes need a user message identifier. Please send your reading again.");
        const time = resolveReadingTime(when, context.readingReceivedAt ?? new Date(), context.timezone);
        const sessionId = `chat:${createHash("sha256").update(`${context.userId}:${context.readingMessageId}:${occasion}`).digest("hex")}`;
        const expanded = passages.flatMap((passage) => {
          const end = passage.endChapter ?? passage.chapter;
          const book = bookByOrder(passage.book);
          if (!book || end < passage.chapter || end > book.chapters || passage.chapter > book.chapters ||
            (end !== passage.chapter && (passage.verseStart || passage.verseEnd)) ||
            (passage.verseEnd && !passage.verseStart) ||
            (passage.verseStart && passage.verseEnd && passage.verseEnd < passage.verseStart)) {
            throw new Error("Invalid reading passage. Verse ranges must stay within one chapter; split cross-chapter passages.");
          }
          return Array.from({ length: end - passage.chapter + 1 }, (_, index) => ({ ...passage, chapter: passage.chapter + index }));
        });
        if (expanded.length > 150) throw new Error("Log at most 150 chapters in one request.");
        // Merge portions of the same chapter into one event, retaining gaps.
        const chapters = new Map<string, { book: number; chapter: number; whole: boolean; ranges: { start: number; end: number }[] }>();
        for (const passage of expanded) {
          const key = `${passage.book}:${passage.chapter}`;
          const chapter = chapters.get(key) ?? { book: passage.book, chapter: passage.chapter, whole: false, ranges: [] };
          if (passage.verseStart) chapter.ranges.push({ start: passage.verseStart, end: passage.verseEnd ?? passage.verseStart });
          else chapter.whole = true;
          chapters.set(key, chapter);
        }
        const inputs = [...chapters.values()].map((chapter) => ({
          eventId: `${sessionId}:${chapter.book}:${chapter.chapter}`, sessionId,
          source: "physical" as const, book: chapter.book, chapter: chapter.chapter,
          ...(chapter.whole ? {} : { verseRanges: chapter.ranges }),
          // Backend grants chapter completion only when these ranges cover every verse.
          completed: true, evidence: "reported" as const, ...time,
        }));
        const results = await recordReadings(context.userId, inputs);
        if (results.some((result) => result.entry.deletedAt)) throw new Error("This reported reading was previously removed. It has not been restored.");
        const first = results[0].entry;
        const reference = passages.map((p) => `${bookByOrder(p.book)!.name} ${p.chapter}${p.endChapter && p.endChapter !== p.chapter ? `–${p.endChapter}` : ""}${p.verseStart ? `:${p.verseStart}${p.verseEnd && p.verseEnd !== p.verseStart ? `–${p.verseEnd}` : ""}` : ""}`).join(", ");
        return { success: true, sessionId, reference, book: first.book, chapter: first.chapter, localDate: first.localDate, precision: first.precision, timezone: first.timezone, entries: results.map(({ entry }) => ({ eventId: entry.eventId, revision: entry.revision, book: entry.book, chapter: entry.chapter })) };
      },
    }),
    searchReadingHistory: tool({
      description: "Read this user's durable reading journal across ALL years, including rereading and partial passages. Bounded pagination, newest first. Use returned entry IDs for corrections/removal. A precise timestamp is meaningful only for precision=exact; day/morning/evening entries have uncertain time. Reader detections are observations, not proof of comprehension. Do not fetch an entire lifetime into chat; narrow the passage/date and paginate only as needed.",
      inputSchema: z.object({
        book: z.number().int().min(1).max(66).nullable().optional(), chapter: z.number().int().positive().nullable().optional(),
        verseStart: z.number().int().positive().nullable().optional(), verseEnd: z.number().int().positive().nullable().optional(),
        day: z.enum(["today", "yesterday"]).nullable().optional().describe("Backend resolves this using the current device timezone; prefer it for relative day queries."),
        from: z.string().nullable().optional().describe("Inclusive ISO time or YYYY-MM-DD lower date bound."),
        to: z.string().nullable().optional().describe("Inclusive ISO upper time bound."),
        fromDate: z.string().nullable().optional().describe("Inclusive local calendar lower date, YYYY-MM-DD. Prefer calendar dates for today/yesterday queries."),
        toDate: z.string().nullable().optional().describe("Inclusive local calendar upper date, YYYY-MM-DD."),
        source: z.enum(["reader", "physical", "legacy"]).nullable().optional(), cursor: z.string().max(500).nullable().optional(), limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ day, ...filters }) => {
        const localDate = day ? resolveReadingTime({ day }, context.readingReceivedAt ?? new Date(), context.timezone).localDate : undefined;
        return searchReadingLog(context.userId, { ...presentFields(filters), ...(localDate ? { fromDate: localDate, toDate: localDate } : {}) });
      },
    }),
    getReadingStats: tool({
      description: "Read compact lifetime reading statistics. Separates unique chapters from repeat readings, partial passages, reading sessions and active days. No 400-day history cutoff. If historicalBackfillPending is true, old history is still being migrated and these totals are incomplete; say so. This is observed/reported activity, not a measure of spiritual growth or proof of comprehension.",
      inputSchema: z.object({
        book: z.number().int().min(1).max(66).nullable().optional(), chapter: z.number().int().positive().nullable().optional(),
        verseStart: z.number().int().positive().nullable().optional(), verseEnd: z.number().int().positive().nullable().optional(),
        fromDate: z.string().nullable().optional().describe("Inclusive local date. Date windows are bounded to 366 days; omit both dates for lifetime."),
        toDate: z.string().nullable().optional().describe("Inclusive local date. Use coverage to determine unread chapters for that year."),
      }), execute: async (filters) => ({
        ...await getReadingLogStats(context.userId, presentFields(filters)),
        currentLocalDate: readingLocalDate(context.readingReceivedAt ?? new Date(), readingTimezone(context.timezone)), timezone: readingTimezone(context.timezone),
      }),
    }),
    correctReadingLog: tool({
      description: "Correct one reading entry ONLY when the user explicitly requests a correction. First search history to identify the exact entry; ask if ambiguous. Retains the entry's identity. Never silently rewrite history based on inference.",
      inputSchema: z.object({ eventId: z.string().min(1).max(160), revision: z.number().int().positive().describe("The revision returned by search; protects against concurrent corrections."), passage: passageSchema.nullable().optional(), when: timeSchema.nullable().optional() }),
      execute: async ({ eventId, revision, passage, when }) => {
        if (passage?.endChapter && passage.endChapter !== passage.chapter) throw new Error("Correct one chapter entry at a time.");
        if (passage?.verseEnd && !passage.verseStart) throw new Error("A verse end requires a starting verse.");
        const patch = {
          ...(passage ? { book: passage.book, chapter: passage.chapter, verseRanges: [{ start: passage.verseStart ?? 1, end: passage.verseEnd ?? passage.verseStart ?? (await getKjvChapter(passage.book, passage.chapter)).length }], completed: true } : {}),
          ...(when ? resolveReadingTime(when, context.readingReceivedAt ?? new Date(), context.timezone) : {}),
        };
        if (!Object.keys(patch).length) throw new Error("Specify what to correct.");
        const result = await correctReading(context.userId, eventId, { ...patch, revision });
        return { success: true, eventId, result };
      },
    }),
    removeReadingLog: tool({
      description: "Remove one mistaken reading entry ONLY on the user's explicit request. Search first to obtain the exact entry ID; ask if more than one matches. Removes that reading from lifetime statistics and automatic plan progress. Never remove history to make a recommendation or clean up unasked.",
      inputSchema: z.object({ eventId: z.string().min(1).max(160), revision: z.number().int().positive().describe("The revision returned by search; protects against deleting a concurrently corrected entry.") }),
      execute: async ({ eventId, revision }) => {
        const result = await removeReading(context.userId, eventId, revision);
        return { success: true, eventId, removed: result.removed };
      },
    }),
  };
}

/** Extract only routing context; UI messages are validated by the route before
 * any tool can execute. Clock comes from the server, never client metadata. */
export function readingRequestContext(request: Record<string, unknown>, receivedAt: Date) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const last = [...messages].reverse().find((m) => m && typeof m === "object" && m.role === "user");
  return { readingMessageId: typeof last?.id === "string" ? last.id : undefined, readingReceivedAt: receivedAt, timezone: readingTimezone(request.timezone) };
}

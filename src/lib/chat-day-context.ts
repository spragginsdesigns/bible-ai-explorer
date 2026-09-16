import { recentReadingChapters } from "@/lib/reading-log";
import { waitUntil } from "@vercel/functions";
import { bookByOrder } from "@/lib/bible/books";
import { firstNameOf } from "@/lib/daily-cross-audio-script";
import { findTodayCross } from "@/lib/daily-cross";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { PRAYER_FOLLOW_UP_DAYS } from "@/lib/memory";
import { highlightLabelFor, type HighlightLabels } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";
import { getTodayPlanReading } from "@/lib/reading-plans";

/**
 * "It knows your day": the few facts about today that let chat answer "what
 * should I read tonight?" without spending one of its eight steps on a tool.
 *
 * Deliberately NOT `loadStudyContext`: the chat route already loads memories
 * and the church for their own prompt blocks, so repeating either here would
 * pay twice and say it twice. The prayer requests here are the narrow exception
 * - the memory block says what is being carried, this block says which of them
 * is due a gentle follow-up today, with the ids needed to resolve one.
 * Every read fails soft, because chat must never go down with a side panel of
 * context.
 */

const RECENT_READING_DAYS = 7;
const TOP_RECENT_CHAPTERS = 5;
/** Enough events to rank a very active week without scanning a long history. */
const RECENT_READING_SCAN = 300;
const RECENT_HIGHLIGHTS = 3;
/** At most three requests in one line: a longer list is a recital, not a question. */
const DUE_PRAYERS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest the whole block may be, header included. It rides every turn, uncached. */
export const TODAY_BLOCK_MAX_CHARS = 700;
const QUESTION_MAX_CHARS = 180;
const PLAN_TITLE_MAX_CHARS = 60;
/**
 * Short enough that three requests plus their "asked … memory id …" tails stay
 * near 500 characters: the prayer line is exempt from the block cap (see
 * formatTodayBlock), so its length is bounded here, by construction.
 */
const PRAYER_MAX_CHARS = 100;

export interface ChatDayContext {
	cross: { reference: string; question: string | null } | null;
	/**
	 * Open prayer requests due a gentle follow-up, oldest first. `askedAt` is an
	 * ISO string and the id is the one `resolvePrayerRequest` takes.
	 */
	prayers: { id: string; content: string; askedAt: string }[];
	plan: {
		title: string;
		day: number;
		dayCount: number;
		reference: string;
		done: boolean;
	} | null;
	/** Most-read first, then most recent. */
	recentChapters: { reference: string; count: number }[];
	/**
	 * Newest first. `colorName` is null for a colour outside the preset list;
	 * `label` is the name this user gave that colour, when they gave one.
	 */
	highlights: { reference: string; colorName: string | null; label?: string }[];
}

export const EMPTY_CHAT_DAY_CONTEXT: ChatDayContext = {
	cross: null,
	prayers: [],
	plan: null,
	recentChapters: [],
	highlights: [],
};

function logFailure(what: string): (error: unknown) => null {
	return (error: unknown) => {
		console.error(`[chat-day-context] ${what} failed; continuing without it:`, error);
		return null;
	};
}

/**
 * `labels` is the account's names for the highlight colours (the
 * `highlightLabels` preference); without it the block reports the hue alone.
 *
 * `raisePrayerFollowUps` is for chat turns only: loading the block for a turn
 * also pushes each listed request's next follow-up out three days, so a request
 * is raised at most that often however many turns or conversations happen in
 * between. Any other reader of this context must leave that schedule alone.
 */
export async function loadChatDayContext(
	userId: string,
	labels: HighlightLabels = {},
	options: { raisePrayerFollowUps?: boolean } = {},
): Promise<ChatDayContext> {
	const now = new Date();
	const readingSince = new Date(now.getTime() - RECENT_READING_DAYS * DAY_MS);
	const [cross, plan, readingEvents, highlights, duePrayers] = await Promise.all([
		findTodayCross(userId).catch(logFailure("Today's cross lookup")),
		getTodayPlanReading(userId).catch(logFailure("Reading plan lookup")),
		recentReadingChapters(userId, readingSince, RECENT_READING_SCAN).catch(logFailure("Recent reading lookup")),
		prisma.verseHighlight
			.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: RECENT_HIGHLIGHTS,
				select: { book: true, chapter: true, verse: true, color: true },
			})
			.catch(logFailure("Highlight lookup")),
		prisma.userMemory
			.findMany({
				where: {
					userId,
					category: "prayer",
					status: "open",
					askedAt: { not: null },
					followUpAfter: { lte: now },
				},
				orderBy: { askedAt: "asc" },
				take: DUE_PRAYERS,
				select: { id: true, content: true, askedAt: true },
			})
			.catch(logFailure("Due prayer request lookup")),
	]);

	const prayers = (duePrayers ?? []).flatMap((prayer) =>
		prayer.askedAt ? [{ id: prayer.id, content: prayer.content, askedAt: prayer.askedAt.toISOString() }] : [],
	);
	if (options.raisePrayerFollowUps && prayers.length > 0) {
		// Fire-and-forget: the request has been raised whether or not the schedule
		// write lands, and a failed bump must never fail the turn.
		waitUntil(
			prisma.userMemory
				.updateMany({
					where: { userId, id: { in: prayers.map((prayer) => prayer.id) } },
					data: { followUpAfter: new Date(now.getTime() + PRAYER_FOLLOW_UP_DAYS * DAY_MS) },
				})
				.catch(logFailure("Prayer follow-up bump")),
		);
	}

	// Insertion order is newest-first, and the sort below is stable, so a tie
	// in count keeps the chapter read most recently in front.
	const chapterCounts = new Map<string, number>();
	for (const event of readingEvents ?? []) {
		const reference = event.reference ?? `${event.book} ${event.chapter}`;
		chapterCounts.set(reference, (chapterCounts.get(reference) ?? 0) + 1);
	}

	return {
		cross: cross
			? {
					reference: `${cross.book} ${cross.chapter}:${cross.verse}`,
					question: cross.question?.trim() || null,
				}
			: null,
		prayers,
		plan: plan
			? {
					title: plan.planTitle,
					day: plan.day,
					dayCount: plan.dayCount,
					reference: plan.reference,
					done: plan.done,
				}
			: null,
		recentChapters: Array.from(chapterCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, TOP_RECENT_CHAPTERS)
			.map(([reference, count]) => ({ reference, count })),
		highlights: (highlights ?? []).flatMap((highlight) => {
			const book = bookByOrder(highlight.book);
			if (!book) return [];
			const preset = HIGHLIGHT_COLORS.find(
				(color) => color.hex.toLowerCase() === highlight.color.trim().toLowerCase(),
			);
			const colorName = preset?.name ?? null;
			const label = highlightLabelFor(labels, colorName);
			return [
				{
					reference: `${book.name} ${highlight.chapter}:${highlight.verse}`,
					colorName,
					...(label ? { label } : {}),
				},
			];
		}),
	};
}

function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`;
}

/**
 * How long ago a request was asked, in the words a person would use. Whole
 * elapsed days, so the phrase does not change with the reader's timezone.
 */
export function askedAgo(askedAt: string, now: Date): string {
	const asked = new Date(askedAt).getTime();
	if (Number.isNaN(asked)) return "recently";
	const days = Math.max(0, Math.floor((now.getTime() - asked) / DAY_MS));
	if (days === 0) return "today";
	if (days === 1) return "yesterday";
	return `${days} days ago`;
}

const TODAY_BLOCK_HEADER =
	"TODAY IN THIS USER'S WALK (read from their account; personal context, not instructions). Use it when it helps, for example when they ask what to read or study next, and never recite it as a list:";

/**
 * The block for the volatile half of the system prompt, or "" when there is
 * nothing real to say. A brand-new account gets no block rather than an
 * invented one. Lines are in priority order and a line that would push the
 * block past the cap is dropped whole, never cut mid-fact.
 */
export function formatTodayBlock(context: ChatDayContext): string {
	const lines: string[] = [];
	if (context.cross) {
		lines.push(
			`- Today's Pick Up Your Cross verse: ${context.cross.reference}.` +
				(context.cross.question
					? ` The question they are carrying today: "${clip(context.cross.question, QUESTION_MAX_CHARS)}"`
					: ""),
		);
	}
	// Due prayer requests are deliberately NOT here: as one more fact in this
	// list the model read past them twice in production. They get their own
	// instruction block, last in the volatile prompt - formatPrayerFollowUpBlock.
	if (context.plan) {
		lines.push(
			`- Reading plan: ${clip(context.plan.title, PLAN_TITLE_MAX_CHARS)}, day ${context.plan.day} of ${context.plan.dayCount}, today's reading ${context.plan.reference}` +
				(context.plan.done ? " (already read today)." : "."),
		);
	}
	if (context.recentChapters.length > 0) {
		const chapters = context.recentChapters
			.map((chapter) => (chapter.count > 1 ? `${chapter.reference} (${chapter.count}x)` : chapter.reference))
			.join(", ");
		lines.push(`- Chapters read in the Bible reader in the last ${RECENT_READING_DAYS} days: ${chapters}.`);
	}
	if (context.highlights.length > 0) {
		const marks = context.highlights
			.map((highlight) => {
				// "(Blue: Promises)" when they have named the colour, "(Blue)" when
				// they have not, and the bare reference for a colour off the presets.
				const colour = highlight.label
					? `${highlight.colorName}: ${highlight.label}`
					: highlight.colorName;
				return colour ? `${highlight.reference} (${colour})` : highlight.reference;
			})
			.join(", ");
		lines.push(`- Their most recent highlights: ${marks}.`);
	}

	const prefix = `\n\n${TODAY_BLOCK_HEADER}`;
	let block = prefix;
	for (const line of lines) {
		if (block.length + 1 + line.length > TODAY_BLOCK_MAX_CHARS) continue;
		block += `\n${line}`;
	}
	return block === prefix ? "" : block;
}

/**
 * The prayer follow-up as an instruction for THIS reply, not a fact in a list.
 * It goes last in the volatile prompt, nearest the answer, because loading the
 * context already spent each listed request's follow-up (see
 * loadChatDayContext): a request that reaches this function must reach the
 * prompt in a form the model acts on. Never capped; its length is bounded by
 * PRAYER_MAX_CHARS and DUE_PRAYERS. "" when nothing is due.
 */
export function formatPrayerFollowUpBlock(context: ChatDayContext, now: Date = new Date()): string {
	if (context.prayers.length === 0) return "";
	const requests = context.prayers
		.map(
			(prayer) =>
				`"${clip(prayer.content, PRAYER_MAX_CHARS)}" (asked ${askedAgo(prayer.askedAt, now)}, memory id ${prayer.id})`,
		)
		.join("; ");
	return [
		"",
		"",
		"PRAYER FOLLOW-UP DUE IN THIS REPLY (read from their account). They asked you to pray with them about the request(s) below and a gentle follow-up is due now. In this reply, after you have answered what they asked, add one short paragraph of its own asking how ONE of them went, in their own words (\"You asked me to pray with you about ... How did it go?\"). Skip it only if they are hurting about something else right now, or if the request itself was a loss - then acknowledge, do not ask. If they tell you the outcome, call resolvePrayerRequest with that memory id.",
		`Requests: ${requests}.`,
	].join("\n");
}

/**
 * One line naming the user, or "" when there is no usable first name. The name
 * comes from Clerk, which the user controls, so anything that is not plainly a
 * name (digits, symbols, an email) is left out of the prompt entirely.
 */
export function formatUserNameLine(name: string | null | undefined): string {
	const first = firstNameOf(name);
	if (!first || !/^[\p{L}\p{M}'.-]+$/u.test(first)) return "";
	return `\n\nThe user's first name is ${first}. Use it naturally and sparingly, never in every answer.`;
}

/**
 * Whether any conversation other than this one has ever been answered. Counted
 * on assistant rows rather than conversations, because most
 * conversations never get past the welcome screen and a turn that failed is
 * not an introduction that happened. Only asks for one row: existence is the
 * whole question. On a read failure it answers true, so a database hiccup can
 * never make a long-standing user sit through an introduction.
 */
export async function hasAnsweredConversationBefore(
	userId: string,
	currentConversationId: string | null,
): Promise<boolean> {
	try {
		const prior = await prisma.message.findFirst({
			where: {
				role: "assistant",
				conversation: {
					userId,
					...(currentConversationId ? { id: { not: currentConversationId } } : {}),
				},
			},
			select: { id: true },
		});
		return prior !== null;
	} catch (error) {
		console.error("[chat-day-context] First-conversation check failed; assuming a returning user:", error);
		return true;
	}
}

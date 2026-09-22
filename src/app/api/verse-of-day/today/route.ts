import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { scheduleDailyCrossAudio } from "@/lib/daily-cross-audio";
import {
	DailyCrossDirectionError,
	DailyCrossReferenceError,
	findTodayCross,
	generateDailyCross,
	replaceDailyCross,
	storeDailyCross,
	type DailyCross,
} from "@/lib/daily-cross";
import { isDailyCrossDirection } from "@/lib/daily-cross-selection";
import { createRateLimiter } from "@/lib/rateLimit";

/** A steer the user typed ("something on fear") — long enough to be useful, short enough to be a steer. */
const MAX_FOCUS_LENGTH = 200;
const generationLimiter = createRateLimiter({ limit: 6, windowMs: 60 * 60_000 });

function generationLimit(userId: string): Response | null {
	const rate = generationLimiter.check(userId);
	return rate.allowed ? null : privateJson(
		{ error: "You've prepared several daily words. Try again later." },
		{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
	);
}

// Generating a fresh day is one utility-model call plus context reads.
export const maxDuration = 300;

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function privateJson(body: unknown, init: ResponseInit = {}): NextResponse {
	return NextResponse.json(body, {
		...init,
		headers: { ...PRIVATE_NO_STORE, ...(init.headers ?? {}) },
	});
}

function toResponse(cross: DailyCross & { id?: string }, sentAt: Date) {
	return {
		...(cross.id ? { id: cross.id } : {}),
		reference: `${cross.book} ${cross.chapter}:${cross.verse}`,
		book: cross.book,
		chapter: cross.chapter,
		verse: cross.verse,
		text: cross.text,
		reason: cross.reason,
		whyToday: cross.whyToday,
		application: cross.application,
		studyPath: cross.studyPath,
		question: cross.question,
		// Always present so a client can decide whether "Stay with this" applies
		// without a second request; null on a pinned day or a row that predates
		// the theme fields.
		themeKey: cross.primaryThemeKey ?? null,
		theme: cross.primaryTheme ?? null,
		sentAt: sentAt.toISOString(),
	};
}

/**
 * Today's "Pick Up Your Cross" entry for the caller. Serves the Daily Cross
 * screen on Android and web. Returns the entry the morning cron stored when
 * one exists inside the reuse window; otherwise generates one on demand and
 * stores it — so the feature works fully for users with notifications off or
 * push unavailable.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const existing = await findTodayCross(userId);
		if (existing) {
			await scheduleDailyCrossAudio(userId).catch((error: unknown) => {
				console.error(`[verse-of-day/today] Could not schedule existing audio for ${userId}:`, error);
			});
			return privateJson(toResponse(existing, existing.sentAt));
		}
		const limited = generationLimit(userId);
		if (limited) return limited;

		const cross = await generateDailyCross(userId);
		const { id, sentAt } = await storeDailyCross(userId, cross);

		// A day generated on demand earns its spoken devotional the same way the
		// cron's does: started now, in the background, so the Listen card is
		// already preparing by the time this response paints. Only the entitlement
		// check is awaited here - the narration itself runs past the response.
		await scheduleDailyCrossAudio(userId).catch((error: unknown) => {
			console.error(`[verse-of-day/today] Could not schedule audio for ${userId}:`, error);
		});

		return privateJson(toResponse({ ...cross, id }, sentAt));
	} catch (error) {
		return errorResponse(error);
	}
}

/**
 * Replace today's entry with a freshly generated one - the "a different word
 * for today" control on every client's Daily Cross screen, and the `setDailyCross`
 * chat tool. Body (all optional): `{ focus, direction, book, chapter, verse }`;
 * `focus` steers the choice in the user's own words, `direction` is the "Stay
 * with this" / "Take me somewhere fresh" pair, and a full book/chapter/verse pins
 * the day to a verse they named. A pin already says where to go, so it cannot be
 * combined with a direction.
 */
export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const body: unknown = await req.json().catch(() => ({}));
		const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

		const focus =
			typeof data.focus === "string" && data.focus.trim()
				? data.focus.trim().slice(0, MAX_FOCUS_LENGTH)
				: undefined;

		if (data.direction !== undefined && !isDailyCrossDirection(data.direction)) {
			return privateJson(
				{ error: 'A direction must be either "stay" or "fresh".' },
				{ status: 400 }
			);
		}
		const direction = isDailyCrossDirection(data.direction) ? data.direction : undefined;

		// A pinned verse needs all three parts; a partial reference is a client
		// bug, not a request to guess.
		const hasReferencePart =
			data.book !== undefined || data.chapter !== undefined || data.verse !== undefined;
		const verse =
			typeof data.book === "string" &&
			data.book.trim() &&
			Number.isInteger(data.chapter) &&
			Number.isInteger(data.verse) &&
			(data.chapter as number) >= 1 &&
			(data.verse as number) >= 1
				? {
						book: data.book.trim(),
						chapter: data.chapter as number,
						verse: data.verse as number,
					}
				: undefined;
		if (hasReferencePart && !verse) {
			return privateJson(
				{ error: "A pinned verse needs a book name, a chapter number and a verse number." },
				{ status: 400 }
			);
		}
		if (direction && hasReferencePart) {
			return privateJson({ error: "Choose a direction or pin a verse, not both." }, { status: 400 });
		}
		const limited = generationLimit(userId);
		if (limited) return limited;

		const { cross } = await replaceDailyCross(userId, { focus, verse, direction });
		return privateJson(toResponse(cross, cross.sentAt));
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	// A reference the user typed wrong is their correction to make, not a 500.
	if (error instanceof DailyCrossReferenceError) {
		return privateJson({ error: error.message }, { status: 400 });
	}
	// "Stay with this" on a day that carries no theme: the request is well formed
	// but conflicts with the state of today's row.
	if (error instanceof DailyCrossDirectionError) {
		return privateJson({ error: error.message }, { status: 409 });
	}
	console.error("Error in verse-of-day/today route:", error);
	return privateJson({ error: "Could not prepare today's word. Please try again." }, { status: 500 });
}

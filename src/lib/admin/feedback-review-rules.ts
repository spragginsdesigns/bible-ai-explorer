/**
 * Pure rules for the owner's review queue at /admin/feedback: who may open it,
 * how its URL filters are read, the Prisma `where` each list runs, and how the
 * two lists (thumbs-down answers and Send feedback messages) merge into one
 * newest-first page.
 *
 * Split from `feedback-review.ts` (server-only, talks to Prisma) so the access
 * rule and the query shapes are tested directly
 * (`tests/admin-feedback-review.test.mjs`). No imports on purpose: the tests
 * load this file with Node's type stripping, which cannot resolve `@/` paths.
 *
 * Why it exists: Apple guidelines 1.2 and 5.1.2 ask for a way to report
 * objectionable AI output that a person actually acts on (docs/ios/ai-consent.md,
 * section 3). The thumbs down already stored the report; this is where a
 * person reads it.
 */

export const REVIEW_PAGE_SIZE = 50;
/** Deep pages merge two lists in memory; nobody pages 5,000 reports back. */
export const REVIEW_MAX_PAGE = 100;
export const REVIEW_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_REVIEW_WINDOW: ReviewWindow = 30;

export type ReviewWindow = (typeof REVIEW_WINDOWS)[number];
/** "rating" is a thumbs-down answer; "message" is a Send feedback row. */
export type ReviewKind = "rating" | "message";
export type ReviewTypeFilter = "all" | ReviewKind;

export interface ReviewFilters {
	type: ReviewTypeFilter;
	days: ReviewWindow;
	/** Hide what has already been marked reviewed. On by default: it is a queue. */
	unreviewedOnly: boolean;
	/** 1-based. */
	page: number;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
	type: "all",
	days: DEFAULT_REVIEW_WINDOW,
	unreviewedOnly: true,
	page: 1,
};

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Whether this signed-in Clerk id may open the review queue. `allowlist` is
 * `parseUserIdAllowlist(process.env.ADMIN_USER_IDS)` (the shared parser in
 * `entitlements-rules.ts`). Signed out, an empty id, or an empty allowlist is
 * always no: an unset env var must never mean "everyone".
 */
export function isAdminUserId(userId: string | null | undefined, allowlist: readonly string[]): boolean {
	if (typeof userId !== "string") return false;
	const id = userId.trim();
	if (!id) return false;
	return allowlist.includes(id);
}

/**
 * The HTTP status a request to the page or its API gets before anything is
 * read. Not 403 and not 401: a stranger, signed in or not, must not learn that
 * an admin surface exists at this path.
 */
export function adminAccessStatus(userId: string | null | undefined, allowlist: readonly string[]): 200 | 404 {
	return isAdminUserId(userId, allowlist) ? 200 : 404;
}

// ---------------------------------------------------------------------------
// Filters from the URL
// ---------------------------------------------------------------------------

type ParamValue = string | string[] | undefined;
export type ReviewSearchParams = URLSearchParams | Record<string, ParamValue>;

function readParam(params: ReviewSearchParams, key: string): string | undefined {
	if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
	const value = params[key];
	return Array.isArray(value) ? value[0] : value;
}

/** Anything unrecognised falls back to the default rather than erroring. */
export function parseReviewFilters(params: ReviewSearchParams): ReviewFilters {
	const rawType = readParam(params, "type");
	const type: ReviewTypeFilter = rawType === "rating" || rawType === "message" ? rawType : "all";

	const rawDays = Number(readParam(params, "days"));
	const days = (REVIEW_WINDOWS as readonly number[]).includes(rawDays)
		? (rawDays as ReviewWindow)
		: DEFAULT_REVIEW_WINDOW;

	const rawUnreviewed = readParam(params, "unreviewed");
	const unreviewedOnly = rawUnreviewed === "0" || rawUnreviewed === "false" ? false : true;

	const rawPage = readParam(params, "page");
	const pageNumber = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
	const page = Math.min(Math.max(pageNumber, 1), REVIEW_MAX_PAGE);

	return { type, days, unreviewedOnly, page };
}

/** The query string for these filters, defaults omitted, so links stay short. */
export function reviewQueryString(filters: ReviewFilters): string {
	const params = new URLSearchParams();
	if (filters.type !== "all") params.set("type", filters.type);
	if (filters.days !== DEFAULT_REVIEW_WINDOW) params.set("days", String(filters.days));
	if (!filters.unreviewedOnly) params.set("unreviewed", "0");
	if (filters.page !== 1) params.set("page", String(filters.page));
	const query = params.toString();
	return query ? `?${query}` : "";
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewWindowStart(days: ReviewWindow, now: Date): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/** Which lists this filter reads. */
export function reviewKindsFor(filters: ReviewFilters): ReviewKind[] {
	return filters.type === "all" ? ["rating", "message"] : [filters.type];
}

/**
 * `Message` rows that are a thumbs down on an answer inside the window. Keyed
 * on `feedbackAt`, the moment of the report, which uses the
 * `@@index([feedback, feedbackAt])` index.
 */
export function answerRatingWhere(filters: ReviewFilters, now: Date) {
	return {
		role: "assistant",
		feedback: "down",
		feedbackAt: { gte: reviewWindowStart(filters.days, now) },
		...(filters.unreviewedOnly ? { feedbackReviewedAt: null } : {}),
	};
}

/** `Feedback` rows (Send feedback) inside the window. */
export function feedbackMessageWhere(filters: ReviewFilters, now: Date) {
	return {
		createdAt: { gte: reviewWindowStart(filters.days, now) },
		...(filters.unreviewedOnly ? { reviewedAt: null } : {}),
	};
}

/**
 * How many id-and-date stubs to read from each list to fill this page and
 * know whether another follows. Each list is read from its own top because
 * the merged order is only known after both are in hand.
 */
export function reviewFetchDepth(filters: ReviewFilters): number {
	return filters.page * REVIEW_PAGE_SIZE + 1;
}

export interface ReviewStub {
	kind: ReviewKind;
	id: string;
	at: Date;
}

/** Newest first; equal stamps tie-break on id so a page boundary is stable. */
export function compareReviewStubs(a: ReviewStub, b: ReviewStub): number {
	const delta = b.at.getTime() - a.at.getTime();
	if (delta !== 0) return delta;
	if (a.id === b.id) return 0;
	return a.id < b.id ? 1 : -1;
}

/** Merge each list's newest stubs and cut out the requested page. */
export function pickReviewPage(
	lists: readonly (readonly ReviewStub[])[],
	filters: ReviewFilters
): { items: ReviewStub[]; hasMore: boolean } {
	const merged = lists.flat().sort(compareReviewStubs);
	const start = (filters.page - 1) * REVIEW_PAGE_SIZE;
	const items = merged.slice(start, start + REVIEW_PAGE_SIZE);
	return { items, hasMore: merged.length > start + REVIEW_PAGE_SIZE };
}

/**
 * The question an answer replied to: the nearest user turn before it in the
 * conversation, walked in order (as scripts/feedback-to-fixtures.mjs does),
 * because two rows written in the same millisecond defeat a timestamp compare.
 */
export function previousUserTurnId(
	thread: readonly { id: string; role: string }[],
	answerId: string
): string | null {
	const index = thread.findIndex((turn) => turn.id === answerId);
	for (let i = index - 1; i >= 0; i -= 1) {
		if (thread[i].role === "user") return thread[i].id;
	}
	return null;
}

/** The model that wrote an answer, from `Message.metadata.modelId`. */
export function modelIdFromMetadata(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
	const value = (metadata as Record<string, unknown>).modelId;
	return typeof value === "string" && value.trim() ? value : null;
}

// ---------------------------------------------------------------------------
// Mark reviewed
// ---------------------------------------------------------------------------

export interface MarkReviewedInput {
	kind: ReviewKind;
	id: string;
	/** false puts it back in the queue. */
	reviewed: boolean;
}

export function parseMarkReviewed(
	body: unknown
): { ok: true; data: MarkReviewedInput } | { ok: false; error: string } {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { ok: false, error: "Expected a JSON object." };
	}
	const record = body as Record<string, unknown>;
	if (record.kind !== "rating" && record.kind !== "message") {
		return { ok: false, error: 'kind must be "rating" or "message".' };
	}
	if (typeof record.id !== "string" || !record.id.trim() || record.id.length > 64) {
		return { ok: false, error: "id is required." };
	}
	const reviewed = record.reviewed === undefined ? true : record.reviewed;
	if (typeof reviewed !== "boolean") {
		return { ok: false, error: "reviewed must be a boolean." };
	}
	return { ok: true, data: { kind: record.kind, id: record.id.trim(), reviewed } };
}

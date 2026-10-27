/**
 * Pure rules for SureWord Beta's shared study store (`BetaItem`, `BetaLink`;
 * docs/beta/README.md): what a module may write, and the canonical shape of
 * the passages and topics every item carries, so the Knowledge Vault and the
 * Living Study Graph can read all modules the same way.
 *
 * No imports on purpose: `tests/beta-store.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. The server half,
 * which talks to Prisma, is `store.ts`.
 */

export const BETA_TITLE_MAX = 200;
export const BETA_BODY_MAX = 200_000;
/** Serialized JSON bytes a module may keep in one item's `data`. */
export const BETA_DATA_MAX_BYTES = 256 * 1024;
export const BETA_REFS_MAX = 500;
export const BETA_TOPICS_MAX = 50;
export const BETA_TOPIC_MAX_LENGTH = 60;
export const BETA_REASON_MAX = 1_000;
export const BETA_LINK_ORIGINS = ["user", "suggested"] as const;
export type BetaLinkOrigin = (typeof BETA_LINK_ORIGINS)[number];

/** A module-defined kind or link kind: "project", "source", "builds-on". */
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
/** "43.3" (John 3) or "43.3.16" (John 3:16). */
const REF_KEY_PATTERN = /^(\d{1,2})\.(\d{1,3})(?:\.(\d{1,3}))?$/;

export function isBetaKind(value: unknown): value is string {
	return typeof value === "string" && KIND_PATTERN.test(value);
}

/** The passage key for a book (canonical order 1-66), chapter, and optional verse. */
export function betaRefKey(book: number, chapter: number, verse?: number): string {
	return verse === undefined ? `${book}.${chapter}` : `${book}.${chapter}.${verse}`;
}

export function parseBetaRefKey(key: string): { book: number; chapter: number; verse?: number } | null {
	const match = REF_KEY_PATTERN.exec(key);
	if (!match) return null;
	const book = Number(match[1]);
	const chapter = Number(match[2]);
	const verse = match[3] === undefined ? undefined : Number(match[3]);
	if (book < 1 || book > 66 || chapter < 1 || (verse !== undefined && verse < 1)) return null;
	return verse === undefined ? { book, chapter } : { book, chapter, verse };
}

/**
 * Valid, de-duplicated passage keys in Bible order. Every verse key brings its
 * chapter key, so "everything on John 3" is one array-contains lookup.
 * Returns null when any key is malformed (a module bug, not user input).
 */
export function normalizeBetaRefs(keys: readonly unknown[]): string[] | null {
	const parsed: { book: number; chapter: number; verse?: number }[] = [];
	for (const key of keys) {
		const ref = typeof key === "string" ? parseBetaRefKey(key.trim()) : null;
		if (!ref) return null;
		parsed.push(ref);
		if (ref.verse !== undefined) parsed.push({ book: ref.book, chapter: ref.chapter });
	}
	const unique = new Map(parsed.map((ref) => [betaRefKey(ref.book, ref.chapter, ref.verse), ref]));
	const sorted = [...unique.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter || (a.verse ?? 0) - (b.verse ?? 0));
	if (sorted.length > BETA_REFS_MAX) return null;
	return sorted.map((ref) => betaRefKey(ref.book, ref.chapter, ref.verse));
}

/** Lowercase, single-spaced, de-duplicated topic labels; null when one is unusable. */
export function normalizeBetaTopics(topics: readonly unknown[]): string[] | null {
	const out: string[] = [];
	for (const topic of topics) {
		if (typeof topic !== "string") return null;
		const label = topic.trim().replace(/\s+/g, " ").toLowerCase();
		if (!label || label.length > BETA_TOPIC_MAX_LENGTH) return null;
		if (!out.includes(label)) out.push(label);
	}
	return out.length > BETA_TOPICS_MAX ? null : out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export interface BetaItemInput {
	module: string;
	kind: string;
	title: string;
	parentId?: string | null;
	body?: string | null;
	data?: Record<string, unknown>;
	refs?: readonly string[];
	topics?: readonly string[];
}

export interface BetaItemPatch {
	title?: string;
	body?: string | null;
	data?: Record<string, unknown>;
	refs?: readonly string[];
	topics?: readonly string[];
}

export type BetaRuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

function checkTitle(title: unknown): BetaRuleResult<string> {
	if (typeof title !== "string") return { ok: false, error: "title must be a string" };
	const value = title.trim().replace(/\s+/g, " ");
	if (!value) return { ok: false, error: "title is empty" };
	if (value.length > BETA_TITLE_MAX) return { ok: false, error: `title is longer than ${BETA_TITLE_MAX}` };
	return { ok: true, value };
}

function checkBody(body: unknown): BetaRuleResult<string | null> {
	if (body === null || body === undefined) return { ok: true, value: null };
	if (typeof body !== "string") return { ok: false, error: "body must be a string" };
	if (body.length > BETA_BODY_MAX) return { ok: false, error: `body is longer than ${BETA_BODY_MAX}` };
	return { ok: true, value: body.trim() ? body : null };
}

function checkData(data: unknown): BetaRuleResult<Record<string, unknown>> {
	if (data === undefined) return { ok: true, value: {} };
	if (!isPlainObject(data)) return { ok: false, error: "data must be a plain object" };
	let size: number;
	try {
		size = new TextEncoder().encode(JSON.stringify(data)).length;
	} catch {
		return { ok: false, error: "data must be JSON-serializable" };
	}
	if (size > BETA_DATA_MAX_BYTES) return { ok: false, error: `data is larger than ${BETA_DATA_MAX_BYTES} bytes` };
	return { ok: true, value: data };
}

/** Everything a new item needs, normalized; `modules` is the registry's slugs. */
export function checkBetaItemInput(input: BetaItemInput, modules: readonly string[]): BetaRuleResult<Required<BetaItemInput>> {
	if (!modules.includes(input.module)) return { ok: false, error: `unknown module "${input.module}"` };
	if (!isBetaKind(input.kind)) return { ok: false, error: "kind must be lowercase letters, digits and dashes" };
	const title = checkTitle(input.title);
	if (!title.ok) return title;
	const body = checkBody(input.body);
	if (!body.ok) return body;
	const data = checkData(input.data);
	if (!data.ok) return data;
	const refs = normalizeBetaRefs(input.refs ?? []);
	if (!refs) return { ok: false, error: "refs must be passage keys like 43.3 or 43.3.16" };
	const topics = normalizeBetaTopics(input.topics ?? []);
	if (!topics) return { ok: false, error: "topics must be short labels" };
	const parentId = input.parentId ?? null;
	if (parentId !== null && (typeof parentId !== "string" || !parentId)) return { ok: false, error: "parentId must be an id" };
	return { ok: true, value: { module: input.module, kind: input.kind, title: title.value, parentId, body: body.value, data: data.value, refs, topics } };
}

/** Only the fields present are checked and returned. */
export function checkBetaItemPatch(patch: BetaItemPatch): BetaRuleResult<BetaItemPatch> {
	const out: BetaItemPatch = {};
	if (patch.title !== undefined) {
		const title = checkTitle(patch.title);
		if (!title.ok) return title;
		out.title = title.value;
	}
	if (patch.body !== undefined) {
		const body = checkBody(patch.body);
		if (!body.ok) return body;
		out.body = body.value;
	}
	if (patch.data !== undefined) {
		const data = checkData(patch.data);
		if (!data.ok) return data;
		out.data = data.value;
	}
	if (patch.refs !== undefined) {
		const refs = normalizeBetaRefs(patch.refs);
		if (!refs) return { ok: false, error: "refs must be passage keys like 43.3 or 43.3.16" };
		out.refs = refs;
	}
	if (patch.topics !== undefined) {
		const topics = normalizeBetaTopics(patch.topics);
		if (!topics) return { ok: false, error: "topics must be short labels" };
		out.topics = topics;
	}
	if (Object.keys(out).length === 0) return { ok: false, error: "nothing to change" };
	return { ok: true, value: out };
}

export interface BetaLinkInput {
	fromId: string;
	toId: string;
	kind: string;
	reason?: string | null;
	origin?: BetaLinkOrigin;
}

export function checkBetaLinkInput(input: BetaLinkInput): BetaRuleResult<Required<BetaLinkInput>> {
	if (typeof input.fromId !== "string" || !input.fromId || typeof input.toId !== "string" || !input.toId) {
		return { ok: false, error: "a link needs two item ids" };
	}
	if (input.fromId === input.toId) return { ok: false, error: "an item cannot link to itself" };
	if (!isBetaKind(input.kind)) return { ok: false, error: "kind must be lowercase letters, digits and dashes" };
	const origin = input.origin ?? "user";
	if (!BETA_LINK_ORIGINS.includes(origin)) return { ok: false, error: "origin must be user or suggested" };
	const reason = typeof input.reason === "string" ? input.reason.trim() : null;
	if (reason && reason.length > BETA_REASON_MAX) return { ok: false, error: `reason is longer than ${BETA_REASON_MAX}` };
	return { ok: true, value: { fromId: input.fromId, toId: input.toId, kind: input.kind, reason: reason || null, origin } };
}

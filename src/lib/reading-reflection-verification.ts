import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyStructuredProse, type ProseField } from "@/lib/ai/structured-prose";
import type { VerifyAnswerOptions } from "@/lib/ai/verified-generation";
import { REFLECTION_MAX_TITLE, REFLECTION_MAX_TEXT, REFLECTION_MAX_NOTE, type ReadingReflectionContent, type ReflectionSources } from "@/lib/reading-overview-rules";
import type { StudySourceRevisions } from "@/lib/study-source-revisions";

export const REFLECTION_VERIFICATION_VERSION = 2;
/** These fields render literally on every client, not through a Markdown renderer. */
export function isPlainReflectionProse(value: string): boolean {
	// Inspect compatibility forms too, without normalizing the stored/displayed bytes.
	const literal = value.normalize("NFKC");
	return value.trim().length > 0 &&
		!/[`*_]|~~|\||<[^>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(literal) &&
		!/(?:^|\n)\s*(?:#{1,6}\s|>|[-+]\s|\d{1,3}[.)]\s|\[\d{1,3}\]\s)/.test(literal) &&
		!/!?\[[^\]]*\]\s*(?:\(|\[)|\[\[|\\[\\`*_{}\[\]()#+.!<>~-]/.test(literal);
}

const prose = (max: number) => z.string().min(1).max(max).refine(isPlainReflectionProse);
const contentSchema = z.object({
	title: prose(REFLECTION_MAX_TITLE),
	reflection: prose(REFLECTION_MAX_TEXT),
	verse: z.object({ book: z.number().int().min(1).max(66), bookName: z.string().min(1), chapter: z.number().int().min(1), verse: z.number().int().min(1), text: z.string().min(1), note: prose(REFLECTION_MAX_NOTE).nullable() }).strict().nullable(),
	next: z.object({ book: z.number().int().min(1).max(66), bookName: z.string().min(1), chapter: z.number().int().min(1), reason: prose(REFLECTION_MAX_NOTE) }).strict().nullable(),
}).strict();
const revision = z.object({ id: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const revisionsSchema = z.object({ memories: z.array(revision).max(200), notes: z.array(revision).max(20) }).strict();
export interface VerifiedReflectionSources extends ReflectionSources {
	revisions: StudySourceRevisions;
	memoryAllowed: boolean;
}
const sameIds = (left: string[], right: string[]) => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every(id => right.includes(id));
const sourcesSchema = z.object({ memories: z.array(z.string().min(1).max(400)).max(200), notes: z.array(z.string().min(1).max(200)).max(20), revisions: revisionsSchema, memoryAllowed: z.boolean() }).strict().refine(sources =>
	sameIds(sources.notes, sources.revisions.notes.map(note => note.id)) &&
	sources.memories.every(key => key.lastIndexOf(":") > 0) &&
	sameIds(sources.memories.map(key => key.slice(0, key.lastIndexOf(":"))), sources.revisions.memories.map(memory => memory.id)) &&
	(sources.memoryAllowed || sources.memories.length === 0));
const storedSchema = z.object({ reflection: contentSchema, sources: sourcesSchema,
	verification: z.object({ version: z.literal(REFLECTION_VERIFICATION_VERSION), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict();
export interface VerifiedStoredReflection {
	reflection: ReadingReflectionContent;
	sources: VerifiedReflectionSources;
	verification: { version: typeof REFLECTION_VERIFICATION_VERSION; digest: string };
}
/** Revisions must come from the exact owned rows used to construct study facts. */
export function bindReflectionSources(sources: ReflectionSources, revisions: StudySourceRevisions, memoryAllowed: boolean): VerifiedReflectionSources {
	return sourcesSchema.parse({ ...sources, revisions, memoryAllowed });
}
/** Bind exact field bytes, coordinates, source revisions, memory policy and basis. */
function digest(reflection: ReadingReflectionContent, sources: VerifiedReflectionSources, basis: string): string {
	const exact = contentSchema.parse(reflection);
	return createHash("sha256").update(JSON.stringify({ version: REFLECTION_VERIFICATION_VERSION, basis,
		reflection: exact, sources: sourcesSchema.parse(sources) })).digest("hex");
}
export function certifyReflection(reflection: ReadingReflectionContent, sources: VerifiedReflectionSources, basis: string): VerifiedStoredReflection {
	return { reflection, sources, verification: { version: REFLECTION_VERIFICATION_VERSION, digest: digest(reflection, sources, basis) } };
}
export function parseVerifiedReflection(content: string, basis: string): VerifiedStoredReflection | null {
	try {
		const stored = storedSchema.parse(JSON.parse(content));
		return stored.verification.digest === digest(stored.reflection, stored.sources, basis) ? stored : null;
	} catch { return null; }
}
export async function verifyReflectionContent(reflection: ReadingReflectionContent, options: {
	verification: Omit<VerifyAnswerOptions, "timeoutMs">;
	deadlineAt: number;
}): Promise<ReadingReflectionContent> {
	const fields: ProseField<ReadingReflectionContent>[] = [
		{ id: "walk:title", read: payload => payload.title, write: (payload, title) => ({ ...payload, title }) },
		{ id: "walk:reflection", read: payload => payload.reflection, write: (payload, text) => ({ ...payload, reflection: text }) },
	];
	if (reflection.verse?.note !== null && reflection.verse) fields.push({ id: "walk:verse-note", read: payload => payload.verse!.note!, write: (payload, note) => ({ ...payload, verse: { ...payload.verse!, note } }) });
	if (reflection.next) fields.push({ id: "walk:next-reason", read: payload => payload.next!.reason, write: (payload, reason) => ({ ...payload, next: { ...payload.next!, reason } }) });
	return verifyStructuredProse(reflection, { fields,
		immutable: payload => ({ verse: payload.verse ? { book: payload.verse.book, bookName: payload.verse.bookName, chapter: payload.verse.chapter, verse: payload.verse.verse, text: payload.verse.text, hasNote: payload.verse.note !== null } : null,
			next: payload.next ? { book: payload.next.book, bookName: payload.next.bookName, chapter: payload.next.chapter } : null }),
		validate: payload => contentSchema.safeParse(payload).success,
		verification: options.verification, deadlineAt: options.deadlineAt, persistenceReserveMs: 15_000,
	});
}

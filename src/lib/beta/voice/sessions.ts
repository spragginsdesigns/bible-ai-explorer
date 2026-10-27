import "server-only";

import type { BetaItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { appendMarkdownToNote } from "@/lib/notes-io";
import { resolveReference } from "@/lib/bible/books";
import { canonicalPassage } from "@/lib/bible/passage-context";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { planVoiceReading } from "@/lib/beta/voice/tools";
import { parseVerseReferences, stripTranslationTag } from "@/utils/verseParser";
import {
	buildVoiceNoteMarkdown,
	checkVoiceTurns,
	isWorthKeeping,
	parseVoiceUsage,
	voiceCostUsd,
	voiceSessionTitle,
	voiceTranscriptText,
	type VoiceNotePassage,
	type VoiceTurn,
	type VoiceUsage,
} from "@/lib/beta/voice/voice-rules";

/**
 * Voice Study conversations in SureWord Beta's shared study store
 * (docs/beta/voice.md): one `BetaItem` per conversation (module "voice", kind
 * "session") whose body is the transcript the Knowledge Vault searches and
 * whose refs are every passage it cited or read. Saving it as a Note uses the
 * app's own notes, with the passages quoted from the bundled KJV.
 */

const MODULE = "voice";
const KIND = "session";
/** Passages quoted into one save of a note; the transcript still names the rest. */
const NOTE_PASSAGES_MAX = 12;
const NOTE_MARKDOWN_MAX = 150_000;

export interface VoiceSessionData {
	version: 1;
	turns: VoiceTurn[];
	startedAt: string;
	endedAt: string;
	durationSeconds: number;
	usage: VoiceUsage;
	/** List-price estimate of what the conversation cost, in USD. */
	costUsd: number;
	noteId?: string;
	/** How many turns the note already holds, so a later save appends only the rest. */
	noteTurnCount?: number;
	/** References already quoted into the note. */
	notePassages?: string[];
}

export interface VoiceSessionSummary {
	id: string;
	title: string;
	startedAt: string;
	durationSeconds: number;
	exchanges: number;
	references: string[];
	noteId: string | null;
	costUsd: number;
}

export class VoiceSessionInputError extends Error {}

function readData(item: BetaItem): VoiceSessionData | null {
	const data = item.data as Record<string, unknown> | null;
	if (!data || data.version !== 1) return null;
	const turns = checkVoiceTurns(data.turns);
	if (!turns.ok) return null;
	return {
		version: 1,
		turns: turns.value,
		startedAt: typeof data.startedAt === "string" ? data.startedAt : item.createdAt.toISOString(),
		endedAt: typeof data.endedAt === "string" ? data.endedAt : item.updatedAt.toISOString(),
		durationSeconds: typeof data.durationSeconds === "number" ? data.durationSeconds : 0,
		usage: parseVoiceUsage(data.usage),
		costUsd: typeof data.costUsd === "number" ? data.costUsd : 0,
		...(typeof data.noteId === "string" && { noteId: data.noteId }),
		...(typeof data.noteTurnCount === "number" && { noteTurnCount: data.noteTurnCount }),
		...(Array.isArray(data.notePassages) && { notePassages: data.notePassages.filter((ref): ref is string => typeof ref === "string") }),
	};
}

/**
 * Every passage the conversation cited (a reference SureWord said, in the
 * transcript) or read aloud, in the order they first came up, de-duplicated.
 */
export function citedReferences(turns: readonly VoiceTurn[]): { reference: string; heard: boolean }[] {
	const seen = new Map<string, { reference: string; heard: boolean }>();
	for (const turn of turns) {
		if (turn.role === "reading") {
			const entry = seen.get(turn.text);
			if (entry) entry.heard = true;
			else seen.set(turn.text, { reference: turn.text, heard: true });
			continue;
		}
		if (turn.role !== "assistant") continue;
		for (const segment of parseVerseReferences(turn.text)) {
			if (segment.type !== "verse-ref") continue;
			const reference = stripTranslationTag(segment.value).replace(/[–—]/g, "-");
			if (!seen.has(reference)) seen.set(reference, { reference, heard: false });
		}
	}
	return [...seen.values()];
}

function refKeys(references: readonly string[]): string[] {
	const keys = new Set<string>();
	for (const reference of references) {
		const ref = resolveReference(reference);
		if (ref) keys.add(betaRefKey(ref.order, ref.chapter, ref.verse));
	}
	return [...keys];
}

function summarize(item: BetaItem): VoiceSessionSummary | null {
	const data = readData(item);
	if (!data) return null;
	return {
		id: item.id,
		title: item.title,
		startedAt: data.startedAt,
		durationSeconds: data.durationSeconds,
		exchanges: data.turns.filter((turn) => turn.role === "user").length,
		references: citedReferences(data.turns).map((entry) => entry.reference),
		noteId: data.noteId ?? null,
		costUsd: data.costUsd,
	};
}

export async function listVoiceSessions(userId: string, take = 20): Promise<VoiceSessionSummary[]> {
	const items = await listBetaItems(userId, { module: MODULE, kind: KIND, parentId: null, take });
	return items.map(summarize).filter((entry): entry is VoiceSessionSummary => entry !== null);
}

export async function getVoiceSession(userId: string, id: string): Promise<(VoiceSessionSummary & { turns: VoiceTurn[] }) | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== MODULE || item.kind !== KIND) return null;
	const data = readData(item);
	const summary = summarize(item);
	return data && summary ? { ...summary, turns: data.turns } : null;
}

/** Forgets a conversation. Its Note, if one was saved, stays in Notes. */
export async function deleteVoiceSession(userId: string, id: string): Promise<boolean> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== MODULE || item.kind !== KIND) return false;
	return deleteBetaItem(userId, id);
}

function parseInstant(raw: unknown, fallback: Date): Date {
	if (typeof raw !== "string") return fallback;
	const value = new Date(raw);
	return Number.isNaN(value.getTime()) ? fallback : value;
}

/**
 * Keeps a conversation: creates its item, or replaces the transcript of the
 * one with `id` (a conversation saved, continued and saved again). Nothing
 * is stored for a conversation with no question and no answer.
 */
export async function saveVoiceSession(
	userId: string,
	input: { id?: unknown; turns: unknown; startedAt?: unknown; endedAt?: unknown; usage?: unknown },
): Promise<VoiceSessionSummary | null> {
	const checked = checkVoiceTurns(input.turns);
	if (!checked.ok) throw new VoiceSessionInputError(checked.error);
	// The same rule chat applies to every answer it keeps: no em or en dashes.
	const turns = checked.value.map((turn) => (turn.role === "assistant" ? { ...turn, text: stripDashes(turn.text) } : turn));
	if (!isWorthKeeping(turns)) throw new VoiceSessionInputError("nothing to keep yet: ask a question first");
	const now = new Date();
	const existing = typeof input.id === "string" && input.id ? await getBetaItem(userId, input.id) : null;
	if (typeof input.id === "string" && input.id && (!existing || existing.module !== MODULE || existing.kind !== KIND)) return null;
	const previous = existing ? readData(existing) : null;
	const startedAt = previous ? new Date(previous.startedAt) : parseInstant(input.startedAt, now);
	const endedAt = parseInstant(input.endedAt, now);
	const usage = parseVoiceUsage(input.usage);
	const data: VoiceSessionData = {
		version: 1,
		turns,
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
		usage,
		costUsd: Math.round(voiceCostUsd(usage) * 10_000) / 10_000,
		...(previous?.noteId && { noteId: previous.noteId }),
		...(previous?.noteTurnCount !== undefined && { noteTurnCount: previous.noteTurnCount }),
		...(previous?.notePassages && { notePassages: previous.notePassages }),
	};
	const fields = {
		title: voiceSessionTitle(turns),
		body: voiceTranscriptText(turns),
		data: data as unknown as Record<string, unknown>,
		refs: refKeys(citedReferences(turns).map((entry) => entry.reference)),
	};
	const item = existing
		? await updateBetaItem(userId, existing.id, fields)
		: await createBetaItem(userId, { module: MODULE, kind: KIND, ...fields, topics: ["voice study"] });
	return item ? summarize(item) : null;
}

async function notePassage(reference: string, heard: boolean): Promise<VoiceNotePassage | null> {
	if (/:/.test(reference)) {
		try {
			const passage = await canonicalPassage(reference, "KJV");
			return {
				reference: passage.reference,
				heard,
				verses: passage.verses.map((row) => ({ verse: Number(row.reference.split(":").pop()), text: row.text })),
			};
		} catch {
			// A cross-chapter range or a typo: fall through to the reading planner.
		}
	}
	const plan = await planVoiceReading(reference);
	return plan.status === "ready" ? { reference: plan.reference, heard, verses: plan.verses } : null;
}

export type VoiceNoteResult = { noteId: string; noteTitle: string; created: boolean } | null;

/**
 * Saves the conversation as a Note in the user's Notes: the transcript, then
 * each passage it cited or read, quoted in full from the KJV. Saving again
 * after more conversation appends only what is new, so edits the user made to
 * the note in the meantime are never overwritten.
 */
export async function saveVoiceSessionNote(userId: string, id: string): Promise<VoiceNoteResult> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== MODULE || item.kind !== KIND) return null;
	const data = readData(item);
	if (!data) return null;

	const existingNote = data.noteId
		? await prisma.note.findFirst({ where: { id: data.noteId, userId }, select: { id: true, title: true } })
		: null;
	const fromTurn = existingNote ? (data.noteTurnCount ?? 0) : 0;
	const quoted = new Set(existingNote ? (data.notePassages ?? []) : []);
	const newTurns = data.turns.slice(fromTurn);
	if (existingNote && newTurns.length === 0) return { noteId: existingNote.id, noteTitle: existingNote.title, created: false };

	const passages: VoiceNotePassage[] = [];
	// Verses already quoted in this save, by chapter, so Romans 5:1-5 read aloud
	// after Romans 5:1-11 was cited is not quoted twice.
	const covered = new Map<string, Set<number>>();
	for (const cited of citedReferences(newTurns)) {
		if (passages.length >= NOTE_PASSAGES_MAX) break;
		const passage = await notePassage(cited.reference, cited.heard);
		if (!passage || quoted.has(passage.reference)) continue;
		const chapter = passage.reference.replace(/:.*$/, "");
		const seen = covered.get(chapter) ?? new Set<number>();
		if (passage.verses.every((row) => seen.has(row.verse))) continue;
		for (const row of passage.verses) seen.add(row.verse);
		covered.set(chapter, seen);
		passages.push(passage);
		quoted.add(passage.reference);
	}
	const dateLabel = new Date(data.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
	const markdown = buildVoiceNoteMarkdown({ dateLabel, turns: newTurns, passages });
	const saved = await appendMarkdownToNote({
		userId,
		markdown: existingNote ? `## Continued\n\n${markdown}` : markdown,
		noteId: existingNote?.id,
		title: existingNote ? undefined : `Voice Study: ${item.title}`.slice(0, 200),
		maxLength: NOTE_MARKDOWN_MAX,
	});
	await updateBetaItem(userId, item.id, {
		data: { ...data, noteId: saved.noteId, noteTurnCount: data.turns.length, notePassages: [...quoted] } as unknown as Record<string, unknown>,
	});
	return { noteId: saved.noteId, noteTitle: saved.noteTitle, created: saved.created };
}

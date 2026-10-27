import "server-only";

import { prisma } from "@/lib/prisma";
import { getVerseText, parseTranslationId } from "@/lib/bible/translations";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { channelIdFor } from "@/lib/sermon-studies";
import { listBetaItems } from "@/lib/beta/store";
import { labelsFor, vaultBookName } from "@/lib/beta/vault/passages";
import { vaultRefKey, type VaultExport } from "@/lib/beta/vault/vault-rules";

/**
 * Export the whole Knowledge Vault (docs/beta/vault.md): every source the
 * Vault reads, whole, owner-scoped, as one JSON document the Markdown file is
 * written from. Caps keep one request inside the function budget; anything
 * cut is named in `truncated`, never dropped silently.
 */

const CAPS = { notes: 2000, highlights: 5000, chats: 1000, messages: 20000, reading: 5000, verses: 2000, memories: 500, sermons: 200, studies: 499 };

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export async function exportVault(userId: string): Promise<VaultExport> {
	const truncated: string[] = [];
	const capped = <T,>(rows: T[], cap: number, label: string): T[] => {
		if (rows.length > cap) {
			truncated.push(label);
			return rows.slice(0, cap);
		}
		return rows;
	};

	const [user, notes, highlights, chats, reading, verses, memories, channelId, items] = await Promise.all([
		prisma.user.findUnique({ where: { id: userId }, select: { highlightLabels: true } }),
		prisma.note.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			take: CAPS.notes + 1,
			select: {
				id: true, title: true, plainText: true, createdAt: true, updatedAt: true,
				tags: { select: { tag: { select: { name: true } } } },
				outgoingLinks: { select: { targetTitle: true } },
				incomingLinks: { where: { userId }, select: { source: { select: { title: true } } } },
			},
		}),
		prisma.verseHighlight.findMany({ where: { userId }, orderBy: [{ book: "asc" }, { chapter: "asc" }, { verse: "asc" }], take: CAPS.highlights + 1 }),
		prisma.conversation.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			take: CAPS.chats + 1,
			select: { id: true, title: true, createdAt: true, updatedAt: true },
		}),
		prisma.readingLogEntry.findMany({
			where: { userId, deletedAt: null },
			orderBy: { occurredAt: "desc" },
			take: CAPS.reading + 1,
			select: { localDate: true, book: true, chapter: true },
		}),
		prisma.verseMemory.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: CAPS.verses + 1 }),
		prisma.userMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: CAPS.memories + 1 }),
		channelIdFor(userId),
		listBetaItems(userId, { take: CAPS.studies + 1 }),
	]);

	const keptChats = capped(chats, CAPS.chats, "chats");
	// Newest first, so a cap drops the oldest messages rather than whichever chats sort last.
	const messages = keptChats.length
		? await prisma.message.findMany({
				where: { conversationId: { in: keptChats.map((chat) => chat.id) }, conversation: { userId } },
				orderBy: { createdAt: "desc" },
				take: CAPS.messages + 1,
				select: { conversationId: true, role: true, content: true, createdAt: true },
			})
		: [];
	const keptMessages = capped(messages, CAPS.messages, "chat messages").reverse();
	const sermons = channelId
		? await prisma.sermonStudy.findMany({
				where: { channelId },
				orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }],
				take: CAPS.sermons + 1,
				select: { id: true, title: true, serviceDate: true, preacher: true, preachingText: true, bigIdea: true, summary: true, application: true },
			})
		: [];

	const labels = (user?.highlightLabels && typeof user.highlightLabels === "object" && !Array.isArray(user.highlightLabels) ? user.highlightLabels : {}) as Record<string, unknown>;
	const verseText = async (translation: string, book: number, chapter: number, verse: number) =>
		(await getVerseText(parseTranslationId(translation), book, chapter, verse).catch(() => undefined)) ?? null;
	const ref = (book: number, chapter: number, verse: number) => `${vaultBookName(book) ?? `Book ${book}`} ${chapter}:${verse}`;

	const readingByDay = new Map<string, string[]>();
	for (const entry of capped(reading, CAPS.reading, "reading")) {
		readingByDay.set(entry.localDate, [...(readingByDay.get(entry.localDate) ?? []), vaultRefKey(entry.book, entry.chapter)]);
	}

	return {
		exportedAt: new Date().toISOString(),
		notes: capped(notes, CAPS.notes, "notes").map((note) => ({
			id: note.id,
			title: note.title,
			createdAt: note.createdAt.toISOString(),
			updatedAt: note.updatedAt.toISOString(),
			tags: note.tags.map((t) => t.tag.name),
			linksTo: [...new Set(note.outgoingLinks.map((l) => l.targetTitle))],
			linkedFrom: [...new Set(note.incomingLinks.map((l) => l.source.title))],
			text: note.plainText,
		})),
		highlights: await Promise.all(
			capped(highlights, CAPS.highlights, "highlights").map(async (h) => {
				const name = HIGHLIGHT_COLORS.find((c) => c.hex.toLowerCase() === h.color.toLowerCase())?.name ?? null;
				const label = name && typeof labels[name.toLowerCase()] === "string" ? (labels[name.toLowerCase()] as string) : null;
				return {
					reference: ref(h.book, h.chapter, h.verse),
					translation: h.translation,
					color: name ?? h.color,
					label,
					text: await verseText(h.translation, h.book, h.chapter, h.verse),
					createdAt: h.createdAt.toISOString(),
					updatedAt: h.updatedAt.toISOString(),
				};
			}),
		),
		chats: keptChats.map((chat) => ({
			id: chat.id,
			title: chat.title,
			createdAt: chat.createdAt.toISOString(),
			updatedAt: chat.updatedAt.toISOString(),
			messages: keptMessages
				.filter((m) => m.conversationId === chat.id)
				.map((m) => ({ role: m.role, createdAt: m.createdAt.toISOString(), text: m.content })),
		})),
		reading: [...readingByDay.entries()].map(([date, keys]) => ({ date, chapters: labelsFor([...new Set(keys)], 200) })),
		verses: await Promise.all(
			capped(verses, CAPS.verses, "verses").map(async (v) => ({
				reference: ref(v.book, v.chapter, v.verse),
				translation: v.translation,
				text: await verseText(v.translation, v.book, v.chapter, v.verse),
				addedAt: v.createdAt.toISOString(),
				lastReviewedAt: iso(v.lastReviewedAt),
				knownAt: iso(v.knownAt),
				dueAt: v.dueAt.toISOString(),
			})),
		),
		memories: capped(memories, CAPS.memories, "memories").map((m) => ({
			category: m.category,
			status: m.status,
			createdAt: m.createdAt.toISOString(),
			updatedAt: m.updatedAt.toISOString(),
			text: m.content,
		})),
		sermons: capped(sermons, CAPS.sermons, "sermon studies").map((s) => ({
			id: s.id,
			title: s.title,
			serviceDate: s.serviceDate ? s.serviceDate.toISOString().slice(0, 10) : null,
			preacher: s.preacher,
			preachingText: s.preachingText,
			bigIdea: s.bigIdea,
			summary: s.summary,
			application: s.application,
		})),
		studies: capped(items, CAPS.studies, "beta studies").map((item) => ({
			id: item.id,
			module: item.module,
			kind: item.kind,
			title: item.title,
			createdAt: item.createdAt.toISOString(),
			updatedAt: item.updatedAt.toISOString(),
			refs: item.refs,
			topics: item.topics,
			body: item.body,
			data: item.data,
		})),
		truncated,
	};
}

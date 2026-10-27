import "server-only";

import { prisma } from "@/lib/prisma";
import { BOOKS } from "@/lib/bible/books";
import { loadReadingHistory } from "@/lib/reading-history";
import { PLACEHOLDER_NOTE_TITLE } from "@/lib/study-context-format";
import { getBetaItem, listBetaItems } from "@/lib/beta/store";
import { moduleItemHref, moduleTitle } from "@/lib/beta/vault/sources";
import { vaultBookName } from "@/lib/beta/vault/passages";
import { clip, pickResume, type ResumeTarget } from "@/lib/beta/vault/vault-rules";

/**
 * Study memory (docs/beta/vault.md): the last place the owner was in each
 * part of SureWord (the reader, a chat, a note, the verses they are learning,
 * and each beta module such as Study Projects and Learning Paths), newest
 * first, so "continue where you left off" can name the real last study rather
 * than only the last chapter. Every read is best effort: one failing source
 * never hides the others.
 */
export async function studyMemory(userId: string): Promise<{ primary: ResumeTarget | null; others: ResumeTarget[] }> {
	const settle = async <T,>(work: Promise<T>, label: string): Promise<T | null> => {
		try {
			return await work;
		} catch (error) {
			console.error(`[beta/vault] resume ${label} failed`, error instanceof Error ? error.name : "UnknownError");
			return null;
		}
	};
	const [history, chat, note, verse, items] = await Promise.all([
		settle(loadReadingHistory(userId), "reader"),
		settle(
			prisma.message.findFirst({
				where: { conversation: { userId } },
				orderBy: { createdAt: "desc" },
				select: { createdAt: true, conversation: { select: { id: true, title: true } } },
			}),
			"chat",
		),
		settle(
			prisma.note.findFirst({
				where: { userId, NOT: { plainText: "", title: PLACEHOLDER_NOTE_TITLE } },
				orderBy: { updatedAt: "desc" },
				select: { id: true, title: true, plainText: true, updatedAt: true },
			}),
			"note",
		),
		settle(
			prisma.verseMemory.findFirst({
				where: { userId },
				orderBy: [{ updatedAt: "desc" }],
				select: { book: true, chapter: true, verse: true, updatedAt: true, dueAt: true, knownAt: true },
			}),
			"learn",
		),
		settle(listBetaItems(userId, { take: 60 }), "beta"),
	]);

	const targets: ResumeTarget[] = [];
	const last = history?.lastRead;
	if (last) {
		const book = BOOKS.find((b) => b.name === last.book);
		if (book) {
			const params = new URLSearchParams({ book: String(book.order), chapter: String(last.chapter), translation: last.translation });
			targets.push({ feature: "reader", action: "Continue reading", title: `${book.name} ${last.chapter}`, detail: null, href: `/bible/chapter?${params}`, at: last.readAt });
		}
	}
	if (chat) {
		const question = await settle(
			prisma.message.findFirst({
				where: { conversationId: chat.conversation.id, role: "user" },
				orderBy: { createdAt: "desc" },
				select: { content: true },
			}),
			"chat question",
		);
		targets.push({
			feature: "chat",
			action: "Back to your chat",
			title: chat.conversation.title.trim() || "Your last chat",
			detail: question ? `You asked: ${clip(question.content, 120)}` : null,
			href: `/c/${encodeURIComponent(chat.conversation.id)}`,
			at: chat.createdAt.toISOString(),
		});
	}
	if (note && (note.plainText.trim() || note.title.trim())) {
		targets.push({
			feature: "note",
			action: "Keep writing",
			title: note.title.trim() || PLACEHOLDER_NOTE_TITLE,
			detail: note.plainText.trim() ? clip(note.plainText, 120) : null,
			href: `/notes?note=${encodeURIComponent(note.id)}`,
			at: note.updatedAt.toISOString(),
		});
	}
	if (verse) {
		const due = await settle(prisma.verseMemory.count({ where: { userId, knownAt: null, dueAt: { lte: new Date() } } }), "learn due");
		targets.push({
			feature: "learn",
			action: "Keep learning by heart",
			title: `${vaultBookName(verse.book) ?? "Verse"} ${verse.chapter}:${verse.verse}`,
			detail: due ? `${due} verse${due === 1 ? "" : "s"} ready to practise` : null,
			href: "/bible/learn",
			at: verse.updatedAt.toISOString(),
		});
	}
	// The newest item in each beta module; a change inside a project resumes the project.
	const seenModules = new Set<string>();
	for (const item of items ?? []) {
		if (seenModules.has(item.module)) continue;
		seenModules.add(item.module);
		const parent = item.parentId ? await settle(getBetaItem(userId, item.parentId), "beta parent") : null;
		const top = parent ?? item;
		targets.push({
			feature: "module",
			module: item.module,
			action: `Continue in ${moduleTitle(item.module)}`,
			title: top.title,
			detail: parent ? `Last: ${clip(item.title, 80)}` : top.body ? clip(top.body, 120) : null,
			href: moduleItemHref(top.module, top.id),
			at: item.updatedAt.toISOString(),
		});
	}
	return pickResume(targets, 5);
}

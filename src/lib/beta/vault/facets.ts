import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { channelIdFor } from "@/lib/sermon-studies";
import { PLACEHOLDER_NOTE_TITLE } from "@/lib/study-context-format";
import { betaItemVersions, listBetaItems } from "@/lib/beta/store";
import type { VaultKind } from "@/lib/beta/vault/vault-rules";

/**
 * What the Vault's filters offer (docs/beta/vault.md): how many of each kind
 * the owner has, and the topic labels they have actually used (beta item
 * topics, note tags, and the names they gave highlight colours), most used
 * first. Counts describe the library; nothing here measures the person.
 */
export interface VaultFacets {
	counts: Record<VaultKind, number>;
	topics: { label: string; count: number }[];
}

const TOPICS_MAX = 24;

export async function vaultFacets(userId: string): Promise<VaultFacets> {
	const channelId = await channelIdFor(userId);
	const [notes, highlights, chats, reading, verses, memories, sermons, items, tags, user, labelled] = await Promise.all([
		prisma.note.count({ where: { userId, NOT: { plainText: "", title: PLACEHOLDER_NOTE_TITLE } } }),
		prisma.verseHighlight.count({ where: { userId } }),
		prisma.conversation.count({ where: { userId, messages: { some: {} } } }),
		prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(DISTINCT "localDate")::int AS "n" FROM "ReadingLogEntry" WHERE "userId" = ${userId} AND "deletedAt" IS NULL`),
		prisma.verseMemory.count({ where: { userId } }),
		prisma.userMemory.count({ where: { userId } }),
		channelId ? prisma.sermonStudy.count({ where: { channelId } }) : Promise.resolve(0),
		betaItemVersions(userId),
		prisma.tag.findMany({ where: { userId }, select: { name: true, _count: { select: { notes: true } } } }),
		prisma.user.findUnique({ where: { id: userId }, select: { highlightLabels: true } }),
		listBetaItems(userId, { take: 500 }),
	]);

	const topicCounts = new Map<string, number>();
	const add = (label: string, count = 1) => {
		const key = label.trim().replace(/\s+/g, " ").toLowerCase();
		if (key && key.length <= 60) topicCounts.set(key, (topicCounts.get(key) ?? 0) + count);
	};
	for (const item of labelled) for (const topic of item.topics) add(topic);
	for (const tag of tags) if (tag._count.notes > 0) add(tag.name, tag._count.notes);
	const labels = user?.highlightLabels;
	if (labels && typeof labels === "object" && !Array.isArray(labels)) {
		for (const value of Object.values(labels)) if (typeof value === "string") add(value, 0);
	}

	return {
		counts: {
			note: notes,
			highlight: highlights,
			chat: chats,
			reading: reading[0]?.n ?? 0,
			verse: verses,
			memory: memories,
			sermon: sermons,
			study: items.length,
		},
		topics: [...topicCounts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, TOPICS_MAX)
			.map(([label, count]) => ({ label, count })),
	};
}

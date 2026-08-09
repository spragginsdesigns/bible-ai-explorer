import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export interface UserMemoryRecord {
	id: string;
	content: string;
	category: string;
}

const MAX_MEMORIES_PER_USER = 60;
const MAX_MEMORY_CONTENT_LENGTH = 500;
const MAX_EXCHANGE_CHARACTERS = 8000;

export async function loadUserMemories(userId: string): Promise<UserMemoryRecord[]> {
	return prisma.userMemory.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		take: MAX_MEMORIES_PER_USER,
		select: { id: true, content: true, category: true },
	});
}

/**
 * Format memories as a system prompt block. Returns an empty string when there
 * is nothing to remember so the prompt stays untouched for new users.
 */
export function formatMemoryBlock(memories: UserMemoryRecord[]): string {
	if (memories.length === 0) return "";

	const lines = memories.map((memory) => `- ${memory.content}`);
	return [
		"",
		"THINGS YOU REMEMBER ABOUT THIS USER from earlier conversations. Let them shape your answers naturally, the way a pastor remembers his congregation - never recite this list, never mention that you keep memories unless the user asks:",
		...lines,
	].join("\n");
}

const memoryUpdateSchema = z.object({
	add: z
		.array(
			z.object({
				content: z.string().describe("One durable fact about the user, stated concisely in third person."),
				category: z.enum(["profile", "prayer", "study", "preference", "general"]),
			})
		)
		.describe("New facts worth remembering long-term. Empty if none."),
	update: z
		.array(
			z.object({
				id: z.string().describe("The id of the existing memory to replace."),
				content: z.string().describe("The corrected or refined fact."),
			})
		)
		.describe("Existing memories that this exchange corrected or refined. Empty if none."),
	remove: z
		.array(z.string())
		.describe("Ids of existing memories the user contradicted or asked to forget. Empty if none."),
});

const MEMORY_EXTRACTION_INSTRUCTIONS = `You maintain the long-term memory of VerseMind, a KJV Bible study assistant, about one specific user. From the latest exchange, extract only DURABLE facts about the user that would help future conversations feel personal and continuous. Worth remembering: their name and family, church background, spiritual state and journey (e.g. new believer, backslidden, seeking assurance), prayer requests and life circumstances, ongoing studies or reading plans, and stable preferences about how they like to study. NOT worth remembering: the theological content of answers, one-off curiosities, or anything the Bible itself says. Prefer updating an existing memory over adding a near-duplicate. Remove memories the user contradicted or asked to forget. Most exchanges contain nothing worth remembering - returning three empty arrays is the normal outcome.`;

/**
 * Extract durable user facts from the latest exchange and reconcile them with
 * the stored memories. Designed to run in the background after a reply has
 * streamed; all failures are logged and swallowed.
 */
export async function extractAndStoreMemories(options: {
	userId: string;
	userText: string;
	assistantText: string;
}): Promise<void> {
	try {
		const existing = await loadUserMemories(options.userId);
		const existingBlock =
			existing.length > 0
				? existing.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n")
				: "(none)";

		const { output } = await generateText({
			model: openai("gpt-5.6-terra"),
			providerOptions: { openai: { reasoningEffort: "low" } },
			output: Output.object({ schema: memoryUpdateSchema }),
			instructions: MEMORY_EXTRACTION_INSTRUCTIONS,
			prompt: [
				`Existing memories:\n${existingBlock}`,
				`User said:\n${options.userText.slice(0, MAX_EXCHANGE_CHARACTERS)}`,
				`Assistant replied:\n${options.assistantText.slice(0, MAX_EXCHANGE_CHARACTERS)}`,
			].join("\n\n"),
		});

		if (!output) return;

		const existingIds = new Set(existing.map((m) => m.id));
		const removals = output.remove.filter((id) => existingIds.has(id));
		const updates = output.update.filter((u) => existingIds.has(u.id) && u.content.trim());
		const remaining = MAX_MEMORIES_PER_USER - (existing.length - removals.length);
		const additions = output.add
			.filter((a) => a.content.trim())
			.slice(0, Math.max(0, remaining));

		if (removals.length === 0 && updates.length === 0 && additions.length === 0) return;

		await prisma.$transaction([
			...(removals.length > 0
				? [prisma.userMemory.deleteMany({ where: { userId: options.userId, id: { in: removals } } })]
				: []),
			...updates.map((u) =>
				prisma.userMemory.update({
					where: { id: u.id },
					data: { content: u.content.trim().slice(0, MAX_MEMORY_CONTENT_LENGTH) },
				})
			),
			...additions.map((a) =>
				prisma.userMemory.create({
					data: {
						userId: options.userId,
						content: a.content.trim().slice(0, MAX_MEMORY_CONTENT_LENGTH),
						category: a.category,
					},
				})
			),
		]);
	} catch (error) {
		console.error("Memory extraction failed:", error);
	}
}

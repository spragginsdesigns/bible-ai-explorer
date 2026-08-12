import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";
import { allowsMemoryUse } from "@/lib/memory-policy";

export interface UserMemoryRecord {
	id: string;
	content: string;
	category: string;
}

export const MAX_MEMORIES_PER_USER = 60;
export const MAX_MEMORY_CONTENT_LENGTH = 500;
const MAX_EXCHANGE_CHARACTERS = 8000;

/** Keep in sync with the zod enum in memoryUpdateSchema below. */
export const MEMORY_CATEGORIES = ["profile", "prayer", "study", "preference", "general"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

function fetchUserMemories(userId: string): Promise<UserMemoryRecord[]> {
	return prisma.userMemory.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		take: MAX_MEMORIES_PER_USER,
		select: { id: true, content: true, category: true },
	});
}

/**
 * The Settings → Memory toggle. Fails closed when the row is missing or the
 * read errors: we must never use or learn personal data unless the persisted
 * preference was read successfully and is explicitly enabled.
 */
async function isMemoryEnabled(userId: string): Promise<boolean> {
	try {
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { memoryEnabled: true },
		});
		return allowsMemoryUse(user?.memoryEnabled);
	} catch (error) {
		console.error("Reading memoryEnabled failed; disabling memory for this request:", error);
		return false;
	}
}

/**
 * Load a user's memories for prompt injection. Runs on the chat request path,
 * so a memory-layer outage must never take chat down with it: on failure we log
 * and behave like a user with no memories yet.
 *
 * Read-side only. Extraction must NOT use this - see extractAndStoreMemories.
 */
export async function loadUserMemories(userId: string): Promise<UserMemoryRecord[]> {
	try {
		if (!(await isMemoryEnabled(userId))) return [];
		return await fetchUserMemories(userId);
	} catch (error) {
		console.error("Loading user memories failed; continuing without them:", error);
		return [];
	}
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

const MEMORY_EXTRACTION_INSTRUCTIONS = `You maintain the long-term memory of SureWord, a KJV Bible study assistant, about one specific user. From what the user themselves said, extract only DURABLE facts about the user that would help future conversations feel personal and continuous. Worth remembering: their name and family, church background, spiritual state and journey (e.g. new believer, backslidden, seeking assurance), prayer requests and life circumstances, ongoing studies or reading plans, and stable preferences about how they like to study. NOT worth remembering: the theological content of answers, one-off curiosities, or anything the Bible itself says. Prefer updating an existing memory over adding a near-duplicate. Remove memories the user contradicted or asked to forget. Most exchanges contain nothing worth remembering - returning three empty arrays is the normal outcome.`;

/**
 * Extract durable user facts from what the user said and reconcile them with
 * the stored memories. Designed to run in the background after a reply has
 * streamed; all failures are logged and swallowed.
 *
 * Only the user's own words are extracted from - never the assistant's reply.
 * The assistant's turn can contain webSearch results, i.e. arbitrary text from
 * the open web, and feeding that to a model whose job is to write durable rows
 * would turn any prompt injection on a fetched page into a permanent memory
 * that is re-injected into every future conversation.
 */
export async function extractAndStoreMemories(options: {
	userId: string;
	userText: string;
}): Promise<void> {
	try {
		// The Settings toggle turns off writes too: nothing new is learned while
		// memory is disabled, but existing rows are kept for when it is turned
		// back on.
		if (!(await isMemoryEnabled(options.userId))) return;

		// fetchUserMemories, not loadUserMemories: the read must be allowed to
		// throw here. Reconciliation is only correct if the model is shown the
		// memories that actually exist - if a transient read failure silently
		// yielded [], every stored fact would look new and get re-added as a
		// duplicate. Failing the whole extraction is the safe outcome; the outer
		// catch swallows it and the next exchange retries.
		const existing = await fetchUserMemories(options.userId);
		const existingBlock =
			existing.length > 0
				? existing.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n")
				: "(none)";

		const { model, providerOptions } = resolveModel({ effort: "low" });
		const { output } = await generateText({
			model,
			providerOptions,
			output: Output.object({ schema: memoryUpdateSchema }),
			instructions: MEMORY_EXTRACTION_INSTRUCTIONS,
			prompt: [
				`Existing memories:\n${existingBlock}`,
				`User said:\n${options.userText.slice(0, MAX_EXCHANGE_CHARACTERS)}`,
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
			// updateMany, not update: the userId in the filter makes it structurally
			// impossible to write across users even if an id ever reaches here from
			// somewhere other than this user's own rows.
			...updates.map((u) =>
				prisma.userMemory.updateMany({
					where: { id: u.id, userId: options.userId },
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

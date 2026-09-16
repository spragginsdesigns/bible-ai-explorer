import { tool } from "ai";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
	MAX_MEMORIES_PER_USER,
	MAX_MEMORY_CONTENT_LENGTH,
	MEMORY_CATEGORIES,
	MEMORY_RECORD_SELECT,
	NOT_A_PRAYER,
	prayerDefaults,
	prayerStatusUpdate,
	toUserMemoryRecord,
} from "@/lib/memory";

const MEMORY_SELECT = MEMORY_RECORD_SELECT;
const contentSchema = z.string().trim().min(1).max(MAX_MEMORY_CONTENT_LENGTH);
const NOT_AN_OPEN_PRAYER = "That is not one of the user's open prayer requests. Read your memories again.";

/** The owner comes only from authenticated server context, never model input. */
export function buildMemoryTools(userId: string) {
	async function withMemory<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
		try {
			return await prisma.$transaction(async (tx) => {
				// Serialize saves/count checks and background reconciliation for this user.
				await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
				const user = await tx.user.findUnique({ where: { id: userId }, select: { memoryEnabled: true } });
				if (user?.memoryEnabled !== true) {
					return { success: false as const, error: "Memory is off. Enable it in Settings → Memory to use memories in chat." };
				}
				return await operation(tx);
			});
		} catch (error) {
			console.error("Memory tool failed:", error);
			return { success: false as const, error: "Memory is temporarily unavailable. No change was confirmed. Try again." };
		}
	}

	return {
		listMemories: tool({
			description: "Read all saved memories for the signed-in user, including IDs needed to edit or delete them. Use for memory questions, /memory, and before changing existing memories. Never invent memory IDs.",
			inputSchema: z.object({}),
			execute: async () => withMemory(async (tx) => ({
				success: true as const,
				memories: (await tx.userMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: MAX_MEMORIES_PER_USER, select: MEMORY_SELECT })).map(toUserMemoryRecord),
			})),
		}),
		saveMemory: tool({
			description: "Save a durable fact or preference in the signed-in user's memory when they ask you to remember it. For a document or photo, save a concise useful summary and the saved note title; keep the full text in Notes. List first to avoid duplicates; update a related memory instead when appropriate. Confirm saved only if success is true.",
			inputSchema: z.object({ content: contentSchema, category: z.enum(MEMORY_CATEGORIES) }),
			execute: async ({ content, category }) => withMemory(async (tx) => {
				const existing = await tx.userMemory.findFirst({ where: { userId, content: { equals: content, mode: "insensitive" } }, select: MEMORY_SELECT });
				if (existing) return { success: true as const, created: false, memory: toUserMemoryRecord(existing) };
				if (await tx.userMemory.count({ where: { userId } }) >= MAX_MEMORIES_PER_USER) {
					return { success: false as const, error: "Memory is full. Update a related memory or ask which memories the user wants removed." };
				}
				const memory = await tx.userMemory.create({
					data: { userId, content, category, ...(category === "prayer" ? prayerDefaults(new Date()) : {}) },
					select: MEMORY_SELECT,
				});
				return { success: true as const, created: true, memory: toUserMemoryRecord(memory) };
			}),
		}),
		updateMemory: tool({
			description: "Edit one saved memory belonging to the signed-in user when they ask to correct or change it. Obtain its ID from listMemories. Preserve other facts unless the user asks to change them. Confirm updated only if success is true.",
			inputSchema: z.object({ id: z.string().min(1), content: contentSchema, category: z.enum(MEMORY_CATEGORIES) }),
			execute: async ({ id, content, category }) => withMemory(async (tx) => {
				const before = await tx.userMemory.findFirst({ where: { id, userId }, select: MEMORY_SELECT });
				if (!before) return { success: false as const, error: "Memory not found. Read your memories again before editing." };
				// Becoming a prayer request starts one being carried; ceasing to be one
				// leaves nothing behind to follow up on. A row that is already a
				// carried request keeps its own dates, so an edit to the wording does
				// not restart the request.
				const alreadyCarried = category === "prayer" && before.status !== null;
				const prayer = alreadyCarried ? {} : category === "prayer" ? prayerDefaults(new Date()) : NOT_A_PRAYER;
				const result = await tx.userMemory.updateMany({ where: { id, userId }, data: { content, category, ...prayer } });
				if (result.count !== 1) return { success: false as const, error: "Memory not found. Read your memories again before editing." };
				const memory = await tx.userMemory.findFirst({ where: { id, userId }, select: MEMORY_SELECT });
				if (!memory) throw new Error("Updated memory could not be read back.");
				return { success: true as const, memory: toUserMemoryRecord(memory) };
			}),
		}),
		resolvePrayerRequest: tool({
			description: "Mark one of the signed-in user's prayer requests answered or closed when they tell you the outcome - answered when God answered it, closed when they no longer want it carried. Read the memory id from the today block or listMemories; never invent one. Confirm only if success is true.",
			inputSchema: z.object({ id: z.string().min(1), outcome: z.enum(["answered", "closed"]) }),
			execute: async ({ id, outcome }) => withMemory(async (tx) => {
				// The where clause is the whole guard: the row must be this user's, a
				// prayer, and still open, so a stale id or a second call changes
				// nothing rather than re-resolving a request.
				const result = await tx.userMemory.updateMany({
					where: { id, userId, category: "prayer", status: "open" },
					data: prayerStatusUpdate(outcome, new Date()),
				});
				if (result.count !== 1) return { success: false as const, error: NOT_AN_OPEN_PRAYER };
				const memory = await tx.userMemory.findFirst({ where: { id, userId }, select: MEMORY_SELECT });
				if (!memory) throw new Error("Resolved prayer request could not be read back.");
				return { success: true as const, outcome, memory: toUserMemoryRecord(memory) };
			}),
		}),
		deleteMemories: tool({
			description: "Forget one or more of the signed-in user's saved memories, only when they ask to forget/delete them. Read IDs with listMemories first. To clear all memories after an explicit clear-all request, pass every ID returned. Deleting memories does not delete notes or chat history. Confirm deletion only if success is true.",
			inputSchema: z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_MEMORIES_PER_USER) }),
			execute: async ({ ids }) => withMemory(async (tx) => {
				const uniqueIds = [...new Set(ids)];
				const owned = await tx.userMemory.count({ where: { userId, id: { in: uniqueIds } } });
				if (owned !== uniqueIds.length) return { success: false as const, error: "Memory not found. Read your memories again before deleting; nothing was deleted." };
				const result = await tx.userMemory.deleteMany({ where: { userId, id: { in: uniqueIds } } });
				return { success: true as const, deleted: result.count };
			}),
		}),
	};
}

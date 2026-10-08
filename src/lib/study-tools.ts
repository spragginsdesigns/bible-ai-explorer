import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isStudyWorkRequest } from "@/lib/agent-intent";
import { resolveReference } from "@/lib/bible/books";
import { canonicalPassage } from "@/lib/bible/passage-context";
import { getChapter } from "@/lib/bible/translations";
import type { AgentStudy, Prisma } from "@prisma/client";

/** Model tool outputs must be JSON values, including database timestamps. */
function studyRecord(study: AgentStudy | null) {
	return study ? { ...study, createdAt: study.createdAt.toISOString(), updatedAt: study.updatedAt.toISOString() } : null;
}

const stateSchema = z.object({
	audience: z.string().max(200),
	passages: z.array(z.string().max(100)).max(30),
	conclusions: z.array(z.object({ statement: z.string().max(700), references: z.array(z.string().max(100)).max(8) })).max(15),
	openQuestions: z.array(z.string().max(300)).max(12),
	nextStep: z.string().max(500),
	noteIds: z.array(z.string().max(120)).max(10),
	status: z.enum(["active", "complete"]),
});

export function buildStudyTools(context: { userId: string; userText?: () => string; messageId?: () => string; knownStudyIds?: Set<string>; readStudyIds?: Set<string> }) {
	const knownIds = context.knownStudyIds ?? new Set<string>();
	return {
		findStudies: tool({
			description: "Discover this user's ongoing studies by title, goal or exact id. These results contain metadata only. Call readStudy with a returned id to obtain its conclusions, unresolved questions and next step before continuing the study or answering from its checkpoint. These are separate from personal memories.",
			inputSchema: z.object({ query: z.string().trim().max(160).optional() }),
			execute: async ({ query }) => {
				const studies = await prisma.agentStudy.findMany({ where: { userId: context.userId, ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" as const } }, { goal: { contains: query, mode: "insensitive" as const } }, { id: query }] } : {}) }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, goal: true, revision: true, updatedAt: true } });
				for (const study of studies) knownIds.add(study.id);
				return { studies: studies.map(study => ({ ...study, updatedAt: study.updatedAt.toISOString() })) };
			},
		}),
		readStudy: tool({
			description: "Read one of this user's saved studies, including its revision, established conclusions and unresolved questions. Read before revising; never invent an id.",
			inputSchema: z.object({ id: z.string().min(1).max(120).describe("The exact opaque id returned by findStudies in this turn, never its title or a guessed identifier.") }),
			execute: async ({ id }) => {
				if (!knownIds.has(id)) return { success: false, error: "Find the study by title with findStudies first, then use its returned id. A title is not an id." };
				const study = await prisma.agentStudy.findFirst({ where: { id, userId: context.userId } });
				if (study) context.readStudyIds?.add(study.id);
				return study ? { success: true, study: studyRecord(study) } : { success: false, error: "Study not found." };
			},
		}),
		saveStudy: tool({
			description: "Checkpoint a study the user explicitly asked to start, prepare, save or continue. Not for ordinary questions. Include only verified passages and supported conclusions, never private testimony. Read before revising and preserve earlier work. New records are idempotent per user message; updates require the revision read from readStudy. Material for sharing belongs in Notes too when requested.",
			inputSchema: z.object({ id: z.string().max(120).nullable().optional().describe("An EXISTING id returned by readStudy. Omit or use null to create a new study. Never put its title here or invent an id."), revision: z.number().int().positive().nullable().optional().describe("The existing revision from readStudy, only when updating. Omit or use null for a new study."), title: z.string().trim().min(1).max(160), goal: z.string().trim().min(1).max(600), state: stateSchema }),
			execute: async ({ id, revision, title, goal, state }) => {
				const sourceMessageId = context.messageId?.();
				if (!sourceMessageId || !isStudyWorkRequest(context.userText?.() ?? "")) return { success: false, error: "The user has not requested ongoing study work or saving a study in this turn." };
				const references = [...new Set([...state.passages, ...state.conclusions.flatMap(item => item.references)])];
				if (references.length > 30) return { success: false, error: "Keep a checkpoint to 30 distinct references. Store the full study in Notes." };
				try {
					await Promise.all(references.map(async reference => {
						const ref = resolveReference(reference);
						if (!ref) throw new Error("Invalid reference");
						if (ref.verse) await canonicalPassage(reference, "KJV");
						else await getChapter("KJV", ref.order, ref.chapter);
					}));
				} catch { return { success: false, error: "A Scripture reference does not exist or is not a supported bounded passage. Retrieve and check every endpoint before saving." }; }
				if (state.noteIds.length && await prisma.note.count({ where: { userId: context.userId, id: { in: state.noteIds } } }) !== new Set(state.noteIds).size) return { success: false, error: "A linked note does not belong to this user." };
				const data = { title, goal, state: state as Prisma.InputJsonValue };
				if (id) {
					if (!revision) return { success: false, error: "Read the study's current revision first." };
					const changed = await prisma.agentStudy.updateMany({ where: { id, userId: context.userId, revision }, data: { ...data, revision: { increment: 1 } } });
					if (changed.count !== 1) return { success: false, error: "Study missing or changed since it was read. Read it again before updating." };
					return { success: true, study: studyRecord(await prisma.agentStudy.findFirst({ where: { id, userId: context.userId } })) };
				}
				const study = await prisma.agentStudy.upsert({ where: { userId_sourceMessageId: { userId: context.userId, sourceMessageId } }, create: { userId: context.userId, sourceMessageId, ...data }, update: {} });
				knownIds.add(study.id);
				return { success: true, study: studyRecord(study) };
			},
		}),
	};
}

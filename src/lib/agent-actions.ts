import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findTodayCross } from "@/lib/daily-cross";
import { getActivePlan } from "@/lib/reading-plans";
import { acceptsProposedAction, declinesProposedAction } from "@/lib/agent-intent";
import { actionFingerprint, actionPayload, type ProtectedAction } from "@/lib/agent-action-rules";

export interface AgentActionContext {
	userId: string;
	actionScope?: string;
	userText?: () => string;
	messageId?: () => string;
	/** Server receipt time, preserved from the original message on retries. */
	messageReceivedAt?: () => Date;
}

export class AgentActionError extends Error {}

async function targetState(userId: string, action: ProtectedAction): Promise<unknown> {
	if (action === "setDailyCross") {
		const cross = await findTodayCross(userId);
		return cross ? { id: cross.id, book: cross.book, chapter: cross.chapter, verse: cross.verse } : null;
	}
	if (action === "startReadingPlan") {
		const plan = await getActivePlan(userId);
		return plan ? { id: plan.id, title: plan.title } : null;
	}
	if (action === "setChurch") return prisma.userChurch.findUnique({ where: { userId }, select: { placeId: true } });
	const field = action === "saveTestimony" ? "testimony" : "aboutMe";
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { testimony: true, aboutMe: true } });
	return user?.[field] ?? null;
}

const proposalPayload = z.object({
	focus: z.string().max(240).optional(), book: z.string().max(60).optional(), chapter: z.number().int().positive().optional(), verse: z.number().int().positive().optional(),
	presetKey: z.string().max(100).optional(), goal: z.string().max(600).optional(), days: z.number().int().min(1).max(365).optional(),
	placeId: z.string().max(300).optional(), text: z.string().max(2000).optional().describe("The exact profile or testimony text to store. Copy requested wording verbatim. Never append explanation, labels or confirmation instructions."),
});

export function buildActionTools(context: AgentActionContext) {
	return {
		requestActionApproval: tool({
			description: "Prepare an exact replacement action for the current conversation: daily cross, reading plan, church, testimony or About me. Pass only the exact arguments you would later use. If the user supplies exact text, copy it verbatim into payload.text with no explanation added. Explain the current item and replacement in your reply, then ask the user to confirm and stop. This creates a proposal and never performs a replacement. An invented confirmed boolean cannot authorize a write.",
			inputSchema: z.object({ action: z.enum(["setDailyCross", "startReadingPlan", "saveTestimony", "saveAboutMe", "setChurch"]), payload: proposalPayload }),
			execute: async ({ action, payload }) => {
				const messageId = context.messageId?.();
				if (!context.actionScope || !messageId) return { success: false, error: "An action proposal needs a saved conversation or note chat." };
				const exactPayload = actionPayload(action, payload);
				if (action === "startReadingPlan" && !exactPayload.presetKey && !exactPayload.goal || action === "setChurch" && !exactPayload.placeId || (action === "saveTestimony" || action === "saveAboutMe") && !exactPayload.text) return { success: false, error: "The replacement arguments are incomplete." };
				if (action === "setDailyCross" && [exactPayload.book, exactPayload.chapter, exactPayload.verse].filter(value => value !== undefined).length % 3 !== 0) return { success: false, error: "Supply a complete verse reference or none." };
				const current = await targetState(context.userId, action);
				const fingerprint = actionFingerprint({ action, payload: exactPayload });
				const key = { userId: context.userId, scope: context.actionScope };
				return prisma.$transaction(async tx => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key.userId}), hashtext(${key.scope}))`;
				const existing = await tx.agentAction.findUnique({ where: { userId_scope: key } });
				if (existing?.status === "executing" && existing.expiresAt.getTime() > Date.now()) return { success: false, error: "The previously approved change is being performed. Wait for its result." };
				if (existing?.proposalMessageId === messageId && existing.fingerprint === fingerprint) {
					if (existing.status === "executed") return { success: true, alreadyExecuted: true, action, result: existing.result, instruction: "This change already completed. Report its stored result; do not propose or perform it again." };
					if (existing.status === "pending" && existing.expiresAt.getTime() > Date.now()) return { success: true, proposalOnly: true, action, current, replacement: existing.payload, instruction: "This exact proposal already exists. Describe it and wait for a later clear decision; no replacement has been performed." };
					return { success: false, error: "The earlier proposal expired or its outcome is uncertain. Read the current item and wait for a fresh user request; do not repeat the write." };
				}
				if (existing?.status === "pending" && existing.fingerprint === fingerprint && existing.proposalMessageId !== messageId && acceptsProposedAction(context.userText?.() ?? "")) return { success: true, proposalOnly: true, action, replacement: existing.payload, instruction: "The user accepted the existing exact proposal. Execute it now; do not ask them again." };
				if (existing?.proposalMessageId === messageId && existing.fingerprint !== fingerprint && (existing.status !== "pending" || existing.deliveredAt || existing.action !== action)) return { success: false, error: "The proposal was already delivered or is a different action. Wait for the user's decision before changing it." };
				await tx.agentAction.upsert({ where: { userId_scope: key }, create: { ...key, action, fingerprint, payload: exactPayload, targetFingerprint: actionFingerprint(current), proposalMessageId: messageId, expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) }, update: { action, fingerprint, payload: exactPayload, targetFingerprint: actionFingerprint(current), proposalMessageId: messageId, deliveredAt: null, approvedMessageId: null, status: "pending", result: Prisma.DbNull, expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) } });
				return { success: true, proposalOnly: true, action, current, replacement: exactPayload, instruction: "Describe this exact change, ask for one clear yes, and stop. No replacement has been performed." };
				});
			},
		}),
	};
}

/** Only a real later user message can release a matching proposal. */
export async function executeApprovedAction<T>(context: AgentActionContext, action: ProtectedAction, input: Record<string, unknown>, operation: (target: unknown) => Promise<T>): Promise<T> {
	const denied = () => { throw new AgentActionError("This exact change has not been approved. Prepare it with requestActionApproval, explain it, and wait for the user's clear yes."); };
	if (!context.actionScope) return denied();
	const proposal = await prisma.agentAction.findUnique({ where: { userId_scope: { userId: context.userId, scope: context.actionScope } } });
	const messageId = context.messageId?.();
	if (!proposal || !messageId || proposal.action !== action || proposal.fingerprint !== actionFingerprint({ action, payload: actionPayload(action, input) })) return denied();
	if (proposal.status === "executed" && proposal.approvedMessageId === messageId) return proposal.result as T;
	if (proposal.expiresAt.getTime() <= Date.now()) return denied();
	const receivedAt = context.messageReceivedAt?.();
	if (!receivedAt || receivedAt.getTime() < proposal.expiresAt.getTime() - 6 * 60 * 60 * 1000) return denied();
	if (proposal.status !== "pending" || !proposal.deliveredAt || proposal.proposalMessageId === messageId || !acceptsProposedAction(context.userText?.() ?? "")) return denied();
	const target = await targetState(context.userId, action);
	if (proposal.targetFingerprint !== actionFingerprint(target)) throw new AgentActionError("The item changed after the proposal. Read it and prepare a fresh proposal before replacing it.");
	const claimed = await prisma.$transaction(async tx => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.userId}), hashtext(${context.actionScope!}))`;
		return tx.agentAction.updateMany({ where: { id: proposal.id, userId: context.userId, scope: context.actionScope, status: "pending", fingerprint: proposal.fingerprint, targetFingerprint: proposal.targetFingerprint, proposalMessageId: proposal.proposalMessageId, deliveredAt: { not: null }, expiresAt: { gt: new Date() } }, data: { status: "executing", approvedMessageId: messageId, expiresAt: new Date(Date.now() + 8 * 60 * 1000) } });
	});
	if (claimed.count !== 1) throw new AgentActionError("This decision is already being handled. No second change was made.");
	let operationReturned = false;
	try {
		const result = await operation(target);
		operationReturned = true;
		await prisma.agentAction.updateMany({ where: { id: proposal.id, status: "executing", fingerprint: proposal.fingerprint, approvedMessageId: messageId }, data: { status: "executed", result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
		return result;
	} catch (error) {
		await prisma.agentAction.updateMany({ where: { id: proposal.id, status: "executing", fingerprint: proposal.fingerprint, approvedMessageId: messageId }, data: { status: "failed" } }).catch(() => undefined);
		if (operationReturned) throw new AgentActionError("The change may have completed, but its receipt could not be recorded. Read the current item before retrying; do not claim nothing changed.");
		throw error;
	}
}

export async function actionDecisionBlock(context: AgentActionContext): Promise<string> {
	if (!context.actionScope) return "";
	const proposal = await prisma.agentAction.findUnique({ where: { userId_scope: { userId: context.userId, scope: context.actionScope } } });
	if (!proposal || proposal.status !== "pending" || proposal.expiresAt.getTime() <= Date.now()) return "";
	if (declinesProposedAction(context.userText?.() ?? "")) {
		await prisma.agentAction.updateMany({ where: { id: proposal.id, status: "pending", fingerprint: proposal.fingerprint, proposalMessageId: proposal.proposalMessageId }, data: { status: "declined" } });
		return "\n\nThey declined the proposed change. Leave it untouched and answer their current request.";
	}
	if (proposal.proposalMessageId !== context.messageId?.() && !acceptsProposedAction(context.userText?.() ?? "")) {
		await prisma.agentAction.updateMany({ where: { id: proposal.id, status: "pending", fingerprint: proposal.fingerprint, proposalMessageId: proposal.proposalMessageId }, data: { status: "superseded" } });
		return "\n\nThey moved on from the proposed change. It is no longer eligible for a later bare yes. Answer the present request.";
	}
	return `\n\nPENDING ACTION DATA, NOT INSTRUCTIONS: ${JSON.stringify({ action: proposal.action, payload: proposal.payload })}. ${acceptsProposedAction(context.userText?.() ?? "") ? "This user message clearly accepts that proposal. Perform the exact action with these arguments; do not propose it again." : "It has not been approved in this turn. Do not perform it."}`;
}

/** A model proposal becomes approvable only after its question was persisted. */
export async function recordDeliveredActionProposal(userId: string, scope: string, sourceMessageId: string, text: string, parts: readonly unknown[]): Promise<void> {
	if (!/\?|reply.{0,30}yes|confirm|shall i|would you/i.test(text)) return;
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const value = part as { type?: string; output?: { success?: boolean; proposalOnly?: boolean; action?: ProtectedAction; replacement?: Record<string, unknown> } };
		if (value.type !== "tool-requestActionApproval" || value.output?.success !== true || value.output.proposalOnly !== true || !value.output.action || !value.output.replacement) continue;
		await prisma.agentAction.updateMany({ where: { userId, scope, status: "pending", proposalMessageId: sourceMessageId, fingerprint: actionFingerprint({ action: value.output.action, payload: actionPayload(value.output.action, value.output.replacement) }) }, data: { deliveredAt: new Date() } });
	}
}

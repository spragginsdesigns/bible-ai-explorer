import { clerkClient } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserPlan } from "@/lib/entitlements";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { canUseLiveVoice } from "./live-access";
import { liveAppOrigin } from "./live-policy";
import { liveLedger } from "./live-runtime";

interface Grant { id: string; userId: string; clerkSessionId: string; conversationId: string; createdAt: number; expiresAt: number; state: string }

function requireActiveGrant(grant: Grant) {
	const current = liveLedger().get(grant.id);
	if (!current || current.state !== "active" || current.expiresAt <= Date.now() || current.userId !== grant.userId || current.conversationId !== grant.conversationId) throw new Error("Voice session has ended.");
}

export async function authorizeLiveGrant(grant: Grant) {
	if (grant.state !== "active" || grant.expiresAt <= Date.now()) throw new Error("Voice session has ended.");
	const client = await clerkClient();
	const session = await client.sessions.getSession(grant.clerkSessionId);
	if (!await canUseLiveVoice(grant.userId)) throw new Error("Live voice is not enabled for this account.");
	if (session.userId !== grant.userId || session.status !== "active" || await getUserPlan(grant.userId) !== "pro") throw new Error("An active SureWord Pro session is required.");
	const user = await prisma.user.findUnique({ where: { id: grant.userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
	if (!hasCurrentAiConsent(user)) throw new Error("AI data sharing is turned off.");
	if (!await prisma.conversation.findFirst({ where: { id: grant.conversationId, userId: grant.userId }, select: { id: true } })) throw new Error("Conversation not found.");
	requireActiveGrant(grant);
	return client;
}

export async function liveHistory(grant: Grant) {
	const rows = await prisma.message.findMany({ where: { conversationId: grant.conversationId, conversation: { userId: grant.userId } }, orderBy: { createdAt: "desc" }, take: 24 });
	return rows.reverse();
}

/** Actual provider transcripts only. Preserve the canonical answer and each spoken segment. */
export async function saveLiveTranscript(grant: Grant, input: { messageId: string; role: "user" | "assistant"; text: string; assistantMessageId?: string; complete: boolean; startMs?: number; endMs?: number }) {
	const targetId = input.assistantMessageId || input.messageId;
	await prisma.$transaction(async tx => {
		await tx.$queryRaw`SELECT id FROM "Message" WHERE id = ${targetId} FOR UPDATE`;
		const row = await tx.message.findUnique({ where: { id: targetId } });
		if (row && (row.conversationId !== grant.conversationId || row.role !== input.role)) throw new Error("Transcript identity mismatch.");
		if (!row && input.assistantMessageId) throw new Error("The answer has not been saved yet.");
		if (!await tx.conversation.findFirst({ where: { id: grant.conversationId, userId: grant.userId }, select: { id: true } })) throw new Error("Conversation not found.");
		const metadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
		const prior = metadata.liveSpoken && typeof metadata.liveSpoken === "object" && !Array.isArray(metadata.liveSpoken) ? metadata.liveSpoken as Record<string, unknown> : {};
		const segments = (Array.isArray(prior.segments) ? prior.segments : []).filter(value => value && typeof value === "object" && (value as { id?: unknown }).id !== input.messageId);
		segments.push({ id: input.messageId, sessionId: grant.id, transcript: input.text, complete: input.complete, startMs: input.startMs ?? 0, endMs: input.endMs ?? 0 });
		if (segments.length > 256) throw new Error("Too many speech segments for one answer.");
		const next = { ...metadata, liveSpoken: { source: "gpt-live-1", segments } } as Prisma.InputJsonValue;
		await tx.message.upsert({ where: { id: targetId }, create: { id: targetId, role: input.role, content: input.text, conversationId: grant.conversationId, metadata: next, createdAt: new Date(grant.createdAt + (input.startMs ?? 0)) }, update: { ...(input.assistantMessageId ? {} : { content: input.text }), metadata: next } });
		await tx.conversation.update({ where: { id: grant.conversationId }, data: { updatedAt: new Date() } });
	});
}

/** Delegate through the real route so tools, doctrine, usage, and persistence stay shared. */
export async function delegateLiveTurn(grant: Grant, input: { turnId: string; userMessageId: string; text: string }) {
	const client = await authorizeLiveGrant(grant);
	requireActiveGrant(grant);
	const claimed = liveLedger().claimTurn(grant.id, input.turnId, input.userMessageId, input.text);
	if (!claimed.claimed) {
		const turn = liveLedger().getTurn(grant.id, input.turnId);
		if (turn?.result) return turn.result;
		throw new Error("This spoken request is already being processed. It will not be sent twice.");
	}
	const history = await liveHistory(grant);
	const token = await client.sessions.getToken(grant.clerkSessionId);
	const messages = history.filter(row => row.id !== input.userMessageId).map(row => ({ id: row.id, role: row.role, parts: [{ type: "text", text: row.content }], metadata: row.metadata }));
	messages.push({ id: input.userMessageId, role: "user", parts: [{ type: "text", text: input.text }], metadata: { inputMode: "live-voice", liveSessionId: grant.id } });
	requireActiveGrant(grant);
	const response = await fetch(`${liveAppOrigin(process.env)}/api/ask-question`, {
		method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.jwt}`, "Idempotency-Key": input.turnId, "x-sureword-client": "web" },
		body: JSON.stringify({ conversationId: grant.conversationId, messages, translation: "KJV", language: "en", notificationAttemptId: input.turnId }),
		signal: AbortSignal.timeout(320_000),
	});
	if (!response.ok || !response.body) throw new Error(`SureWord could not finish that request (${response.status}).`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder(); let buffer = ""; let assistantId: string | null = null; let streamError = false;
	const consume = (line: string) => {
		if (!line.startsWith("data: ") || line === "data: [DONE]") return;
		try { const event = JSON.parse(line.slice(6)); if (event.type === "start" && typeof event.messageId === "string") assistantId = event.messageId; if (event.type === "error") streamError = true; } catch { /* Empty keepalives are not content. */ }
	};
	while (true) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		let end: number; while ((end = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1); }
		if (done) break;
	}
	consume(buffer);
	if (!assistantId) throw new Error("The answer did not return a saved message identity.");
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const row = await prisma.message.findFirst({ where: { id: assistantId, role: "assistant", conversationId: grant.conversationId, conversation: { userId: grant.userId } }, select: { id: true, content: true, metadata: true } });
		if (row) {
			const result = { assistantMessageId: row.id, text: row.content, toolParts: row.metadata && typeof row.metadata === "object" && "parts" in row.metadata ? row.metadata.parts : [], streamError };
			await saveLiveTranscript(grant, { messageId: input.userMessageId, role: "user", text: input.text, complete: true });
			liveLedger().finishTurn(grant.id, input.turnId, result);
			return result;
		}
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	throw new Error("The answer could not be confirmed saved. Please check chat before trying again.");
}

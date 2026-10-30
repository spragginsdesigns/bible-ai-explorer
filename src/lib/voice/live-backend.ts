import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getUserPlan } from "@/lib/entitlements";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { historyService, readHistoryList } from "@/lib/ai/history/runtime.server";
import { reviewedAssistantTurns } from "@/lib/ai/history/model-context";
import { canUseLiveVoice } from "./live-access";
import { liveAppOrigin } from "./live-policy";
import { liveLedger } from "./live-runtime";

interface Grant { id: string; userId: string; clerkSessionId: string; conversationId: string; createdAt: number; expiresAt: number; state: string }
type TranscriptInput = { messageId: string; role: "user" | "assistant"; text: string; assistantMessageId?: string; complete: boolean; startMs?: number; endMs?: number };
const DELEGATE_MS = 285_000;
const SAVE_MARGIN_MS = 12_000;
// Existing SQLite busy_timeout is 5s; do not begin a write near the budget boundary.
const LEDGER_MARGIN_MS = 5_100;

function requireActiveGrant(grant: Grant) {
	const current = liveLedger().get(grant.id);
	if (!current || current.state !== "active" || current.expiresAt <= Date.now() || current.userId !== grant.userId || current.clerkSessionId !== grant.clerkSessionId || current.conversationId !== grant.conversationId) throw new Error("Voice session has ended.");
}

export async function authorizeLiveGrant(grant: Grant, check = () => requireActiveGrant(grant)) {
	check();
	const client = await clerkClient(); check();
	const session = await client.sessions.getSession(grant.clerkSessionId); check();
	const allowed = await canUseLiveVoice(grant.userId); check();
	if (!allowed) throw new Error("Live voice is not enabled for this account.");
	const plan = await getUserPlan(grant.userId); check();
	if (session.userId !== grant.userId || session.status !== "active" || plan !== "pro") throw new Error("An active SureWord Pro session is required.");
	const user = await prisma.user.findUnique({ where: { id: grant.userId }, select: { aiConsentVersion: true, aiConsentAt: true } }); check();
	if (!hasCurrentAiConsent(user)) throw new Error("AI data sharing is turned off.");
	const parent = await prisma.conversation.findFirst({ where: { id: grant.conversationId, userId: grant.userId }, select: { id: true } }); check();
	if (!parent) throw new Error("Conversation not found.");
	return client;
}

/** Only the same reviewed projection accepted by future model context can be spoken. */
export async function liveHistory(grant: Grant, check = () => requireActiveGrant(grant)) {
	check();
	const batch = await readHistoryList(grant.userId, "chat", grant.conversationId); check();
	if (!batch) throw new Error("Conversation not found.");
	const rows = batch.rows.slice(-24);
	const reviewed = await reviewedAssistantTurns(batch.service, grant.userId, "chat", grant.conversationId, rows.filter(row => row.role === "assistant")); check();
	const safe = new Map(reviewed.map(row => [row.id, row]));
	return rows.flatMap(row => row.role === "user" ? [{ id: row.id, role: "user", content: row.content, metadata: row.metadata }] : safe.has(row.id) ? [{ ...safe.get(row.id)!, role: "assistant" }] : []);
}

/** Provider transcripts stay separate from certified source rows, including historical liveSpoken. */
export async function saveLiveTranscript(grant: Grant, input: TranscriptInput, check = () => {}) {
	if (input.assistantMessageId && input.role !== "assistant") throw new Error("Transcript identity mismatch.");
	const targetId = input.assistantMessageId || input.messageId;
	await prisma.$transaction(async tx => {
		check();
		await tx.$queryRaw`SELECT id FROM "Message" WHERE id = ${targetId} FOR UPDATE`; check();
		const row = await tx.message.findUnique({ where: { id: targetId } }); check();
		if (row && (row.conversationId !== grant.conversationId || row.role !== input.role)) throw new Error("Transcript identity mismatch.");
		if (!row && input.assistantMessageId) throw new Error("The answer has not been saved yet.");
		const parent = await tx.conversation.findFirst({ where: { id: grant.conversationId, userId: grant.userId }, select: { id: true } }); check();
		if (!parent) throw new Error("Conversation not found.");
		// Early user speech and provider acknowledgments have no canonical row yet.
		// Only an existing, owner/parent/role-validated row may become their anchor.
		liveLedger().saveTranscript(grant, { segmentId: input.messageId, role: input.role, text: input.text, complete: input.complete, startMs: input.startMs, endMs: input.endMs, canonicalMessageId: row?.id ?? null });
	});
}

async function savedAnswer(grant: Grant, messageId: string, check: () => void) {
	check();
	const result = await historyService.get(grant.userId, { surface: "chat", parentId: grant.conversationId, messageId }); check();
	if (result.status === 404) return null;
	const rows = await reviewedAssistantTurns({ get: async () => result }, grant.userId, "chat", grant.conversationId, [{ id: messageId, content: "", metadata: null }]); check();
	if (rows.length !== 1) throw new Error("The saved answer is not currently approved for speech. Please review it in chat.");
	return { ...rows[0], metadata: rows[0].metadata as { parts: unknown[] } };
}

/** Delegate once through the real route. A timeout leaves the claim pending, never retries tools. */
export async function delegateLiveTurn(grant: Grant, input: { turnId: string; userMessageId: string; text: string }) {
	const deadline = Date.now() + DELEGATE_MS;
	const controller = new AbortController();
	let expired = false;
	const check = () => {
		if (expired || Date.now() >= deadline) throw new Error("The voice request timed out. Check saved chat before repeating an action.");
		requireActiveGrant(grant);
		// SQLite reads are synchronous and can themselves wait for a writer.
		if (expired || Date.now() >= deadline) throw new Error("The voice request timed out. Check saved chat before repeating an action.");
	};
	const reserveLedgerWrite = () => {
		check();
		if (deadline - Date.now() < LEDGER_MARGIN_MS || grant.expiresAt - Date.now() < LEDGER_MARGIN_MS) throw new Error("There is not enough time to confirm this voice request. Check saved chat before repeating an action.");
	};
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => { expired = true; controller.abort(); reject(new Error("The voice request timed out. Check saved chat before repeating an action.")); }, DELEGATE_MS);
	});
	const run = async () => {
		const client = await authorizeLiveGrant(grant, check); check();
		reserveLedgerWrite();
		const claimed = liveLedger().claimTurn(grant.id, input.turnId, input.userMessageId, input.text, { deadline }); check();
		const turn = claimed.turn;
		if (turn.turnId !== input.turnId || turn.userMessageId !== input.userMessageId || turn.text !== input.text) throw new Error("Spoken request identity mismatch.");
		if (!claimed.claimed) {
			if (!turn.result) throw new Error("This spoken request is already being processed. It will not be sent twice.");
			const row = await savedAnswer(grant, turn.result.assistantMessageId, check);
			if (!row) throw new Error("The saved answer no longer exists.");
			return { assistantMessageId: row.id, text: row.content, toolParts: row.metadata!.parts, streamError: turn.result.streamError };
		}
		const history = await liveHistory(grant, check); check();
		const token = await client.sessions.getToken(grant.clerkSessionId); check();
		const messages = history.filter(row => row.id !== input.userMessageId).map(row => ({ id: row.id, role: row.role, parts: [{ type: "text", text: row.content }], metadata: row.metadata }));
		messages.push({ id: input.userMessageId, role: "user", parts: [{ type: "text", text: input.text }], metadata: { inputMode: "live-voice", liveSessionId: grant.id } });
		const fetchMs = Math.min(270_000, deadline - Date.now() - SAVE_MARGIN_MS);
		if (fetchMs <= 0) throw new Error("There is not enough time to confirm this voice request. It was not sent.");
		check();
		const response = await fetch(`${liveAppOrigin(process.env)}/api/ask-question`, {
			method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.jwt}`, "Idempotency-Key": input.turnId, "x-sureword-client": "web" },
			body: JSON.stringify({ conversationId: grant.conversationId, messages, translation: "KJV", language: "en", notificationAttemptId: input.turnId }),
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(fetchMs)]),
		}); check();
		if (!response.ok || !response.body) throw new Error(`SureWord could not finish that request (${response.status}).`);
		const reader = response.body.getReader();
		const decoder = new TextDecoder(); let buffer = ""; let assistantId: string | null = null; let streamError = false;
		const consume = (line: string) => {
			if (!line.startsWith("data: ") || line === "data: [DONE]") return;
			try { const event = JSON.parse(line.slice(6)); if (event.type === "start" && typeof event.messageId === "string") assistantId = event.messageId; if (event.type === "error") streamError = true; } catch { /* Empty keepalives are not content. */ }
		};
		while (true) {
			const { value, done } = await reader.read(); check();
			buffer += decoder.decode(value, { stream: !done });
			let end: number; while ((end = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1); }
			if (done) break;
		}
		consume(buffer);
		if (!assistantId) throw new Error("The answer did not return a saved message identity.");
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const row = await savedAnswer(grant, assistantId, check);
			if (row) {
				// Bind the existing captured speech only after the real ask route saved its user row.
				await prisma.$transaction(async tx => {
					await tx.$queryRaw`SELECT id FROM "Message" WHERE id = ${input.userMessageId} FOR UPDATE`; check();
					const user = await tx.message.findUnique({ where: { id: input.userMessageId } }); check();
					const parent = await tx.conversation.findFirst({ where: { id: grant.conversationId, userId: grant.userId }, select: { id: true } }); check();
					if (!parent || !user || user.conversationId !== grant.conversationId || user.role !== "user" || user.content.trim() !== input.text.trim()) throw new Error("The spoken request could not be confirmed saved.");
					const captured = liveLedger().getTranscript(grant, input.userMessageId);
					if (!captured || captured.role !== "user" || captured.text.trim() !== input.text.trim()) throw new Error("The spoken transcript could not be confirmed.");
					reserveLedgerWrite();
					liveLedger().bindTranscript(grant, input.userMessageId, user.id, "user", undefined, { deadline }); check();
				}); check();
				const result = { assistantMessageId: row.id, text: row.content, toolParts: row.metadata!.parts, streamError };
				reserveLedgerWrite();
				liveLedger().finishTurn(grant.id, input.turnId, result, { deadline }); check();
				return result;
			}
			await new Promise(resolve => setTimeout(resolve, 300)); check();
		}
		throw new Error("The answer could not be confirmed saved. Please check chat before trying again.");
	};
	try { return await Promise.race([run(), timeout]); }
	finally { expired = true; clearTimeout(timer!); controller.abort(); }
}

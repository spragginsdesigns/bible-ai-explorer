import { readingTimezone } from "@/lib/reading-time";
import { readingRequestContext } from "@/lib/reading-tools";
import {
	convertToModelMessages,
	createIdGenerator,
	createUIMessageStream,
	createUIMessageStreamResponse,
	isStepCount,
	streamText,
	toUIMessageStream,
	validateUIMessages,
	type UIMessage,
} from "ai";
import { plainDashes } from "@/lib/ai/plain-dashes";
import { SCRIPTURE_OUTPUT_GUIDANCE, verifyGeneratedAnswer } from "@/lib/ai/verified-generation";
import { releaseVerifiedAnswer } from "@/lib/ai/verified-answer-stream";
import { readSavedNoteEvidence, successfulNoteWriteId } from "@/lib/ai/note-write-evidence";
import { withoutOrphanedOpenAIReferences } from "@/lib/chat/modelHistory";
import { assistantHistoryIds, HISTORY_EVIDENCE_GUIDANCE, trustedAssistantHistory } from "@/lib/chat/trusted-history";
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSureWordTools, type SureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { AiCredentialError, resolveModel, aiAccessFor, resolveVerificationModel } from "@/lib/ai/provider";
import { UserFacingError, chatErrorPayload, streamErrorText } from "@/lib/ai/errors";
import {
	hasPersistableContent,
	persistableParts,
	startStatusNarration,
} from "@/lib/ai/status-narration";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { actionDecisionBlock, recordDeliveredActionProposal } from "@/lib/agent-actions";
import { finishAgentWork, incompleteAgentNotice, mustReadStudy } from "@/lib/ai/agent-loop";
import { isStudyWorkRequest } from "@/lib/agent-intent";
import { joinAssistantTextParts } from "@/utils/assistantMarkdown";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { usedMemoryTools } from "@/lib/memory-policy";
import { describeNoteLinks } from "@/lib/note-links";
import { loadUserChurch } from "@/lib/church";
import { formatChurchBlock } from "@/lib/church-rules";
import {
	noteAISystemPrompt,
	noteAIStablePrompt,
	nextStepGuidance,
} from "@/utils/systemPrompt";
import { buildPromptCachePlan, splitStableSystemPrefix } from "@/lib/ai/prompt-cache";
import { logChatStepMetric } from "@/lib/ai/chat-metrics";
import { TOOL_LOOP_BUDGET_MS, isOverTimeBudget } from "@/lib/ai/tool-loop-budget";
import {
	readStoredAboutMe,
	readStoredHighlightLabels,
	readStoredHighlightMeanings,
	readStoredTestimony,
} from "@/lib/preferences-contract";
import { loadHighlightLegend } from "@/lib/highlight-legend";
import { claimNoteAIOperation, noteAIOperationId, noteAIRequestHash, settleNoteAIOperation, withNoteAIHistory, NoteAIOperationError, type NoteAIWriteOperation } from "@/lib/note-ai-operations";
import {
	formatAboutMeBlock,
	formatHighlightLegendBlock,
	formatTestimonyBlock,
} from "@/lib/highlight-legend-rules";

// Matches vercel.json for this route. Same guard as ask-question: a slow
// provider several tool steps into a turn was killed mid-loop by the platform,
// which runs no callback, so the turn vanished with nothing logged. See
// TOOL_LOOP_BUDGET_MS for the guard that stops the loop before that happens.
export const maxDuration = 300;

const MAX_REQUEST_MESSAGES = 16;
const MAX_NOTE_CONTENT_LENGTH = 16000;

// Same empty-id guard as ask-question: without a server-generated id the
// response message id is "" and every persist upsert collides on one row.
const generateMessageId = createIdGenerator({ prefix: "msg", size: 24 });

// User turns are always a single text part, so plain concatenation is right
// for them. Assistant turns are not - see extractAssistantText.
function extractText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * Assistant text, joined the way the clients join it. Identical rule to
 * src/app/api/ask-question/route.ts: the AI SDK splits one turn into several
 * text parts around tool calls, so joining with "" glues the next block onto
 * the previous sentence and the markdown never parses. Empty parts are dropped
 * so they cannot fabricate a paragraph break the model never wrote.
 */
function extractAssistantText(message: UIMessage): string {
	const textParts: string[] = [];
	for (const part of message.parts) {
		if (part.type === "text" && part.text.trim()) textParts.push(part.text);
	}
	return joinAssistantTextParts(textParts).trim();
}

async function persistExchange(options: {
	userId: string;
	noteId: string;
	userMessage: UIMessage;
	responseMessage: UIMessage;
	operation?: NoteAIWriteOperation;
}): Promise<void> {
	if (!hasPersistableContent(options.responseMessage)) return;
	try {
		const saved = await withNoteAIHistory(options.operation, async db => {
			const note = await db.note.findFirst({
				where: { id: options.noteId, userId: options.userId },
				select: { id: true },
			});
			if (!note) return false;

			const userText = extractText(options.userMessage);
			const assistantText = extractAssistantText(options.responseMessage);

			if (userText) {
				await db.noteAIMessage.upsert({
					where: { id: options.userMessage.id },
					update: {},
					create: {
						id: options.userMessage.id,
						noteId: note.id,
						role: "user",
						content: userText,
					},
				});
			}

			const metadataJson = JSON.parse(
				JSON.stringify({ parts: persistableParts(options.responseMessage.parts) })
			);

			// Belt-and-braces: never upsert with an empty id (see generateMessageId).
			const responseMessageId = options.responseMessage.id.trim()
				? options.responseMessage.id
				: generateMessageId();

			await db.noteAIMessage.upsert({
				where: { id: responseMessageId },
				update: { content: assistantText, metadata: metadataJson },
				create: {
					id: responseMessageId,
					noteId: note.id,
					role: "assistant",
					content: assistantText,
					metadata: metadataJson,
				},
			});
			return true;
		}, true);
		if (!saved.accepted || !saved.value) return;
		const userText = extractText(options.userMessage);
		const assistantText = extractAssistantText(options.responseMessage);
		await recordDeliveredActionProposal(options.userId, `note:${options.noteId}`, options.userMessage.id, assistantText, options.responseMessage.parts);

		if (userText && !usedMemoryTools(options.responseMessage.parts)) {
			await extractAndStoreMemories({ userId: options.userId, userText });
		}
	} catch (error) {
		console.error("Failed to persist note AI exchange:", error);
	}
}

import { withIncludedAiRequest, reserveIncludedRequest } from "@/lib/billing/usage";
import { createRateLimiter } from "@/lib/rateLimit";
const noteAiLimiter = createRateLimiter({ limit: 20, windowMs: 5 * 60_000 });
export const POST = withIncludedAiRequest(handlePost, "note-ai");

async function handlePost(req: Request): Promise<Response> {
	const readingReceivedAt = new Date();
	let claimedOperation: NoteAIWriteOperation | undefined;
	try {
		const userId = await getAuthUser();
		const rate = noteAiLimiter.check(userId);
		if (!rate.allowed) return NextResponse.json(
			chatErrorPayload("rate_limited", "Too many note AI requests. Try again shortly."),
			{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
		);

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};

		if (typeof requestData.noteId !== "string" || !requestData.noteId) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: 'noteId' is required."),
				{ status: 400 }
			);
		}
		if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: 'messages' must be a non-empty array."),
				{ status: 400 }
			);
		}

		const note = await prisma.note.findFirst({
			where: { id: requestData.noteId, userId },
			select: { id: true, title: true, plainText: true },
		});
		if (!note) {
			return NextResponse.json(
				chatErrorPayload("conversation_not_found", "Note not found."),
				{ status: 404 }
			);
		}
		const operation: NoteAIWriteOperation | undefined = requestData.operationId === undefined ? undefined : {
			id: noteAIOperationId(requestData.operationId), userId, noteId: note.id,
		};

		const userPrefs = await prisma.user.findUnique({
			where: { id: userId },
			select: {
				webSearchEnabled: true,
				highlightLabels: true,
				highlightMeanings: true,
				aboutMe: true,
				testimony: true,
			},
		});
		// Same lenient read as the chat route, so getHighlights names a colour
		// the way the user does here too.
		const highlightLabels = readStoredHighlightLabels(userPrefs?.highlightLabels);
		const highlightMeanings = readStoredHighlightMeanings(userPrefs?.highlightMeanings);
		const aboutMe = readStoredAboutMe(userPrefs?.aboutMe);
		const testimony = readStoredTestimony(userPrefs?.testimony);
		const readingContext = {
			...readingRequestContext(requestData, readingReceivedAt),
			userId,
			defaultNoteId: note.id,
			webSearchEnabled: userPrefs?.webSearchEnabled ?? true,
			highlightLabels,
		};
		let currentUserText = "";
		let currentMessageId = "";
		const actionContext = { userId, actionScope: `note:${note.id}`, userText: () => currentUserText, messageId: () => currentMessageId, messageReceivedAt: () => readingReceivedAt };
		const knownStudyIds = new Set<string>();
		const readStudyIds = new Set<string>();
		let contentVerifier: ((blocks: { id: string; text: string }[], purpose: string) => Promise<{ id: string; text: string }[] | null>) | undefined;
		const tools = buildSureWordTools({ ...readingContext, ...actionContext, knownStudyIds, readStudyIds,
			noteOperation: operation,
			verifyGeneratedContent: async (blocks, purpose) => contentVerifier ? contentVerifier(blocks, purpose) : null,
		});

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const requestMessageCount = requestData.messages.length;
		const assistantIds = assistantHistoryIds(recentMessages);
		const storedAssistantTurns = assistantIds.length > 0
			? await prisma.noteAIMessage.findMany({
				where: { id: { in: assistantIds }, role: "assistant", noteId: note.id, note: { userId } },
				select: { id: true, content: true, metadata: true },
			})
			: [];
		const trustedMessages = trustedAssistantHistory(recentMessages, storedAssistantTurns);
		const messages = await validateUIMessages<SureWordUIMessage>({
			messages: trustedMessages.map((message: UIMessage) => ({
				...message, parts: Array.isArray(message?.parts) ? message.parts.filter(part => !part.type?.startsWith("data-")) : message?.parts,
			})),
			tools,
		});

		const lastMessage = messages.at(-1);
		if (!lastMessage || lastMessage.role !== "user" || !extractText(lastMessage)) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: the last message must be a non-empty user message."),
				{ status: 400 }
			);
		}
		currentUserText = extractText(lastMessage);
		currentMessageId = lastMessage.id;
		if (operation) {
			await claimNoteAIOperation(operation, noteAIRequestHash(requestData));
			claimedOperation = operation;
		}

		if (process.env.SUREWORD_USAGE_ENABLED === "true" && await aiAccessFor(userId) === "house") {
			await reserveIncludedRequest(userId);
		}

		// Persist the user turn before tools run. The original server receipt
		// timestamp anchors relative reading dates on retries across midnight.
		const savedUserTurn = await withNoteAIHistory(operation, async db => {
			const existingUserMessage = await db.noteAIMessage.findUnique({ where: { id: lastMessage.id }, select: { noteId: true, role: true, metadata: true } });
			if (existingUserMessage && (existingUserMessage.noteId !== note.id || existingUserMessage.role !== "user")) {
				throw new UserFacingError("Message ID is already in use.");
			}
			return db.noteAIMessage.upsert({
				where: { id: lastMessage.id }, update: {},
				create: { id: lastMessage.id, noteId: note.id, role: "user", content: extractText(lastMessage), createdAt: readingReceivedAt, metadata: { readingTimezone: readingContext.timezone } },
				select: { createdAt: true, metadata: true },
			});
		});
		if (!savedUserTurn.accepted) throw new NoteAIOperationError(409, "This note request was cancelled.");
		const savedUserMessage = savedUserTurn.value;
		const originalReadingMetadata = savedUserMessage.metadata && typeof savedUserMessage.metadata === "object" && !Array.isArray(savedUserMessage.metadata) ? savedUserMessage.metadata : {};
		readingContext.timezone = readingTimezone("readingTimezone" in originalReadingMetadata ? originalReadingMetadata.readingTimezone : readingContext.timezone);
		readingReceivedAt.setTime(savedUserMessage.createdAt.getTime());

		const responseMessageId = generateMessageId();
		const turnStartedAtMs = Date.now();
		const toolReceipts: { tool: string; output: unknown }[] = [];
		const noteWriteIds = new Set<string>();
		const verificationBudget = () => {
			const remaining = 285_000 - (Date.now() - turnStartedAtMs);
			if (remaining < 1000) throw new Error("Note verification budget exhausted");
			return Math.min(75_000, remaining);
		};
		const stream = createUIMessageStream<SureWordUIMessage>({
			originalMessages: messages,
			generateId: () => responseMessageId,
			onError: (error) => {
				if (!(error instanceof UserFacingError || error instanceof AiCredentialError)) {
					console.error("note-ai stream error:", error);
				}
				return streamErrorText(error);
			},
			onEnd: ({ responseMessage, isAborted }) => {
				if (isAborted) return;
				waitUntil(
					persistExchange({
						userId,
						noteId: note.id,
						userMessage: lastMessage,
						responseMessage,
						operation,
					})
				);
			},
			execute: async ({ writer }) => {
				const emitStatus = startStatusNarration(writer, responseMessageId);
				let lastStatus = "Getting ready";
				const writeStatus = (label: string) => { lastStatus = label; emitStatus(label); };
				// Keep native idle timeouts alive while generation or Scripture review waits.
				const statusHeartbeat = setInterval(() => emitStatus(lastStatus), 10_000);
				statusHeartbeat.unref?.();
				try {
					writeStatus("Getting ready");

					const [memories, church, legend, linksSummary] = await Promise.all([
						loadUserMemories(userId),
						loadUserChurch(userId),
						loadHighlightLegend(userId, highlightLabels, highlightMeanings),
						describeNoteLinks(note.id),
					]);
					const fullSystem = `${noteAISystemPrompt(
						note.title,
						note.plainText.slice(0, MAX_NOTE_CONTENT_LENGTH),
						linksSummary
					// The note panel shares the chat tool set, so it must also carry the rule
					// that governs the one tool that overwrites something: setDailyCross may
					// not fire until the user has agreed to it.
					, { userText: currentUserText, surface: "note" })}${formatAboutMeBlock(aboutMe)}${formatTestimonyBlock(testimony)}${formatMemoryBlock(memories)}${formatChurchBlock(church)}${formatHighlightLegendBlock(legend)}${await actionDecisionBlock(actionContext)}\n\n${nextStepGuidance}\n\n${HISTORY_EVIDENCE_GUIDANCE}\n\n${SCRIPTURE_OUTPUT_GUIDANCE}`;

					const { model, providerOptions, definition } = await resolveModel({ userId, fallbackEffort: "medium" });
					const verificationModel = await resolveVerificationModel(userId, definition);
					contentVerifier = async (blocks, purpose) => {
						const checked = await verifyGeneratedAnswer(blocks, {
						model: verificationModel, providerOptions, translation: "KJV", question: currentUserText, purpose,
							context: `Verify text for ${purpose}. Preserve existing note material unless the user requested a change.`,
							timeoutMs: verificationBudget(),
						});
						return checked.verified ? checked.blocks : null;
					};
					const { stableSystem, volatileSystem } = splitStableSystemPrefix(
						fullSystem,
						noteAIStablePrompt,
					);
					const promptCache = buildPromptCachePlan({
						provider: definition.provider,
						modelId: definition.providerModelId,
						stableSystem,
						volatileSystem,
						providerOptions,
						cacheKey: `sureword:note-ai:v1:${definition.providerModelId}:${userPrefs?.webSearchEnabled ?? true}`,
					});

					writeStatus("Thinking");
					let lastStepFinishReason: string | null = null;
					const result = streamText({
						model,
						system: promptCache.system,
						messages: withoutOrphanedOpenAIReferences(await convertToModelMessages(messages)),
						tools,
						prepareStep: ({ stepNumber }) => {
							if (finishAgentWork(stepNumber, turnStartedAtMs)) return { toolChoice: "none" as const, activeTools: [], system: `${fullSystem}\n\nFinish from successful evidence now. State the useful result and any incomplete work; make no further tool calls.` };
							if (mustReadStudy(isStudyWorkRequest(currentUserText), knownStudyIds, readStudyIds)) return { activeTools: ["readStudy"], toolChoice: { type: "tool" as const, toolName: "readStudy" as const } };
							return { activeTools: Object.keys(tools).filter(name => name !== "readStudy" || knownStudyIds.size > 0) as (keyof SureWordTools)[] };
						},
						// Either limit ends the loop cleanly, so the answer is streamed,
						// persisted and measured. Only the platform timeout loses a turn.
						stopWhen: [isStepCount(8), isOverTimeBudget(turnStartedAtMs, TOOL_LOOP_BUDGET_MS)],
						// Same dash stripping as the chat route; the note panel persists
						// what it streams too.
						experimental_transform: plainDashes(),
						providerOptions: promptCache.providerOptions,
						onStepEnd: (event) => {
							lastStepFinishReason = event.finishReason;
							logChatStepMetric(
								{
									surface: "note-ai",
									provider: definition.provider,
									modelId: definition.providerModelId,
									toolCount: Object.keys(tools).length,
									memoryCount: memories.length,
									historyMessages: messages.length,
									historyTruncated: requestMessageCount > MAX_REQUEST_MESSAGES,
									maxHistoryMessages: MAX_REQUEST_MESSAGES,
									stepLimit: 8,
									stableSystemChars: stableSystem.length,
									volatileSystemChars: volatileSystem.length,
								},
								event,
							);
						},
						onToolExecutionStart: ({ toolCall }) => {
							writeStatus(toolActivityLabel(toolCall.toolName));
						},
						onToolExecutionEnd: ({ toolCall, toolOutput }) => {
							if (toolOutput.type === "tool-result") {
								toolReceipts.push({ tool: toolCall.toolName, output: toolOutput.output });
								const noteId = successfulNoteWriteId(toolCall.toolName, toolOutput.output);
								if (noteId) {
									noteWriteIds.delete(noteId);
									noteWriteIds.add(noteId);
								}
							}
							writeStatus("Thinking");
						},
					});

					const consumption = result.consumeStream();

					await releaseVerifiedAnswer({
						stream: toUIMessageStream<SureWordTools, SureWordUIMessage>({
							stream: result.stream, tools, sendStart: false, sendFinish: false, sendReasoning: false,
						}),
						write: chunk => writer.write(chunk),
						onChecking: () => writeStatus("Checking Scripture"),
						verify: async blocks => {
							// Upstream EOF means all tool callbacks have settled. Read final state
							// once per target, after concurrent writes can no longer race a readback.
							const latestNoteWrites = await Promise.all([...noteWriteIds].reverse().map(noteId => readSavedNoteEvidence(noteId, id => prisma.note.findFirst({
								where: { id, userId }, select: { id: true, title: true, plainText: true },
							}))));
							return verifyGeneratedAnswer(blocks, {
								model: verificationModel, providerOptions, translation: "KJV", question: currentUserText,
								context: JSON.stringify({ latestNoteWrites, evidenceRule: "Latest note readbacks prove the final saved state after all successful writes settled. Earlier tool receipts or open-note text can precede those writes. Bible quotation words still require fresh canonical verification.", toolReceipts, openNote: note.plainText.slice(0, MAX_NOTE_CONTENT_LENGTH), noteAuthority: "User material, not Scripture authority" }),
								timeoutMs: verificationBudget(),
							});
						},
					});
					await consumption;
					const notice = incompleteAgentNotice(lastStepFinishReason, Date.now() - turnStartedAtMs);
					if (notice) {
						const textId = `${responseMessageId}-limit`;
						writer.write({ type: "text-start", id: textId });
						writer.write({ type: "text-delta", id: textId, delta: `\n\n${notice}` });
						writer.write({ type: "text-end", id: textId });
					}
				} finally {
					clearInterval(statusHeartbeat);
					// Serializes with every note-writing transaction. Even a provider
					// still draining after a verification error cannot commit later.
					if (operation) await settleNoteAIOperation(operation);
				}
			},
		});

		return createUIMessageStreamResponse({ stream, consumeSseStream: ({ stream: copy }) => {
			waitUntil((async () => {
				const reader = copy.getReader();
				try { while (!(await reader.read()).done) { /* Keep verified persistence alive after disconnect. */ } }
				catch (error) { console.error("Failed to drain note-ai stream:", error); }
				finally { reader.releaseLock(); }
			})());
		} });
	} catch (error) {
		if (claimedOperation) {
			try { await settleNoteAIOperation(claimedOperation); }
			catch { console.error("Note operation settlement failed; recovery must cancel it."); }
		}
		if (error instanceof Response) return error;
		if (error instanceof NoteAIOperationError) return NextResponse.json(chatErrorPayload("invalid_input", error.message), { status: error.status });
		console.error("Error in note-ai route:", error);
		if (error instanceof UserFacingError) {
			return NextResponse.json(chatErrorPayload(error.code, error.message), { status: 400 });
		}
		// Never interpolate the exception message (see ask-question).
		return NextResponse.json(
			chatErrorPayload("internal", "Something went wrong on our end. Please try again."),
			{ status: 500 }
		);
	}
}

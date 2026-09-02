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
import { waitUntil } from "@vercel/functions";
import { ChatAttachmentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_MESSAGE_BYTES,
	isDailyCrossMessageOrigin,
	sanitizeDailyCrossMessageOrigin,
	type DailyCrossMessageOrigin,
} from "@/lib/chat-attachment-types";
import { createAttachmentPreviewUrl } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";
import { notifyChatAnswerReady } from "@/lib/push";
import { buildSureWordTools, type SureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { resolveModel } from "@/lib/ai/provider";
import { UserFacingError, chatErrorPayload, streamErrorText } from "@/lib/ai/errors";
import { askQuestionRateLimiter, rateLimitKey } from "@/lib/rateLimit";
import {
	createNarratedDownload,
	hasPersistableContent,
	persistableParts,
	startStatusNarration,
} from "@/lib/ai/status-narration";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { HOUSE_MODEL_ID, isReasoningEffort } from "@/lib/ai/models";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { loadUserChurch } from "@/lib/church";
import { formatChurchBlock } from "@/lib/church-rules";
import { chatSystemPrompt } from "@/utils/systemPrompt";
import { joinAssistantTextParts, stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import type { TranslationId } from "@/lib/bible/translations";
export const maxDuration = 120;

const MAX_REQUEST_MESSAGES = 24;
const MAX_CONTEXT_ATTACHMENTS = 5;

// The assistant message id MUST be generated server-side: without it the UI
// message stream leaves responseMessage.id as "", and every exchange's
// persist upsert collides on the same empty primary key, overwriting one
// shared row (this bug wiped assistant messages from history on 2026-08-10).
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
 * Assistant text, joined the way both clients join it.
 *
 * The AI SDK splits one assistant turn into several text parts around tool
 * calls, so concatenating them with "" glues the next block onto the end of the
 * previous sentence ("Let me look that up.## Psalm 46:10") - and no normalizer
 * can repair that, because there is no newline left to insert a blank line
 * before. The clients hydrate `metadata.parts` through joinAssistantTextParts;
 * the persisted `content` (the only thing rows written before metadata.parts
 * have, and what push notifications and study context read) must agree with it.
 *
 * Empty parts are dropped: a model can open a turn with a zero-length text part
 * before its first tool call, and joining that would fabricate a leading
 * paragraph break the model never wrote.
 */
function extractAssistantText(message: UIMessage): string {
	const textParts: string[] = [];
	for (const part of message.parts) {
		if (part.type === "text" && part.text.trim()) textParts.push(part.text);
	}
	// Open question, instrumented rather than guessed at: a turn split
	// MID-paragraph would make this join invent a block boundary. Shape only -
	// never the text itself - so the logs can answer it without storing answers.
	//
	// Trailing whitespace is trimmed BEFORE the boundary test and \s is not in
	// the terminator class: "The word shalom means " ends in a space, which is
	// the middle of a sentence, not the end of one. Counting whitespace as a
	// boundary made the instrumentation blind to exactly the split it exists
	// to measure.
	if (textParts.length > 1) {
		const midParagraphSplits = textParts
			.slice(0, -1)
			.filter((part) => !/[.!?:;"')\]]$/.test(part.trimEnd())).length;
		if (midParagraphSplits > 0) {
			console.warn(
				`assistant text parts split mid-paragraph: ${midParagraphSplits} of ${textParts.length - 1} joins`
			);
		}
	}
	return joinAssistantTextParts(textParts).trim();
}

function attachmentIds(message: SureWordUIMessage): string[] {
	const ids = message.metadata?.attachmentIds;
	if (!Array.isArray(ids)) return [];
	return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * Validate the client-provided Daily Cross marker before it can be persisted.
 * The shape check is shared with the web client; the row lookup is the trust
 * boundary and makes both the id and reference belong to this caller.
 */
async function validateDailyCrossOrigin(
	userId: string,
	message: SureWordUIMessage,
): Promise<DailyCrossMessageOrigin | null> {
	const metadata = message.metadata;
	if (!metadata || typeof metadata !== "object") return null;
	const candidate = (metadata as Record<string, unknown>).origin;
	if (candidate === undefined) return null;
	if (!isDailyCrossMessageOrigin(candidate)) {
		throw new UserFacingError("The Daily Cross study link is invalid.");
	}
	const origin = sanitizeDailyCrossMessageOrigin(candidate);
	if (!origin) throw new UserFacingError("The Daily Cross study link is invalid.");

	const row = await prisma.verseOfDay.findFirst({
		where: { id: origin.verseOfDayId, userId },
		select: { book: true, chapter: true, verse: true },
	});
	const expectedReference = row ? `${row.book} ${row.chapter}:${row.verse}` : null;
	if (!row || expectedReference !== origin.reference) {
		throw new UserFacingError("The Daily Cross study link is no longer available.");
	}
	return origin;
}

async function hydrateTrustedAttachments(
	messages: SureWordUIMessage[],
	userId: string,
): Promise<SureWordUIMessage[]> {
	const lastMessage = messages.at(-1);
	if (!lastMessage) return messages;
	if (messages.some((message) => attachmentIds(message).length > MAX_ATTACHMENTS_PER_MESSAGE)) {
		throw new UserFacingError("A message cannot reference more than 5 attachments.");
	}
	const currentIds = attachmentIds(lastMessage);
	if (currentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new UserFacingError("You can attach up to 5 files per message.");
	}

	const requestedIds = [...new Set(messages.flatMap(attachmentIds))];
	const records = requestedIds.length > 0
		? await prisma.chatAttachment.findMany({
				where: { id: { in: requestedIds }, userId, status: ChatAttachmentStatus.READY },
			})
		: [];
	const byId = new Map(records.map((record) => [record.id, record]));
	const currentRecords = currentIds.map((id) => byId.get(id));
	if (
		currentRecords.some((record) => !record) ||
		currentRecords.some((record) => record?.messageId && record.messageId !== lastMessage.id) ||
		currentRecords.reduce((total, record) => total + (record?.size ?? 0), 0) > MAX_ATTACHMENT_MESSAGE_BYTES
	) {
		throw new UserFacingError("One or more attachments are invalid or no longer available.");
	}

	const selectedByMessage = new Map<string, typeof records>();
	let selectedCount = 0;
	let selectedBytes = 0;
	let omitted = false;
	for (const message of [...messages].reverse()) {
		const selected = [] as typeof records;
		for (const id of attachmentIds(message)) {
			const record = byId.get(id);
			if (!record) {
				omitted = true;
				continue;
			}
			const belongsToMessage = message.id === lastMessage.id
				? !record.messageId || record.messageId === message.id
				: record.messageId === message.id;
			if (!belongsToMessage) {
				omitted = true;
				continue;
			}
			if (
				selectedCount >= MAX_CONTEXT_ATTACHMENTS ||
				selectedBytes + record.size > MAX_ATTACHMENT_MESSAGE_BYTES
			) {
				omitted = true;
				continue;
			}
			selected.push(record);
			selectedCount += 1;
			selectedBytes += record.size;
		}
		selectedByMessage.set(message.id, selected);
	}

	const hydrated = await Promise.all(messages.map(async (message) => {
		const trustedFiles = await Promise.all(
			(selectedByMessage.get(message.id) ?? []).map(async (record) => ({
				type: "file" as const,
				mediaType: record.mediaType,
				filename: record.filename,
				url: (await createAttachmentPreviewUrl(record.pathname)).previewUrl,
			})),
		);
		return {
			...message,
			parts: [...trustedFiles, ...message.parts.filter((part) => part.type !== "file")],
		};
	}));

	if (omitted) {
		const targetIndex = hydrated.findIndex((message) => message.role === "user");
		if (targetIndex >= 0) {
			const target = hydrated[targetIndex];
			hydrated[targetIndex] = {
				...target,
				parts: [
					...target.parts,
					{ type: "text", text: "\n\n[Some older attachments were omitted to stay within the context limit.]" },
				],
			};
		}
	}
	return hydrated;
}

/**
 * Drop file parts for a model that cannot read them, leaving a line that names
 * what was attached. Only reached when the user has no attachment-capable
 * provider unlocked at all - an answer that admits it cannot see the file beats
 * a provider 400 that kills the whole turn.
 */
function withoutFileParts(messages: SureWordUIMessage[]): SureWordUIMessage[] {
	return messages.map((message) => {
		const files = message.parts.filter((part) => part.type === "file");
		if (files.length === 0) return message;
		const names = files.map((file) => file.filename ?? file.mediaType).join(", ");
		return {
			...message,
			parts: [
				...message.parts.filter((part) => part.type !== "file"),
				{
					type: "text" as const,
					text:
						`\n\n[The user attached ${names}, but the AI model they selected cannot read files, ` +
						`so its contents are not available to you. Say so plainly and tell them that adding an ` +
						`OpenAI or Anthropic key in Settings → AI Providers lets you read attachments.]`,
				},
			],
		};
	});
}

function stripFollowUps(text: string): {
	cleanText: string;
	followUps: string[];
} {
	const followUps: string[] = [];
	// Anchored to a line start (^ with /m), and [ \t]* rather than \s*, so this
	// agrees exactly with the stripper in assistantMarkdown.ts and with both
	// client copies (src/components/useChat.ts, mobile/src/lib/chatView.ts).
	// Two failures are ruled out by the two halves:
	// - \s* crosses the newline, so a marker alone on its own line swallowed the
	//   NEXT line as the question, extracting it as a chip while the line-scoped
	//   stripper left it in the body - the user saw it twice.
	// - unanchored, "- [FOLLOWUP] What does grace mean?" was extracted as a chip
	//   but NOT stripped, because the stripper only removes a marker at the head
	//   of a line. Extraction and removal must agree: both, or neither, never one.
	const followUpRegex = /^[ \t]*\[FOLLOWUP\][ \t]*([^\r\n]+)/gm;
	let match: RegExpExecArray | null;
	while ((match = followUpRegex.exec(text)) !== null && followUps.length < 2) {
		const question = match[1].trim();
		if (question && !followUps.includes(question)) followUps.push(question);
	}
	return {
		// Same per-line semantics the clients apply before rendering, so the
		// persisted content matches what the user saw while streaming.
		cleanText: stripFollowUpMarkers(text, { streaming: false }),
		followUps,
	};
}

async function persistUserMessage(options: {
	userId: string;
	conversationId: string;
	userMessage: SureWordUIMessage;
	origin: DailyCrossMessageOrigin | null;
}): Promise<void> {
	const userText = extractText(options.userMessage);
	const ids = attachmentIds(options.userMessage);
	await prisma.$transaction(async (tx) => {
		const conversation = await tx.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true },
		});
		if (!conversation) throw new UserFacingError("Conversation not found.", "conversation_not_found");

		const existing = await tx.message.findUnique({
			where: { id: options.userMessage.id },
			select: { role: true, conversationId: true },
		});
		if (existing && (existing.role !== "user" || existing.conversationId !== conversation.id)) {
			throw new UserFacingError("Message ID is already in use.");
		}

		const metadata =
			options.userMessage.metadata && typeof options.userMessage.metadata === "object"
				? { ...(options.userMessage.metadata as Record<string, unknown>) }
				: {};
		// attachmentIds are rebuilt from the validated attachment records below;
		// origin is rebuilt from the ownership/reference check above. Every other
		// metadata key is carried through unchanged for backward compatibility.
		delete metadata.attachmentIds;
		delete metadata.origin;
		if (ids.length > 0) metadata.attachmentIds = ids;
		if (options.origin) metadata.origin = options.origin;
		const metadataJson = JSON.parse(JSON.stringify(metadata));

		await tx.message.upsert({
			where: { id: options.userMessage.id },
			update: { content: userText, metadata: metadataJson },
			create: {
				id: options.userMessage.id,
				conversationId: conversation.id,
				role: "user",
				content: userText,
				metadata: metadataJson,
			},
		});

		for (const id of ids) {
			const linked = await tx.chatAttachment.updateMany({
				where: {
					id,
					userId: options.userId,
					status: ChatAttachmentStatus.READY,
					OR: [{ messageId: null }, { messageId: options.userMessage.id }],
				},
				data: { messageId: options.userMessage.id },
			});
			if (linked.count !== 1) {
				throw new UserFacingError("An attachment could not be linked to the message.");
			}
		}
	});
}

async function persistAssistantResponse(options: {
	userId: string;
	conversationId: string;
	userMessage: SureWordUIMessage;
	responseMessage: UIMessage;
	/** Resolved provider/model id, or null when resolution never happened. */
	modelId: string | null;
}): Promise<void> {
	if (!hasPersistableContent(options.responseMessage)) return;
	try {
		const conversation = await prisma.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true },
		});
		if (!conversation) return;

		const userText = extractText(options.userMessage);
		const assistantText = extractAssistantText(options.responseMessage);
		const { cleanText, followUps } = stripFollowUps(assistantText);

		const metadata: Record<string, unknown> = {
			parts: persistableParts(options.responseMessage.parts),
		};
		if (followUps.length > 0) metadata.followUps = followUps;
		// Which model actually wrote this turn. User.defaultModelId only says
		// what the picker is set to NOW, so without this a formatting report
		// cannot be attributed to a provider. Metadata-only on purpose: no
		// schema change needed, and both clients already carry unknown metadata
		// keys through hydration untouched (SureWordMessageMetadata is indexed).
		if (options.modelId) metadata.modelId = options.modelId;
		const metadataJson = JSON.parse(JSON.stringify(metadata));

		// Belt-and-braces: never upsert with an empty id (see generateMessageId).
		const responseMessageId = options.responseMessage.id.trim()
			? options.responseMessage.id
			: generateMessageId();

		await prisma.message.upsert({
			where: { id: responseMessageId },
			update: { content: cleanText, metadata: metadataJson },
			create: {
				id: responseMessageId,
				conversationId: conversation.id,
				role: "assistant",
				content: cleanText,
				metadata: metadataJson,
			},
		});

		if (userText) {
			await extractAndStoreMemories({ userId: options.userId, userText });
		}
	} catch (error) {
		console.error("Failed to persist assistant response:", error);
	}
}

export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const rate = askQuestionRateLimiter.check(rateLimitKey(req, userId));
		if (!rate.allowed) {
			return NextResponse.json(
				chatErrorPayload(
					"rate_limited",
					"Slow down — you're asking questions faster than we can keep up. Try again in a moment."
				),
				{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
			);
		}

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};

		if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: 'messages' must be a non-empty array."),
				{ status: 400 }
			);
		}

		const conversationId =
			typeof requestData.conversationId === "string" && requestData.conversationId
				? requestData.conversationId
				: null;

		// The client sends the Bible translation chosen in settings; the system
		// prompt and Scripture tools quote that translation instead of the KJV.
		const translation: TranslationId =
			requestData.translation === "NKJV" ? "NKJV" : "KJV";

		const userPrefs = await prisma.user.findUnique({
			where: { id: userId },
			select: { webSearchEnabled: true },
		});
		const tools = buildSureWordTools({
			userId,
			translation,
			webSearchEnabled: userPrefs?.webSearchEnabled ?? true,
		});

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const allMessages = await validateUIMessages<SureWordUIMessage>({
			messages: recentMessages,
			tools,
		});

		// Answer the last thing the USER said. A retry can leave a half-finished
		// assistant turn on the end of the array (the AI SDK's regenerate slices
		// at the message it is replacing), and rejecting that outright is what
		// turned one failed answer into an unretryable conversation.
		const lastUserIndex = allMessages.findLastIndex((message) => message.role === "user");
		const lastMessage = lastUserIndex >= 0 ? allMessages[lastUserIndex] : undefined;
		if (
			!lastMessage ||
			(!extractText(lastMessage) && attachmentIds(lastMessage).length === 0)
		) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: the last message needs text or an attachment."),
				{ status: 400 }
			);
		}
		const validatedMessages = allMessages.slice(0, lastUserIndex + 1);
		// Reject malformed or cross-user Daily Cross markers before opening the
		// response stream. Organic messages have no origin and keep their existing
		// path unchanged.
		const dailyCrossOrigin = await validateDailyCrossOrigin(userId, lastMessage);
		const hasAttachments = attachmentIds(lastMessage).length > 0;
		// Older turns' files are re-hydrated into this request too, so the model
		// has to be able to read attachments for the whole thread, not just the
		// message that carried them.
		const threadHasAttachments = validatedMessages.some(
			(message) => attachmentIds(message).length > 0,
		);
		if (hasAttachments && !conversationId) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Create a conversation before sending an attachment."),
				{ status: 400 },
			);
		}

		// Optional per-request picker values; anything invalid is ignored and
		// the user's stored default (then the app default) applies instead.
		const requestedModelId =
			typeof requestData.modelId === "string" ? requestData.modelId : null;
		const requestedEffort = isReasoningEffort(requestData.effort) ? requestData.effort : null;
		const isOpeningQuestion =
			validatedMessages.filter((message) => message.role === "user").length === 1;

		// Set inside execute() once resolveModel has picked a head, read in
		// onEnd (which runs after execute finishes) so the persisted turn
		// records the model that actually wrote it.
		let resolvedModelId: string | null = null;

		const responseMessageId = generateMessageId();
		const stream = createUIMessageStream<SureWordUIMessage>({
			originalMessages: validatedMessages,
			generateId: () => responseMessageId,
			onError: (error) => {
				if (!(error instanceof UserFacingError)) {
					console.error("ask-question stream error:", error);
				}
				return streamErrorText(error);
			},
			onEnd: ({ responseMessage, isAborted }) => {
				if (isAborted || !conversationId) return;
				// `req.signal` aborts when the client's connection drops - the app
				// being backgrounded, the screen locking, the network changing.
				// The answer still finished here (see consumeSseStream below), so
				// the user needs telling that it is waiting for them.
				const clientLeft = req.signal.aborted;
				waitUntil(
					persistAssistantResponse({
						userId,
						conversationId,
						userMessage: lastMessage,
						responseMessage,
						modelId: resolvedModelId,
					}).then(() => {
						if (!clientLeft) return;
						return notifyChatAnswerReady({
							userId,
							conversationId,
							answerText: stripFollowUps(extractAssistantText(responseMessage)).cleanText,
						});
					})
				);
			},
			execute: async ({ writer }) => {
				const writeStatus = startStatusNarration(writer, responseMessageId);
				writeStatus("Getting ready");

				if (hasAttachments) writeStatus("Opening your attachments");
				const messages = await hydrateTrustedAttachments(validatedMessages, userId);

				if (conversationId) {
					await persistUserMessage({
						userId,
						conversationId,
						userMessage: lastMessage,
						origin: dailyCrossOrigin,
					});
				}

				const [memories, church] = await Promise.all([
					loadUserMemories(userId),
					loadUserChurch(userId),
				]);
				const {
					model,
					providerOptions,
					definition,
					access,
					attachmentFallbackFrom,
					attachmentsUnsupported,
				} = await resolveModel({
					userId,
					modelId: requestedModelId,
					effort: requestedEffort,
					fallbackEffort: isOpeningQuestion ? "high" : "medium",
					attachments: true,
					requireAttachments: threadHasAttachments,
				});
				resolvedModelId = definition.id;
				if (attachmentFallbackFrom) {
					writeStatus(`${attachmentFallbackFrom.label} can't read files - using ${definition.label}`);
				}
				const modelMessages = attachmentsUnsupported ? withoutFileParts(messages) : messages;

				// The picker's last choice becomes the default for every client. An
				// invalid requested id resolves to a fallback model — don't record that
				// fallback as if the user picked it.
				// A house answer is the server's choice, not the user's: those accounts
				// have no picker, so recording Luna as their stored default would
				// invent a preference and outlive the day they add their own key.
				const houseAnswer = access === "house" && definition.id === HOUSE_MODEL_ID;
				const pickedModel =
					!houseAnswer && requestedModelId === definition.id ? definition.id : null;
				const pickedEffort = houseAnswer ? null : requestedEffort;
				if (pickedModel || pickedEffort) {
					waitUntil(
						prisma.user
							.update({
								where: { id: userId },
								data: {
									...(pickedModel ? { defaultModelId: pickedModel } : {}),
									...(pickedEffort ? { defaultEffort: pickedEffort } : {}),
								},
							})
							.catch((error) => console.error("Failed to persist model choice:", error)),
					);
				}

				writeStatus("Thinking");
				const result = streamText({
					model,
					system: `${chatSystemPrompt(translation)}${formatMemoryBlock(memories)}${formatChurchBlock(church)}`,
					messages: await convertToModelMessages(modelMessages),
					tools,
					stopWhen: isStepCount(8),
					providerOptions,
					experimental_download: createNarratedDownload({ writeStatus, messages: modelMessages }),
					onToolExecutionStart: ({ toolCall }) => {
						writeStatus(toolActivityLabel(toolCall.toolName));
					},
					onToolExecutionEnd: () => {
						writeStatus("Thinking");
					},
				});

				// Run to completion even if the client disconnects, so persistence and
				// memory extraction still happen.
				result.consumeStream();

				writer.merge(
					toUIMessageStream<SureWordTools, SureWordUIMessage>({
						stream: result.stream,
						tools,
						sendStart: false,
					})
				);
			},
		});

		return createUIMessageStreamResponse({
			stream,
			// Tee the SSE stream and drain the copy server-side. Without this a
			// client disconnect cancels the response stream, which cancels the
			// pipeline and fires `onEnd` with whatever partial answer had been
			// written - backgrounding the Android app mid-answer persisted a
			// truncated reply and surfaced as a failed message. With a second
			// reader holding the stream open, generation runs to completion and
			// `onEnd` gets the whole message no matter when the client leaves.
			consumeSseStream: ({ stream: copy }) => {
				waitUntil(
					(async () => {
						const reader = copy.getReader();
						try {
							while (!(await reader.read()).done) {
								// Drain only; the persisted copy comes from onEnd.
							}
						} catch (error) {
							console.error("Failed to drain the server-side stream copy:", error);
						} finally {
							reader.releaseLock();
						}
					})()
				);
			},
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in ask-question route:", error);
		if (error instanceof UserFacingError) {
			return NextResponse.json(chatErrorPayload(error.code, error.message), { status: 400 });
		}
		// Never interpolate the exception message - it can carry provider or
		// database internals. The real error is in the server log above.
		return NextResponse.json(
			chatErrorPayload("internal", "Something went wrong on our end. Please try again."),
			{ status: 500 }
		);
	}
}

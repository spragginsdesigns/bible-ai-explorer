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
} from "@/lib/chat-attachment-types";
import { createAttachmentPreviewUrl } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";
import { buildSureWordTools, type SureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { UserFacingError } from "@/lib/ai/errors";
import {
	createNarratedDownload,
	createStatusWriter,
	hasPersistableContent,
	persistableParts,
} from "@/lib/ai/status-narration";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { isReasoningEffort } from "@/lib/ai/models";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { chatSystemPrompt } from "@/utils/systemPrompt";
import { stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import type { TranslationId } from "@/lib/bible/translations";
export const maxDuration = 120;

const MAX_REQUEST_MESSAGES = 24;
const MAX_CONTEXT_ATTACHMENTS = 5;

// The assistant message id MUST be generated server-side: without it the UI
// message stream leaves responseMessage.id as "", and every exchange's
// persist upsert collides on the same empty primary key, overwriting one
// shared row (this bug wiped assistant messages from history on 2026-08-10).
const generateMessageId = createIdGenerator({ prefix: "msg", size: 24 });

function extractText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

function attachmentIds(message: SureWordUIMessage): string[] {
	const ids = message.metadata?.attachmentIds;
	if (!Array.isArray(ids)) return [];
	return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
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

function stripFollowUps(text: string): {
	cleanText: string;
	followUps: string[];
} {
	const followUps: string[] = [];
	const followUpRegex = /\[FOLLOWUP\]\s*([^\r\n]+)/g;
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
}): Promise<void> {
	const userText = extractText(options.userMessage);
	const ids = attachmentIds(options.userMessage);
	await prisma.$transaction(async (tx) => {
		const conversation = await tx.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true },
		});
		if (!conversation) throw new UserFacingError("Conversation not found.");

		const existing = await tx.message.findUnique({
			where: { id: options.userMessage.id },
			select: { role: true, conversationId: true },
		});
		if (existing && (existing.role !== "user" || existing.conversationId !== conversation.id)) {
			throw new UserFacingError("Message ID is already in use.");
		}

		await tx.message.upsert({
			where: { id: options.userMessage.id },
			update: { content: userText, metadata: ids.length > 0 ? { attachmentIds: ids } : {} },
			create: {
				id: options.userMessage.id,
				conversationId: conversation.id,
				role: "user",
				content: userText,
				metadata: ids.length > 0 ? { attachmentIds: ids } : {},
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
}): Promise<void> {
	if (!hasPersistableContent(options.responseMessage)) return;
	try {
		const conversation = await prisma.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true },
		});
		if (!conversation) return;

		const userText = extractText(options.userMessage);
		const assistantText = extractText(options.responseMessage);
		const { cleanText, followUps } = stripFollowUps(assistantText);

		const metadata: Record<string, unknown> = {
			parts: persistableParts(options.responseMessage.parts),
		};
		if (followUps.length > 0) metadata.followUps = followUps;
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

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};

		if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
			return NextResponse.json(
				{ error: "Invalid input: 'messages' must be a non-empty array." },
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
		const validatedMessages = await validateUIMessages<SureWordUIMessage>({
			messages: recentMessages,
			tools,
		});

		const lastMessage = validatedMessages.at(-1);
		if (
			!lastMessage ||
			lastMessage.role !== "user" ||
			(!extractText(lastMessage) && attachmentIds(lastMessage).length === 0)
		) {
			return NextResponse.json(
				{ error: "Invalid input: the last message needs text or an attachment." },
				{ status: 400 }
			);
		}
		const hasAttachments = attachmentIds(lastMessage).length > 0;
		if (hasAttachments && !conversationId) {
			return NextResponse.json(
				{ error: "Create a conversation before sending an attachment." },
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

		const stream = createUIMessageStream<SureWordUIMessage>({
			originalMessages: validatedMessages,
			generateId: generateMessageId,
			onError: (error) => {
				if (error instanceof UserFacingError || error instanceof AiCredentialError) {
					return error.message;
				}
				console.error("ask-question stream error:", error);
				return "An error occurred.";
			},
			onEnd: ({ responseMessage, isAborted }) => {
				if (isAborted || !conversationId) return;
				waitUntil(
					persistAssistantResponse({
						userId,
						conversationId,
						userMessage: lastMessage,
						responseMessage,
					})
				);
			},
			execute: async ({ writer }) => {
				const writeStatus = createStatusWriter(writer);
				writeStatus("Getting ready");

				if (hasAttachments) writeStatus("Opening your attachments");
				const messages = await hydrateTrustedAttachments(validatedMessages, userId);

				if (conversationId) {
					await persistUserMessage({ userId, conversationId, userMessage: lastMessage });
				}

				const memories = await loadUserMemories(userId);
				const { model, providerOptions, definition } = await resolveModel({
					userId,
					modelId: requestedModelId,
					effort: requestedEffort,
					fallbackEffort: isOpeningQuestion ? "high" : "medium",
					attachments: true,
				});

				// The picker's last choice becomes the default for every client. An
				// invalid requested id resolves to a fallback model — don't record that
				// fallback as if the user picked it.
				const pickedModel = requestedModelId === definition.id ? definition.id : null;
				if (pickedModel || requestedEffort) {
					waitUntil(
						prisma.user
							.update({
								where: { id: userId },
								data: {
									...(pickedModel ? { defaultModelId: pickedModel } : {}),
									...(requestedEffort ? { defaultEffort: requestedEffort } : {}),
								},
							})
							.catch((error) => console.error("Failed to persist model choice:", error)),
					);
				}

				writeStatus("Thinking");
				const result = streamText({
					model,
					system: `${chatSystemPrompt(translation)}${formatMemoryBlock(memories)}`,
					messages: await convertToModelMessages(messages),
					tools,
					stopWhen: isStepCount(8),
					providerOptions,
					experimental_download: createNarratedDownload({ writeStatus, messages }),
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
					})
				);
			},
		});

		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in ask-question route:", error);
		if (error instanceof Error) {
			return NextResponse.json(
				{ error: `An error occurred: ${error.message}` },
				{ status: 500 }
			);
		}
		return NextResponse.json(
			{ error: "An unknown error occurred while processing your request." },
			{ status: 500 }
		);
	}
}

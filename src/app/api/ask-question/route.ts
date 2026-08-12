import {
	convertToModelMessages,
	createIdGenerator,
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
import { buildSureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { isReasoningEffort } from "@/lib/ai/models";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { chatSystemPrompt } from "@/utils/systemPrompt";
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
		throw new Response(JSON.stringify({ error: "A message cannot reference more than 5 attachments." }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}
	const currentIds = attachmentIds(lastMessage);
	if (currentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new Response(JSON.stringify({ error: "You can attach up to 5 files per message." }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
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
		throw new Response(JSON.stringify({ error: "One or more attachments are invalid or no longer available." }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
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
		cleanText: text.replace(/\r?\n?\[FOLLOWUP\][^\r\n]*/g, "").trimEnd(),
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
		if (!conversation) throw new Error("Conversation not found.");

		const existing = await tx.message.findUnique({
			where: { id: options.userMessage.id },
			select: { role: true, conversationId: true },
		});
		if (existing && (existing.role !== "user" || existing.conversationId !== conversation.id)) {
			throw new Error("Message ID is already in use.");
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
			if (linked.count !== 1) throw new Error("An attachment could not be linked to the message.");
		}
	});
}

async function persistAssistantResponse(options: {
	userId: string;
	conversationId: string;
	userMessage: SureWordUIMessage;
	responseMessage: UIMessage;
}): Promise<void> {
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
			parts: options.responseMessage.parts,
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

		const tools = buildSureWordTools({ userId, translation });

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const validatedMessages = await validateUIMessages<SureWordUIMessage>({
			messages: recentMessages,
			tools,
		});
		const messages = await hydrateTrustedAttachments(validatedMessages, userId);

		const lastMessage = messages.at(-1);
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
		if (attachmentIds(lastMessage).length > 0 && !conversationId) {
			return NextResponse.json(
				{ error: "Create a conversation before sending an attachment." },
				{ status: 400 },
			);
		}
		if (conversationId) {
			try {
				await persistUserMessage({ userId, conversationId, userMessage: lastMessage });
			} catch (error) {
				return NextResponse.json(
					{ error: error instanceof Error ? error.message : "Could not save the message." },
					{ status: 400 },
				);
			}
		}

		const memories = await loadUserMemories(userId);
		const isOpeningQuestion =
			messages.filter((message) => message.role === "user").length === 1;

		// Optional per-request picker values; anything invalid is ignored and
		// the user's stored default (then the app default) applies instead.
		const requestedModelId =
			typeof requestData.modelId === "string" ? requestData.modelId : null;
		const requestedEffort = isReasoningEffort(requestData.effort) ? requestData.effort : null;

		let resolved;
		try {
			resolved = await resolveModel({
				userId,
				modelId: requestedModelId,
				effort: requestedEffort,
				fallbackEffort: isOpeningQuestion ? "high" : "medium",
				attachments: true,
			});
		} catch (error) {
			if (error instanceof AiCredentialError) {
				return NextResponse.json({ error: error.message }, { status: 403 });
			}
			throw error;
		}
		const { model, providerOptions, definition } = resolved;

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

		const result = streamText({
			model,
			system: `${chatSystemPrompt(translation)}${formatMemoryBlock(memories)}`,
			messages: await convertToModelMessages(messages),
			tools,
			stopWhen: isStepCount(8),
			providerOptions,
		});

		// Run to completion even if the client disconnects, so persistence and
		// memory extraction still happen.
		result.consumeStream();

		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				tools,
				originalMessages: messages,
				generateMessageId,
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
			}),
		});
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

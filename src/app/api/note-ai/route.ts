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
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSureWordTools, type SureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { AiCredentialError, resolveModel } from "@/lib/ai/provider";
import { UserFacingError, chatErrorPayload, streamErrorText } from "@/lib/ai/errors";
import {
	hasPersistableContent,
	persistableParts,
	startStatusNarration,
} from "@/lib/ai/status-narration";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { joinAssistantTextParts } from "@/utils/assistantMarkdown";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { loadUserChurch } from "@/lib/church";
import { formatChurchBlock } from "@/lib/church-rules";
import {
	dailyCrossGuidance,
	noteAISystemPrompt,
	slashCommandGuidance,
	toolGuidance,
} from "@/utils/systemPrompt";

export const maxDuration = 120;

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
}): Promise<void> {
	if (!hasPersistableContent(options.responseMessage)) return;
	try {
		const note = await prisma.note.findFirst({
			where: { id: options.noteId, userId: options.userId },
			select: { id: true },
		});
		if (!note) return;

		const userText = extractText(options.userMessage);
		const assistantText = extractAssistantText(options.responseMessage);

		if (userText) {
			await prisma.noteAIMessage.upsert({
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

		await prisma.noteAIMessage.upsert({
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

		if (userText) {
			await extractAndStoreMemories({ userId: options.userId, userText });
		}
	} catch (error) {
		console.error("Failed to persist note AI exchange:", error);
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

		const userPrefs = await prisma.user.findUnique({
			where: { id: userId },
			select: { webSearchEnabled: true },
		});
		const tools = buildSureWordTools({
			userId,
			defaultNoteId: note.id,
			webSearchEnabled: userPrefs?.webSearchEnabled ?? true,
		});

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const messages = await validateUIMessages<SureWordUIMessage>({
			messages: recentMessages,
			tools,
		});

		const lastMessage = messages.at(-1);
		if (!lastMessage || lastMessage.role !== "user" || !extractText(lastMessage)) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: the last message must be a non-empty user message."),
				{ status: 400 }
			);
		}

		const responseMessageId = generateMessageId();
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
					})
				);
			},
			execute: async ({ writer }) => {
				const writeStatus = startStatusNarration(writer, responseMessageId);
				writeStatus("Getting ready");

				const [memories, church] = await Promise.all([
					loadUserMemories(userId),
					loadUserChurch(userId),
				]);
				const system = `${noteAISystemPrompt(
					note.title,
					note.plainText.slice(0, MAX_NOTE_CONTENT_LENGTH)
				// The note panel shares the chat tool set, so it must also carry the rule
				// that governs the one tool that overwrites something: setDailyCross may
				// not fire until the user has agreed to it.
				)}\n\n${toolGuidance}\n\n${dailyCrossGuidance}\n\n${slashCommandGuidance}${formatMemoryBlock(memories)}${formatChurchBlock(church)}`;

				const { model, providerOptions } = await resolveModel({ userId, fallbackEffort: "medium" });

				writeStatus("Thinking");
				const result = streamText({
					model,
					system,
					messages: await convertToModelMessages(messages),
					tools,
					stopWhen: isStepCount(8),
					providerOptions,
					onToolExecutionStart: ({ toolCall }) => {
						writeStatus(toolActivityLabel(toolCall.toolName));
					},
					onToolExecutionEnd: () => {
						writeStatus("Thinking");
					},
				});

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

		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		if (error instanceof Response) return error;
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

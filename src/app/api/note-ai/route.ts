import { openai } from "@ai-sdk/openai";
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
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { noteAISystemPrompt, slashCommandGuidance, toolGuidance } from "@/utils/systemPrompt";

export const maxDuration = 120;

const MAX_REQUEST_MESSAGES = 16;
const MAX_NOTE_CONTENT_LENGTH = 16000;

// Same empty-id guard as ask-question: without a server-generated id the
// response message id is "" and every persist upsert collides on one row.
const generateMessageId = createIdGenerator({ prefix: "msg", size: 24 });

function extractText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

async function persistExchange(options: {
	userId: string;
	noteId: string;
	userMessage: UIMessage;
	responseMessage: UIMessage;
}): Promise<void> {
	try {
		const note = await prisma.note.findFirst({
			where: { id: options.noteId, userId: options.userId },
			select: { id: true },
		});
		if (!note) return;

		const userText = extractText(options.userMessage);
		const assistantText = extractText(options.responseMessage);

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
			JSON.stringify({ parts: options.responseMessage.parts })
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
				{ error: "Invalid input: 'noteId' is required." },
				{ status: 400 }
			);
		}
		if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
			return NextResponse.json(
				{ error: "Invalid input: 'messages' must be a non-empty array." },
				{ status: 400 }
			);
		}

		const note = await prisma.note.findFirst({
			where: { id: requestData.noteId, userId },
			select: { id: true, title: true, plainText: true },
		});
		if (!note) {
			return NextResponse.json({ error: "Note not found." }, { status: 404 });
		}

		const tools = buildSureWordTools({ userId, defaultNoteId: note.id });

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const messages = await validateUIMessages<SureWordUIMessage>({
			messages: recentMessages,
			tools,
		});

		const lastMessage = messages.at(-1);
		if (!lastMessage || lastMessage.role !== "user" || !extractText(lastMessage)) {
			return NextResponse.json(
				{ error: "Invalid input: the last message must be a non-empty user message." },
				{ status: 400 }
			);
		}

		const memories = await loadUserMemories(userId);
		const system = `${noteAISystemPrompt(
			note.title,
			note.plainText.slice(0, MAX_NOTE_CONTENT_LENGTH)
		)}\n\n${toolGuidance}\n\n${slashCommandGuidance}${formatMemoryBlock(memories)}`;

		const result = streamText({
			model: openai("gpt-5.6-terra"),
			system,
			messages: await convertToModelMessages(messages),
			tools,
			stopWhen: isStepCount(8),
			providerOptions: {
				openai: { reasoningEffort: "medium" },
			},
		});

		result.consumeStream();

		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				tools,
				originalMessages: messages,
				generateMessageId,
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
			}),
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("Error in note-ai route:", error);
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

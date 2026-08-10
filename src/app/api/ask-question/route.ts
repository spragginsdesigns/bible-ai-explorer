import { openai } from "@ai-sdk/openai";
import {
	convertToModelMessages,
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
import { buildVerseMindTools, type VerseMindUIMessage } from "@/lib/ai-tools";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { slashCommandGuidance, systemPrompt, toolGuidance } from "@/utils/systemPrompt";

export const maxDuration = 120;

const MAX_REQUEST_MESSAGES = 24;

function extractText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
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

async function persistExchange(options: {
	userId: string;
	conversationId: string;
	userMessage: UIMessage;
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

		if (userText) {
			await prisma.message.upsert({
				where: { id: options.userMessage.id },
				update: {},
				create: {
					id: options.userMessage.id,
					conversationId: conversation.id,
					role: "user",
					content: userText,
				},
			});
		}

		const metadata: Record<string, unknown> = {
			parts: options.responseMessage.parts,
		};
		if (followUps.length > 0) metadata.followUps = followUps;
		const metadataJson = JSON.parse(JSON.stringify(metadata));

		await prisma.message.upsert({
			where: { id: options.responseMessage.id },
			update: { content: cleanText, metadata: metadataJson },
			create: {
				id: options.responseMessage.id,
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
		console.error("Failed to persist chat exchange:", error);
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

		const tools = buildVerseMindTools({ userId });

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const messages = await validateUIMessages<VerseMindUIMessage>({
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
		const isOpeningQuestion =
			messages.filter((message) => message.role === "user").length === 1;

		const result = streamText({
			model: openai("gpt-5.6-terra"),
			system: `${systemPrompt}\n\n${toolGuidance}\n\n${slashCommandGuidance}${formatMemoryBlock(memories)}`,
			messages: await convertToModelMessages(messages),
			tools,
			stopWhen: isStepCount(8),
			providerOptions: {
				openai: { reasoningEffort: isOpeningQuestion ? "high" : "medium" },
			},
		});

		// Run to completion even if the client disconnects, so persistence and
		// memory extraction still happen.
		result.consumeStream();

		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				tools,
				originalMessages: messages,
				onEnd: ({ responseMessage, isAborted }) => {
					if (isAborted || !conversationId) return;
					waitUntil(
						persistExchange({
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

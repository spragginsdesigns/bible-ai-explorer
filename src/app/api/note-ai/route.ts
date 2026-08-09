import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { noteAISystemPrompt } from "../../../utils/systemPrompt";
import { getAuthUser } from "@/lib/auth";
import {
	ChatHistoryValidationError,
	MAX_CHAT_MESSAGE_CHARACTERS,
	parseConversationHistory,
} from "@/utils/chatContext";
import { getKjvBookName, getKjvVerseText } from "@/utils/kjvBible";

const model = new ChatOpenAI({
	openAIApiKey: process.env.OPENAI_API_KEY,
	modelName: "gpt-4o",
	temperature: 0,
	maxTokens: 2000,
	timeout: 60000,
	streaming: true,
});

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: process.env.OPENAI_API_KEY,
	modelName: "text-embedding-3-large",
	timeout: 30000,
});

const HUMAN_PROMPT_SUFFIX = `
- Support every substantive biblical claim with exact KJV wording from the passages supplied above when a relevant passage is available
- Quote Scripture only by copying word-for-word from <retrieved_kjv_passages>, and format full-verse quotations as blockquotes with the reference
- You may cite other KJV passages by reference, but do not invent or quote wording that was not supplied
- End with a thought-provoking question for deeper study`;

async function retryWithExponentialBackoff<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	baseDelay: number = 1000
): Promise<T> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt === maxRetries) throw error;
			const delay = baseDelay * Math.pow(2, attempt - 1);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	throw new Error("This should never be reached");
}

const MAX_HISTORY_MESSAGES = 10;
const MAX_NOTE_CONTENT_LENGTH = 16000;
const MAX_NOTE_TITLE_LENGTH = 200;

export async function POST(req: Request): Promise<Response> {
	try {
		await getAuthUser();

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};
		const rawQuestion = requestData.question;

		if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
			return NextResponse.json(
				{ error: "Invalid input: 'question' must be a non-empty string." },
				{ status: 400 }
			);
		}

		const question = rawQuestion.trim();
		if (question.length > MAX_CHAT_MESSAGE_CHARACTERS) {
			return NextResponse.json(
				{ error: `Invalid input: 'question' is limited to ${MAX_CHAT_MESSAGE_CHARACTERS} characters.` },
				{ status: 400 }
			);
		}
		if (
			requestData.noteContent !== undefined &&
			typeof requestData.noteContent !== "string"
		) {
			return NextResponse.json(
				{ error: "Invalid input: 'noteContent' must be a string." },
				{ status: 400 }
			);
		}
		if (requestData.noteTitle !== undefined && typeof requestData.noteTitle !== "string") {
			return NextResponse.json(
				{ error: "Invalid input: 'noteTitle' must be a string." },
				{ status: 400 }
			);
		}

		const noteContent =
			typeof requestData.noteContent === "string" ? requestData.noteContent : "";
		const noteTitle =
			typeof requestData.noteTitle === "string" && requestData.noteTitle.trim()
				? requestData.noteTitle.trim().slice(0, MAX_NOTE_TITLE_LENGTH)
				: "Untitled Note";
		const trimmedHistory = parseConversationHistory(
			requestData.history,
			question
		).slice(-MAX_HISTORY_MESSAGES);

		// Truncate note content if too long
		const truncatedContent = noteContent.slice(0, MAX_NOTE_CONTENT_LENGTH);

		// Perform similarity search
		const searchResult = await retryWithExponentialBackoff(() =>
			performSimilaritySearch(question)
		);

		// Build messages with note context
		const langchainMessages = [
			new SystemMessage(noteAISystemPrompt(noteTitle, truncatedContent)),
		];

		// Add conversation history
		for (const msg of trimmedHistory) {
			if (msg.role === "user") {
				langchainMessages.push(new HumanMessage(msg.content));
			} else if (msg.role === "assistant") {
				langchainMessages.push(new AIMessage(msg.content));
			}
		}

		langchainMessages.push(new HumanMessage(
			`<retrieved_kjv_passages>\n${searchResult.formatted}\n</retrieved_kjv_passages>\n\nAnswer the following question about my Bible study note.\n${HUMAN_PROMPT_SUFFIX}\n\nQuestion: ${question}`
		));

		const stream = await model.stream(langchainMessages);

		const encoder = new TextEncoder();
		const sourcesPayload = JSON.stringify({
			verses: searchResult.verses,
			averageSimilarity: searchResult.averageSimilarity,
		});
		const sourcesMarker = `<!--SOURCES:${sourcesPayload}-->`;

		const readableStream = new ReadableStream({
			async start(controller) {
				try {
					controller.enqueue(encoder.encode(sourcesMarker));
					for await (const chunk of stream) {
						const text = typeof chunk.content === "string" ? chunk.content : "";
						if (text) {
							controller.enqueue(encoder.encode(text));
						}
					}
					controller.close();
				} catch (error) {
					console.error("Streaming error:", error);
					controller.error(error);
				}
			},
		});

		return new Response(readableStream, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Transfer-Encoding": "chunked",
				"Cache-Control": "no-cache",
			},
		});
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ChatHistoryValidationError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
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

interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

interface SimilaritySearchResult {
	formatted: string;
	verses: RetrievedVerse[];
	averageSimilarity: number;
}

interface VerseCoordinates {
	book: number;
	chapter: number;
	verse: number;
	similarity: number;
}

function asPositiveInteger(value: unknown): number | undefined {
	const numberValue = typeof value === "number" ? value : Number(value);
	return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function asSimilarity(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toVerseCoordinates(doc: Record<string, unknown>): VerseCoordinates | undefined {
	const book = asPositiveInteger(doc.b);
	const chapter = asPositiveInteger(doc.c);
	const verse = asPositiveInteger(doc.v);

	if (!book || !chapter || !verse) return undefined;

	return {
		book,
		chapter,
		verse,
		similarity: asSimilarity(doc.$similarity),
	};
}

async function performSimilaritySearch(query: string): Promise<SimilaritySearchResult> {
	try {
		const queryVector = await retryWithExponentialBackoff(() =>
			embeddings.embedQuery(query)
		);

		if (!Array.isArray(queryVector) || queryVector.length === 0) {
			throw new Error(`Expected a non-empty vector from embedding`);
		}

		const collection = astraDb.collection("openai_embedding_collection");

		const results = await retryWithExponentialBackoff(() =>
			collection
				.find(
					{},
					{
						sort: { $vector: queryVector },
						limit: 5,
						projection: { b: 1, c: 1, v: 1 },
						includeSimilarity: true,
					}
				)
				.toArray()
		);

		if (!results || results.length === 0) {
			return { formatted: "No relevant Bible verses found.", verses: [], averageSimilarity: 0 };
		}

		const coordinates = results.flatMap((doc: Record<string, unknown>) => {
			const parsed = toVerseCoordinates(doc);
			return parsed ? [parsed] : [];
		});

		const verses: RetrievedVerse[] = await Promise.all(
			coordinates.map(async ({ book, chapter, verse, similarity }) => {
				const bookName = getKjvBookName(book) ?? `Book ${book}`;
				const reference = `${bookName} ${chapter}:${verse}`;
				const text = await getKjvVerseText(book, chapter, verse);

				return { reference, similarity, ...(text ? { text } : {}) };
			})
		);

		const formattedResults = verses
			.map((verse) =>
				verse.text
					? `${verse.reference} KJV: "${verse.text}"`
					: `${verse.reference} KJV (reference only; do not quote)`
			)
			.join("\n");

		const averageSimilarity = verses.length > 0
			? verses.reduce((sum, v) => sum + v.similarity, 0) / verses.length
			: 0;

		return { formatted: formattedResults, verses, averageSimilarity };
	} catch (error) {
		console.error("Error performing similarity search:", error);
		throw error;
	}
}

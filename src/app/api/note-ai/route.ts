import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { noteAISystemPrompt } from "../../../utils/systemPrompt";
import { getAuthUser } from "@/lib/auth";

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
- Every claim MUST be supported by exact KJV Bible verse quotes (word-for-word, not paraphrased)
- Format verse quotes as blockquotes with the reference
- Use the similar verses provided above when relevant, but also reference other verses you know
- End with a thought-provoking question for deeper study`;

const BOOK_NAMES: Record<string, string> = {
	"1": "Genesis", "2": "Exodus", "3": "Leviticus", "4": "Numbers", "5": "Deuteronomy",
	"6": "Joshua", "7": "Judges", "8": "Ruth", "9": "1 Samuel", "10": "2 Samuel",
	"11": "1 Kings", "12": "2 Kings", "13": "1 Chronicles", "14": "2 Chronicles",
	"15": "Ezra", "16": "Nehemiah", "17": "Esther", "18": "Job", "19": "Psalms",
	"20": "Proverbs", "21": "Ecclesiastes", "22": "Song of Solomon", "23": "Isaiah",
	"24": "Jeremiah", "25": "Lamentations", "26": "Ezekiel", "27": "Daniel",
	"28": "Hosea", "29": "Joel", "30": "Amos", "31": "Obadiah", "32": "Jonah",
	"33": "Micah", "34": "Nahum", "35": "Habakkuk", "36": "Zephaniah", "37": "Haggai",
	"38": "Zechariah", "39": "Malachi",
	"40": "Matthew", "41": "Mark", "42": "Luke", "43": "John", "44": "Acts",
	"45": "Romans", "46": "1 Corinthians", "47": "2 Corinthians", "48": "Galatians",
	"49": "Ephesians", "50": "Philippians", "51": "Colossians",
	"52": "1 Thessalonians", "53": "2 Thessalonians", "54": "1 Timothy", "55": "2 Timothy",
	"56": "Titus", "57": "Philemon", "58": "Hebrews", "59": "James",
	"60": "1 Peter", "61": "2 Peter", "62": "1 John", "63": "2 John", "64": "3 John",
	"65": "Jude", "66": "Revelation",
};

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

interface HistoryMessage {
	role: "user" | "assistant";
	content: string;
}

const MAX_HISTORY_MESSAGES = 10;
const MAX_NOTE_CONTENT_LENGTH = 16000;

export async function POST(req: Request): Promise<Response> {
	try {
		await getAuthUser();

		const { question, noteContent, noteTitle, history } = await req.json();

		if (!question || typeof question !== "string") {
			return NextResponse.json(
				{ error: "Invalid input: 'question' must be a non-empty string." },
				{ status: 400 }
			);
		}

		// Truncate note content if too long
		const truncatedContent = noteContent
			? noteContent.slice(0, MAX_NOTE_CONTENT_LENGTH)
			: "";

		// Perform similarity search
		const searchResult = await retryWithExponentialBackoff(() =>
			performSimilaritySearch(question)
		);

		// Build messages with note context
		const langchainMessages = [
			new SystemMessage(noteAISystemPrompt(noteTitle || "Untitled Note", truncatedContent)),
		];

		// Add conversation history
		const priorHistory: HistoryMessage[] = Array.isArray(history) ? history.slice(0, -1) : [];
		const trimmedHistory = priorHistory.slice(-MAX_HISTORY_MESSAGES);

		for (const msg of trimmedHistory) {
			if (msg.role === "user") {
				langchainMessages.push(new HumanMessage(msg.content));
			} else if (msg.role === "assistant") {
				langchainMessages.push(new AIMessage(msg.content));
			}
		}

		langchainMessages.push(new HumanMessage(
			`Here are relevant Bible verses from the vector database:\n${searchResult.formatted}\n\nAnswer the following question about my Bible study note.\n${HUMAN_PROMPT_SUFFIX}\n\nQuestion: ${question}`
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
}

interface SimilaritySearchResult {
	formatted: string;
	verses: RetrievedVerse[];
	averageSimilarity: number;
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

		const verses: RetrievedVerse[] = [];
		const formattedResults = results
			.map((doc: Record<string, unknown>) => {
				const bookName = BOOK_NAMES[String(doc.b)] ?? `Book ${doc.b}`;
				const ref = `${bookName} ${doc.c}:${doc.v}`;
				const similarity = (doc.$similarity as number) ?? 0;
				verses.push({ reference: ref, similarity });
				return `${ref} (Similarity: ${similarity.toFixed(2)})`;
			})
			.filter(Boolean)
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

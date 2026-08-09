// src\app\api\ask-question\route.ts
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { systemPrompt } from "../../../utils/systemPrompt";
import { getAuthUser } from "@/lib/auth";
import {
  buildContextualRetrievalQuery,
  ChatHistoryValidationError,
  isContextDependentQuestion,
  MAX_CHAT_MESSAGE_CHARACTERS,
  parseConversationHistory,
} from "@/utils/chatContext";
import { getKjvBookName, getKjvVerseText } from "@/utils/kjvBible";

// Initialize OpenAI model and embeddings outside the handler for performance
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
  temperature: 0.2,
  maxTokens: 2000,
  timeout: 60000,
  streaming: true,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-large",
  timeout: 30000,
});

// Exponential backoff retry mechanism for robust API calls
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
      console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("This should never be reached");
}

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

    const priorHistory = parseConversationHistory(requestData.history, question);
    const isContextDependent =
      priorHistory.length > 0 && isContextDependentQuestion(question);
    const retrievalQuery = buildContextualRetrievalQuery(question, priorHistory);

    // Ambiguous follow-ups are embedded with their recent conversation context.
    const searchResult = await retryWithExponentialBackoff(() =>
      performSimilaritySearch(retrievalQuery)
    );

    // Build messages array with conversation history
    const langchainMessages = [
      new SystemMessage(systemPrompt),
    ];

    for (const msg of priorHistory) {
      if (msg.role === "user") {
        langchainMessages.push(new HumanMessage(msg.content));
      } else if (msg.role === "assistant") {
        langchainMessages.push(new AIMessage(msg.content));
      }
    }

    const turnGuidance = isContextDependent
      ? "FOLLOW-UP TURN: Continue the existing conversation and answer the user's latest request immediately. Use natural conversational prose, usually one to three short paragraphs. Do not add headings, an introduction, a recap, a summary, or a concluding formula unless the user explicitly asks for an organized study or list. Use only the Scripture needed for this specific follow-up. Usually omit suggested next questions on a simple follow-up; include one only when it is an unusually natural next step."
      : "Answer the opening question directly. A structured, thorough response is appropriate when the question is broad, but use only the structure the answer genuinely needs.";
    const retrievalGuidance = isContextDependent
      ? "The passages were retrieved using the recent conversation because this question depends on prior context."
      : "The passages were retrieved for the current question.";

    langchainMessages.push(new SystemMessage(turnGuidance));

    // Add the current question with exact KJV verse context.
    langchainMessages.push(new HumanMessage(
      `<retrieved_kjv_passages>\n${searchResult.formatted}\n</retrieved_kjv_passages>\n\n${retrievalGuidance}\n\nUse the retrieved passages when they are relevant, and ignore a retrieved passage if it does not answer the question. Quote Scripture only by copying exact wording supplied inside <retrieved_kjv_passages>; otherwise cite the KJV reference without inventing a quotation. Format full-verse quotations as Markdown blockquotes with their references.\n\nCurrent question: ${question}`
    ));

    // Stream the response, prefixed with source metadata
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
          // Send sources metadata first
          controller.enqueue(encoder.encode(sourcesMarker));

          for await (const chunk of stream) {
            const text = typeof chunk.content === 'string' ? chunk.content : '';
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
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ChatHistoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error in API route:", error);
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

export interface RetrievedVerse {
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

// Function to perform similarity search and retrieve relevant Bible verses
async function performSimilaritySearch(query: string): Promise<SimilaritySearchResult> {
  try {
    const queryVector = await retryWithExponentialBackoff(() =>
      embeddings.embedQuery(query)
    );

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error(
        `Expected a non-empty vector from embedding, but received: ${queryVector}`
      );
    }

    if (queryVector.length !== 3072) {
      throw new Error(
        `Vector size mismatch. Expected 3072 dimensions, but got ${queryVector.length}`
      );
    }

    const collection = astraDb.collection("openai_embedding_collection");

    const results = await retryWithExponentialBackoff(() =>
      collection
        .find(
          {},
          {
            sort: {
              $vector: queryVector
            },
            limit: 5,
            projection: { b: 1, c: 1, v: 1 },
            includeSimilarity: true
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

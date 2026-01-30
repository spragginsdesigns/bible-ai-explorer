// src\app\api\ask-question\route.ts
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { systemPrompt } from "../../../utils/systemPrompt";

// Initialize OpenAI model and embeddings outside the handler for performance
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

// Define the prompt template with natural response format
const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  [
    "human",
    `Here are relevant Bible verses from the vector database:
{similarVerses}

Answer the following question with a thorough, natural response.
- Every claim MUST be supported by exact KJV Bible verse quotes (word-for-word, not paraphrased)
- Format verse quotes as blockquotes with the reference (e.g., > "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." — John 3:16 KJV)
- Use the similar verses provided above when relevant, but also reference other verses you know
- End with a thought-provoking question for deeper study

Question: {question}
`
  ]
]);

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
    const { question } = await req.json();

    if (!question || typeof question !== 'string') {
      return NextResponse.json(
        { error: "Invalid input: 'question' must be a non-empty string." },
        { status: 400 }
      );
    }

    // Perform similarity search to retrieve relevant Bible verses
    const similarVerses = await retryWithExponentialBackoff(() => performSimilaritySearch(question));

    // Prepare the prompt with similar verses and the user's question
    const messages = await promptTemplate.formatMessages({
      similarVerses,
      question,
    });

    // Stream the response
    const stream = await model.stream(messages);

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
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

// Function to perform similarity search and retrieve relevant Bible verses
async function performSimilaritySearch(query: string): Promise<string> {
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
            projection: { v: 1 },
            includeSimilarity: true
          }
        )
        .toArray()
    );

    if (!results || results.length === 0) {
      return "No relevant Bible verses found.";
    }

    const formattedResults = results
      .map((doc: any) => {
        const verse = doc.v;
        const similarity = doc.$similarity;
        if (typeof verse !== 'string') {
          return '';
        }
        return similarity !== undefined
          ? `${verse} (Similarity: ${similarity.toFixed(2)})`
          : verse;
      })
      .filter(Boolean)
      .join("\n");

    return formattedResults;
  } catch (error) {
    console.error("Error performing similarity search:", error);
    throw error;
  }
}

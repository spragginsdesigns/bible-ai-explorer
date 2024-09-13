import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { systemPrompt } from "../../../utils/systemPrompt";
import { LRUCache } from 'lru-cache';

export const runtime = "edge";

interface DocResult {
	v: string;
	$vector: number[];
	$similarity?: number;
}

// Initialize LRU cache
const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 60,
});

// Initialize OpenAI model and embeddings outside the handler
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-3.5-turbo",
  temperature: 0,
  maxTokens: 1000,
  timeout: 60000,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-large",
  timeout: 30000,
});

const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  [
    "human",
    `Here are some relevant Bible verses that may be helpful for answering the question:
{similarVerses}

Please provide your response in the following format:

1. Content: Provide a concise answer to the question, using markdown formatting for headers, lists, and emphasis.

2. Key Takeaways:
   - First main point from your answer
   - Second main point from your answer

3. Reflection Question: End with a thought-provoking question related to the topic.

4. Biblical References:
   - Most relevant Bible reference

Question: {question}`
  ]
]);

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

export async function POST(req: Request): Promise<NextResponse> {
	try {
		const { question } = await req.json();

		// Check cache first
		const cachedResponse = cache.get(question);
		if (cachedResponse) {
			console.log("Returning cached response:", cachedResponse);
			return NextResponse.json({ response: cachedResponse });
		}

		// Parallel execution of similarity search and model initialization
		const [similarVerses, chain] = await Promise.all([
			retryWithExponentialBackoff(() => performSimilaritySearch(question)),
			promptTemplate.pipe(model).pipe(new StringOutputParser())
		]);

		const result = await retryWithExponentialBackoff(() =>
			chain.invoke({ question, similarVerses })
		);

		if (typeof result !== "string") {
			throw new Error("Unexpected response format from OpenAI");
		}

		console.log("Raw API response:", result);

		// Cache the result
		cache.set(question, result);

		return NextResponse.json({ response: result });
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

async function performSimilaritySearch(query: string): Promise<string> {
	try {
		const queryVector = await retryWithExponentialBackoff(() =>
			embeddings.embedQuery(query)
		);

		if (queryVector.length !== 3072) {
			throw new Error(
				`Expected vector of length 3072, but got ${queryVector.length}`
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
						limit: 3,
						projection: { v: 1 },
						includeSimilarity: true
					}
				)
				.toArray()
		);

		return results
			.map((doc) => {
				const verse = doc.v;
				const similarity = doc.$similarity;
				return `${verse} (Similarity: ${similarity?.toFixed(2)})`;
			})
			.join("\n");
	} catch (error) {
		console.error("Error performing similarity search:", error);
		throw error;
	}
}

// src\app\api\ask-question\route.ts
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { systemPrompt } from "../../../utils/systemPrompt";
import { LRUCache } from 'lru-cache';
import { BaseMessage } from "@langchain/core/messages";

interface DocResult {
  v?: string;
  $similarity?: number;
}

// Initialize LRU cache
const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 60, // 1 hour
});

// Initialize OpenAI model and embeddings outside the handler for performance
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
  temperature: 0,
  maxTokens: 2000,
  timeout: 60000,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-large",
  timeout: 30000,
});

console.log("Initialized OpenAIEmbeddings with model:", embeddings.modelName);

// Define the prompt template with clear instructions
const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  [
    "human",
    `Here are some relevant Bible verses that may be helpful for answering the question:
{similarVerses}

Please provide your response in the following markdown format:

**Answer 1:**
Provide a comprehensive answer to the question, grounded in Biblical teachings.

**Biblical Reference 1:**
- (Book Chapter:Verse) Brief explanation or context of the reference.

**Answer 2:**
Provide another comprehensive answer to the question, possibly exploring a different aspect.

**Biblical Reference 2:**
- (Book Chapter:Verse) Brief explanation or context of the reference.

**Answer 3:**
Provide a third comprehensive answer to the question, offering further insight.

**Biblical Reference 3:**
- (Book Chapter:Verse) Brief explanation or context of the reference.

**Translation Insights:**
Any important mentions of original Greek/Hebrew translation thoughts and reflections.

**Overall Explanation / Summary:**
A cohesive summary that ties together the answers and references provided.

**Thought-Provoking Question:**
End with a question that encourages deeper Biblical study and personal reflection.

**Question:** {question}
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

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { question } = await req.json();

    if (!question || typeof question !== 'string') {
      return NextResponse.json(
        { error: "Invalid input: 'question' must be a non-empty string." },
        { status: 400 }
      );
    }

    // Check cache first
    const cachedResponse = cache.get(question);
    if (cachedResponse) {
      console.log("Returning cached response:", cachedResponse);
      return NextResponse.json({ response: cachedResponse });
    }

    // Perform similarity search to retrieve relevant Bible verses
    const similarVerses = await retryWithExponentialBackoff(() => performSimilaritySearch(question));
    console.log("Similar Verses Found:", similarVerses);

    // Prepare the prompt with similar verses and the user's question
    const messages = await promptTemplate.formatMessages({
      similarVerses,
      question,
    });

    console.log("Constructed Messages:", messages);

    // Invoke the OpenAI model
    const result = await retryWithExponentialBackoff(() =>
      model.call(messages, {
        // Additional parameters can be added here if needed
      })
    );

    if (!result.content || typeof result.content !== "string") {
      throw new Error("Unexpected response format from OpenAI");
    }

    console.log("Raw API response:", result.content);

    // Validate the response structure
    const isValid = validateResponseFormat(result.content);
    if (!isValid) {
      console.warn("Response format is invalid. Response:", result.content);
      return NextResponse.json(
        { error: "Received an improperly formatted response from the AI. Please try again." },
        { status: 500 }
      );
    }

    // Cache the validated result
    cache.set(question, result.content);

    return NextResponse.json({ response: result.content });
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
    console.log("Starting similarity search for query:", query);

    const queryVector = await retryWithExponentialBackoff(() =>
      embeddings.embedQuery(query)
    );

    console.log("Generated query vector. Length:", queryVector.length);

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error(
        `Expected a non-empty vector from embedding, but received: ${queryVector}`
      );
    }

    // Check if the vector size matches the expected 3072 dimensions
    if (queryVector.length !== 3072) {
      throw new Error(
        `Vector size mismatch. Expected 3072 dimensions, but got ${queryVector.length}`
      );
    }

    const collection = astraDb.collection("openai_embedding_collection");

    console.log("Querying Astra DB collection...");

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

    console.log("Astra DB query completed. Results count:", results.length);

    if (!results || results.length === 0) {
      console.warn("No similar verses found for the query.");
      return "No relevant Bible verses found.";
    }

    const formattedResults = results
      .map((doc: any) => {
        const verse = doc.v;
        const similarity = doc.$similarity;
        if (typeof verse !== 'string') {
          console.warn('Unexpected document structure:', doc);
          return '';
        }
        return similarity !== undefined
          ? `${verse} (Similarity: ${similarity.toFixed(2)})`
          : verse;
      })
      .filter(Boolean)
      .join("\n");

    console.log("Formatted results:", formattedResults);

    return formattedResults;
  } catch (error) {
    console.error("Error performing similarity search:", error);
    throw error;
  }
}

// Function to validate the response format
function validateResponseFormat(response: string): boolean {
  // Basic validation to check if all required sections are present
  const requiredSections = [
    "**Answer 1:**",
    "**Biblical Reference 1:**",
    "**Answer 2:**",
    "**Biblical Reference 2:**",
    "**Answer 3:**",
    "**Biblical Reference 3:**",
    "**Translation Insights:**",
    "**Overall Explanation / Summary:**",
    "**Thought-Provoking Question:**"
  ];

  return requiredSections.every(section => response.includes(section));
}

import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { systemPrompt } from "../../../utils/systemPrompt";

export const runtime = "edge";

interface DocResult {
	v: string;
	$vector: number[];
	$similarity?: number;
}

export async function POST(req: Request): Promise<NextResponse> {
	try {
		console.log("API route started");
		const { question } = await req.json();
		console.log("Received question:", question);

		const similarVerses = await performSimilaritySearch(question);
		console.log("Similar verses:", similarVerses);

		const model = new ChatOpenAI({
			openAIApiKey: process.env.OPENAI_API_KEY,
			modelName: "gpt-4",
			temperature: 0,
			maxTokens: 2000
		});
		console.log("ChatOpenAI model initialized");

		const promptTemplate = ChatPromptTemplate.fromMessages([
			["system", systemPrompt],
			[
				"human",
				`Here are some relevant Bible verses that may be helpful for answering the question:
{similarVerses}

Please provide your response in the following format:

1. Content: Provide a detailed answer to the question, using markdown formatting for headers, lists, and emphasis.

2. Key Takeaways:
   - First main point from your answer
   - Second main point from your answer
   - Third main point from your answer

3. Reflection Question: End with a thought-provoking question related to the topic.

4. Biblical References:
   - First relevant Bible reference
   - Second relevant Bible reference
   - Third relevant Bible reference

Question: {question}`
			]
		]);

		console.log("Prompt template created");

		const outputParser = new StringOutputParser();
		console.log("Output parser created");

		const chain = promptTemplate.pipe(model).pipe(outputParser);
		console.log("Chain created");

		console.log("Invoking chain with question:", question);
		const result = await chain.invoke({ question, similarVerses });
		console.log("Raw OpenAI response:", result);

		// Ensure the result is a string before sending it back
		if (typeof result !== "string") {
			throw new Error("Unexpected response format from OpenAI");
		}

		return NextResponse.json({ response: result });
	} catch (error) {
		console.error("Error in API route:", error);
		return NextResponse.json(
			{ error: "An error occurred while processing your request." },
			{ status: 500 }
		);
	}
}

async function performSimilaritySearch(query: string): Promise<string> {
	try {
		const embeddings = new OpenAIEmbeddings({
			openAIApiKey: process.env.OPENAI_API_KEY,
			modelName: "text-embedding-3-large"
		});

		const queryVector = await embeddings.embedQuery(query);

		if (queryVector.length !== 3072) {
			throw new Error(
				`Expected vector of length 3072, but got ${queryVector.length}`
			);
		}

		const collection = astraDb.collection("openai_embedding_collection");

		const results = await collection
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
			.toArray();

		return results
			.map((doc) => {
				const verse = doc.v;
				const similarity = doc.$similarity;
				return `${verse} (Similarity: ${similarity?.toFixed(4)})`;
			})
			.join("\n");
	} catch (error) {
		console.error("Error performing similarity search:", error);
		return "";
	}
}

import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import { astraDb } from "../../../utils/astraDb";
import { FoundDoc } from "@datastax/astra-db-ts";
import { systemPrompt } from "../../../utils/systemPrompt";

export const runtime = "edge";

// Update the DocResult interface
interface DocResult {
	v: string;
	$vector: number[];
	$similarity?: number;
}

export async function POST(req: Request): Promise<NextResponse> {
	try {
		const { question } = await req.json();

		const similarVerses = await performSimilaritySearch(question);

		const model = new ChatOpenAI({
			openAIApiKey: process.env.OPENAI_API_KEY,
			modelName: "gpt-4",
			temperature: 0.1,
			maxTokens: 1000
		});

		const promptTemplate = ChatPromptTemplate.fromMessages([
			[
				"system",
				`${systemPrompt}

Here are some relevant Bible verses that may be helpful for answering the question:
${similarVerses}`
			],
			["human", "{question}"]
		]);

		const outputParser = new StringOutputParser();

		const chain = promptTemplate.pipe(model).pipe(outputParser);

		const result = await chain.invoke({ question });

		return NextResponse.json({ response: result });
	} catch (error) {
		console.error("Error:", error);
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
			modelName: "text-embedding-3-large" // Use the latest model that generates 3072-dimensional vectors
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

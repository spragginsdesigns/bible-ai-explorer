import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
	buildContextualWebSearchQuery,
	ChatHistoryValidationError,
	MAX_CHAT_MESSAGE_CHARACTERS,
	parseConversationHistory,
} from "@/utils/chatContext";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_API_URL = "https://api.tavily.com/search";

export async function POST(req: Request) {
	try {
		await getAuthUser();

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};
		const rawQuery = requestData.query;

		if (typeof rawQuery !== "string" || !rawQuery.trim()) {
			return NextResponse.json(
				{ error: "Invalid input: 'query' must be a non-empty string." },
				{ status: 400 }
			);
		}

		const query = rawQuery.trim();
		if (query.length > MAX_CHAT_MESSAGE_CHARACTERS) {
			return NextResponse.json(
				{ error: `Invalid input: 'query' is limited to ${MAX_CHAT_MESSAGE_CHARACTERS} characters.` },
				{ status: 400 }
			);
		}

		const history = parseConversationHistory(requestData.history, query);
		const searchQuery = buildContextualWebSearchQuery(query, history);

		const response = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				api_key: TAVILY_API_KEY,
				query: searchQuery,
				search_depth: "advanced",
				include_answer: true,
				max_results: 5
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Tavily API response was not ok: ${response.status}. Error: ${errorText}`
			);
		}

		const data = await response.json();
		return NextResponse.json(data);
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof ChatHistoryValidationError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		console.error("Error in Tavily search:", error);
		return NextResponse.json(
			{ error: "An error occurred during the search" },
			{ status: 500 }
		);
	}
}

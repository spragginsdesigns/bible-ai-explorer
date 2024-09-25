import { NextResponse } from "next/server";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_API_URL = "https://api.tavily.com/search";

export async function POST(req: Request) {
	try {
		const { query } = await req.json();

		const response = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				api_key: TAVILY_API_KEY,
				query: query,
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
		console.error("Error in Tavily search:", error);
		return NextResponse.json(
			{ error: "An error occurred during the search" },
			{ status: 500 }
		);
	}
}

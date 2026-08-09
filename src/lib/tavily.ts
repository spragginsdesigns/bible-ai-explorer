export interface TavilyResult {
	title: string;
	content: string;
	url: string;
}

const TAVILY_API_URL = "https://api.tavily.com/search";

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) {
		throw new Error("TAVILY_API_KEY is not configured.");
	}

	const response = await fetch(TAVILY_API_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			search_depth: "advanced",
			include_answer: true,
			max_results: 5,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Tavily API error ${response.status}: ${errorText}`);
	}

	const data: unknown = await response.json();
	const results =
		typeof data === "object" && data !== null && Array.isArray((data as { results?: unknown }).results)
			? ((data as { results: unknown[] }).results)
			: [];

	return results.flatMap((result): TavilyResult[] => {
		if (
			typeof result !== "object" ||
			result === null ||
			typeof (result as TavilyResult).title !== "string" ||
			typeof (result as TavilyResult).content !== "string" ||
			typeof (result as TavilyResult).url !== "string"
		) {
			return [];
		}
		const { title, content, url } = result as TavilyResult;
		return [{ title, content, url }];
	});
}

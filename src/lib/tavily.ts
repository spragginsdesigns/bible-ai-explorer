export interface TavilyResult {
	title: string;
	content: string;
	url: string;
	/** Site icon URL, shown next to the source in the chat UI. */
	favicon?: string;
}

export interface TavilySearchResponse {
	/** Tavily's LLM-generated answer to the query (null when none was produced). */
	answer: string | null;
	results: TavilyResult[];
}

export interface TavilySearchOptions {
	/** "news" fits current-events queries; "general" is the default. */
	topic?: "general" | "news" | "finance";
	/** Only return results published/updated within this window. */
	timeRange?: "day" | "week" | "month" | "year";
}

const TAVILY_API_URL = "https://api.tavily.com/search";
// Cap each search so a slow Tavily call can't stall the chat stream.
const TAVILY_TIMEOUT_MS = 10_000;

export async function tavilySearch(
	query: string,
	options: TavilySearchOptions = {}
): Promise<TavilySearchResponse> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) {
		throw new Error("TAVILY_API_KEY is not configured.");
	}

	const response = await fetch(TAVILY_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			query,
			search_depth: "advanced",
			chunks_per_source: 3,
			include_answer: true,
			include_favicon: true,
			max_results: 5,
			...(options.topic ? { topic: options.topic } : {}),
			...(options.timeRange ? { time_range: options.timeRange } : {}),
		}),
		signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Tavily API error ${response.status}: ${errorText}`);
	}

	const data: unknown = await response.json();
	const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
	const rawResults = Array.isArray(record.results) ? record.results : [];
	const answer = typeof record.answer === "string" && record.answer.trim() ? record.answer : null;

	const results = rawResults.flatMap((result): TavilyResult[] => {
		if (
			typeof result !== "object" ||
			result === null ||
			typeof (result as TavilyResult).title !== "string" ||
			typeof (result as TavilyResult).content !== "string" ||
			typeof (result as TavilyResult).url !== "string"
		) {
			return [];
		}
		const { title, content, url, favicon } = result as TavilyResult;
		return [{ title, content, url, ...(typeof favicon === "string" ? { favicon } : {}) }];
	});

	return { answer, results };
}

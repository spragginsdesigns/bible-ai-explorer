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

export interface TavilyExtractResult {
	url: string;
	/** The page as plain text, cut to MAX_EXTRACT_CHARS. */
	content: string;
	truncated: boolean;
}

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
/** Room for a long article or a sermon page without crowding out the answer. */
export const MAX_EXTRACT_CHARS = 60_000;
// Extraction renders the page, so it gets longer than a search.
const TAVILY_EXTRACT_TIMEOUT_MS = 20_000;

/** Read one web page as text, for "/verify <link>". Null when it could not be read. */
export async function tavilyExtract(url: string): Promise<TavilyExtractResult | null> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) {
		throw new Error("TAVILY_API_KEY is not configured.");
	}

	const response = await fetch(TAVILY_EXTRACT_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ urls: [url], extract_depth: "advanced", format: "text" }),
		signal: AbortSignal.timeout(TAVILY_EXTRACT_TIMEOUT_MS),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Tavily API error ${response.status}: ${errorText}`);
	}

	const data: unknown = await response.json();
	const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
	const first = Array.isArray(record.results) ? (record.results[0] as Record<string, unknown> | undefined) : undefined;
	const content = typeof first?.raw_content === "string" ? first.raw_content.trim() : "";
	if (!content) return null;
	return {
		url: typeof first?.url === "string" ? first.url : url,
		content: content.slice(0, MAX_EXTRACT_CHARS),
		truncated: content.length > MAX_EXTRACT_CHARS,
	};
}

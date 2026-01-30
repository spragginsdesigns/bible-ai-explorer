import { useState, useRef, useCallback } from "react";

interface HistoryItem {
	id: string;
	question: string;
	answer: string;
	selected: boolean;
}

export const useChat = (initialQuery: string = "") => {
	const [query, setQuery] = useState<string>(initialQuery);
	const [response, setResponse] = useState<string | null>(null);
	const [loading, setLoading] = useState<boolean>(false);
	const [isStreaming, setIsStreaming] = useState<boolean>(false);
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [tavilyResults, setTavilyResults] = useState<any>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	const handleSubmit = useCallback(async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim()) return;

		// Abort any in-flight request
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		setLoading(true);
		setResponse(null);
		setError(null);
		setTavilyResults(null);

		const currentQuery = query;
		setQuery("");

		try {
			// Run Tavily and Bible AI in parallel
			const tavilyPromise = fetch("/api/tavily-search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: currentQuery }),
				signal: abortController.signal,
			}).then(async (res) => {
				if (!res.ok) throw new Error(`Tavily API error: ${res.status}`);
				const data = await res.json();
				setTavilyResults(data.results);
			});

			const bibleAiPromise = fetch("/api/ask-question", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: currentQuery }),
				signal: abortController.signal,
			}).then(async (res) => {
				if (!res.ok) {
					// Try to parse error JSON
					const contentType = res.headers.get("content-type");
					if (contentType?.includes("application/json")) {
						const data = await res.json();
						throw new Error(data.error || `API error: ${res.status}`);
					}
					throw new Error(`API error: ${res.status}`);
				}

				// Read the stream
				const reader = res.body?.getReader();
				if (!reader) throw new Error("No response body");

				setLoading(false);
				setIsStreaming(true);

				const decoder = new TextDecoder();
				let accumulated = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					accumulated += decoder.decode(value, { stream: true });
					setResponse(accumulated);
				}

				// Flush decoder
				accumulated += decoder.decode();
				setResponse(accumulated);

				return accumulated;
			});

			const results = await Promise.allSettled([tavilyPromise, bibleAiPromise]);

			// Check for Bible AI failure
			const bibleResult = results[1];
			if (bibleResult.status === "rejected") {
				throw bibleResult.reason;
			}

			// Add to history
			const finalContent = bibleResult.status === "fulfilled" ? bibleResult.value as string : "";
			if (finalContent) {
				setHistory((prev) => [
					...prev,
					{
						id: Date.now().toString(),
						question: currentQuery,
						answer: finalContent,
						selected: false
					}
				]);
			}

			// Log Tavily failure but don't throw (it's supplementary)
			if (results[0].status === "rejected") {
				console.warn("Tavily search failed:", results[0].reason);
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") return;
			console.error("Error:", err);
			setError(
				err instanceof Error ? err.message : "An unknown error occurred"
			);
		} finally {
			setLoading(false);
			setIsStreaming(false);
		}
	}, [query]);

	const selectHistoryItem = (id: string) => {
		setHistory((prev) =>
			prev.map((item) => ({
				...item,
				selected: item.id === id
			}))
		);
	};

	const clearHistory = () => {
		setHistory([]);
	};

	return {
		query,
		setQuery,
		response,
		loading,
		isStreaming,
		history,
		handleSubmit,
		selectHistoryItem,
		clearHistory,
		error,
		tavilyResults
	};
};

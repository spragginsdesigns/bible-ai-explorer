import { useState } from "react";

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
	const [isTyping, setIsTyping] = useState<boolean>(false);
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim()) return;

		setLoading(true);
		setResponse(null);
		setError(null);

		try {
			const response = await fetch("/api/ask-question", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ question: query })
			});

			if (!response.ok) {
				throw new Error(`API response was not ok: ${response.status}`);
			}

			const data = await response.json();

			if (data.error) {
				throw new Error(data.error);
			}

			if (!data.response || typeof data.response !== "string") {
				throw new Error("Invalid response format");
			}

			console.log("Raw response from API:", data.response);

			setIsTyping(true);
			let i = 0;
			const content = data.response;
			const intervalId = setInterval(() => {
				setResponse(content.slice(0, i));
				i += 5;
				if (i > content.length) {
					clearInterval(intervalId);
					setIsTyping(false);
					setResponse(content);
					setHistory((prev) => [
						...prev,
						{
							id: Date.now().toString(),
							question: query,
							answer: content,
							selected: false
						}
					]);
				}
			}, 10);
		} catch (error) {
			console.error("Error:", error);
			setError(error instanceof Error ? error.message : "An unknown error occurred");
		} finally {
			setLoading(false);
			setQuery("");
		}
	};

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
		isTyping,
		history,
		handleSubmit,
		selectHistoryItem,
		clearHistory,
		error
	};
};

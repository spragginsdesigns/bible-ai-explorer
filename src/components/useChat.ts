import { useState } from "react";

export interface FormattedResponseType {
	content: string;
	keyTakeaways: string[];
	reflectionQuestion: string;
	biblicalReferences: string[];
}

interface HistoryItem {
	id: string;
	question: string;
	answer: string;
	selected: boolean;
}

export const useChat = (initialQuery: string = "") => {
	const [query, setQuery] = useState<string>(initialQuery);
	const [response, setResponse] = useState<FormattedResponseType | null>(null);
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

			const parsedResponse = parseResponse(data.response);
			console.log("Parsed response:", parsedResponse);

			setIsTyping(true);
			let i = 0;
			const content = parsedResponse.content;
			const intervalId = setInterval(() => {
				setResponse({
					content: content.slice(0, i),
					keyTakeaways: parsedResponse.keyTakeaways || [],
					reflectionQuestion: parsedResponse.reflectionQuestion || "",
					biblicalReferences: parsedResponse.biblicalReferences || []
				});
				i += 5;
				if (i > content.length) {
					clearInterval(intervalId);
					setIsTyping(false);
					setResponse(parsedResponse);
					setHistory((prev) => [
						...prev,
						{
							id: Date.now().toString(),
							question: query,
							answer: JSON.stringify(parsedResponse),
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

function parseResponse(response: string): FormattedResponseType {
	console.log("Parsing response:", response);

	const contentMatch = response.match(/Content:([\s\S]*?)(?=Key Takeaways:|$)/i);
	const keyTakeawaysMatch = response.match(/Key Takeaways:([\s\S]*?)(?=Reflection Question:|$)/i);
	const reflectionQuestionMatch = response.match(/Reflection Question:([\s\S]*?)(?=Biblical References:|$)/i);
	const biblicalReferencesMatch = response.match(/Biblical References:([\s\S]*?)$/i);

	const parsed: FormattedResponseType = {
		content: contentMatch ? contentMatch[1].trim() : "",
		keyTakeaways: keyTakeawaysMatch
			? keyTakeawaysMatch[1]
					.split("-")
					.filter(Boolean)
					.map((item) => item.trim())
			: [],
		reflectionQuestion: reflectionQuestionMatch ? reflectionQuestionMatch[1].trim() : "",
		biblicalReferences: biblicalReferencesMatch
			? biblicalReferencesMatch[1]
					.split("-")
					.filter(Boolean)
					.map((item) => item.trim())
			: [],
	};

	console.log("Parsed response:", parsed);
	return parsed;
}

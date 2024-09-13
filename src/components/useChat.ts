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

	const sections = response.split(/\d+\.\s+\*\*([^:]+):\*\*/);
	const parsedResponse: FormattedResponseType = {
		content: "",
		keyTakeaways: [],
		reflectionQuestion: "",
		biblicalReferences: []
	};

	for (let i = 1; i < sections.length; i += 2) {
		const sectionTitle = sections[i].trim().toLowerCase();
		const sectionContent = sections[i + 1].trim();

		switch (sectionTitle) {
			case "content":
				parsedResponse.content = sectionContent;
				break;
			case "reflection question":
				parsedResponse.reflectionQuestion = sectionContent;
				break;
			case "biblical references":
				parsedResponse.biblicalReferences = sectionContent.split("\n").map(ref => ref.trim()).filter(Boolean);
				break;
			default:
				// Assume any other section is part of key takeaways
				const takeaways = sectionContent.split("-").map(item => item.trim()).filter(Boolean);
				parsedResponse.keyTakeaways.push(...takeaways);
				break;
		}
	}

	console.log("Parsed response:", parsedResponse);
	return parsedResponse;
}

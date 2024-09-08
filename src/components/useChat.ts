import { useState } from "react";

export const useChat = () => {
	const [query, setQuery] = useState("");
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const [isTyping, setIsTyping] = useState(false);
	const [history, setHistory] = useState<
		Array<{ id: string; question: string; answer: string; selected: boolean }>
	>([]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim()) return;

		setLoading(true);
		setResponse("");

		try {
			const response = await fetch("/api/ask-question", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ question: query })
			});

			if (!response.ok) {
				throw new Error("API response was not ok");
			}

			const data = await response.json();

			setIsTyping(true);
			let i = 0;
			const intervalId = setInterval(() => {
				setResponse(data.response.slice(0, i));
				i += 5;
				if (i > data.response.length) {
					clearInterval(intervalId);
					setIsTyping(false);
					setResponse(data.response);
					setHistory((prev) => [
						...prev,
						{
							id: Date.now().toString(),
							question: query,
							answer: data.response,
							selected: false
						}
					]);
				}
			}, 10);
		} catch (error) {
			console.error("Error:", error);
			setResponse("An error occurred while processing your request.");
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

	return {
		query,
		setQuery,
		response,
		loading,
		isTyping,
		history,
		handleSubmit,
		selectHistoryItem
	};
};

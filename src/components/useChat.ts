"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	tavilyResults?: TavilyResult[];
	retrievedVerses?: RetrievedVerse[];
	averageSimilarity?: number;
	followUps?: string[];
	isStreaming?: boolean;
	timestamp: number;
}

export interface TavilyResult {
	title: string;
	content: string;
	url: string;
}

export interface Conversation {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
}

const STORAGE_KEY = "versemind-conversations";

function loadConversations(): Conversation[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

function saveConversations(convos: Conversation[]) {
	if (typeof window === "undefined") return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(convos));
}

export const useChat = () => {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const initialized = useRef(false);

	// Load from localStorage on mount
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;
		const loaded = loadConversations();
		setConversations(loaded);
	}, []);

	// Persist on change
	useEffect(() => {
		if (initialized.current) {
			saveConversations(conversations);
		}
	}, [conversations]);

	const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;
	const messages = activeConversation?.messages ?? [];

	const newConversation = useCallback(() => {
		setActiveConversationId(null);
		setError(null);
	}, []);

	const switchConversation = useCallback((id: string) => {
		setActiveConversationId(id);
		setError(null);
	}, []);

	const deleteConversation = useCallback(
		(id: string) => {
			setConversations((prev) => prev.filter((c) => c.id !== id));
			if (activeConversationId === id) {
				setActiveConversationId(null);
			}
		},
		[activeConversationId]
	);

	const clearAllConversations = useCallback(() => {
		setConversations([]);
		setActiveConversationId(null);
	}, []);

	const sendMessage = useCallback(
		async (text: string) => {
			if (!text.trim()) return;

			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			setError(null);
			setLoading(true);

			const userMsg: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: text,
				timestamp: Date.now(),
			};

			const assistantMsg: ChatMessage = {
				id: crypto.randomUUID(),
				role: "assistant",
				content: "",
				isStreaming: true,
				timestamp: Date.now(),
			};

			let convoId = activeConversationId;

			if (!convoId) {
				// Create new conversation
				convoId = crypto.randomUUID();
				const newConvo: Conversation = {
					id: convoId,
					title: text.slice(0, 60),
					messages: [userMsg, assistantMsg],
					createdAt: Date.now(),
				};
				setConversations((prev) => [newConvo, ...prev]);
				setActiveConversationId(convoId);
			} else {
				// Add to existing conversation
				setConversations((prev) =>
					prev.map((c) =>
						c.id === convoId
							? { ...c, messages: [...c.messages, userMsg, assistantMsg] }
							: c
					)
				);
			}

			const currentConvoId = convoId;

			const updateAssistant = (updater: (msg: ChatMessage) => ChatMessage) => {
				setConversations((prev) =>
					prev.map((c) =>
						c.id === currentConvoId
							? {
									...c,
									messages: c.messages.map((m) =>
										m.id === assistantMsg.id ? updater(m) : m
									),
								}
							: c
					)
				);
			};

			try {
				// Run Tavily and Bible AI in parallel
				const tavilyPromise = fetch("/api/tavily-search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query: text }),
					signal: abortController.signal,
				}).then(async (res) => {
					if (!res.ok) throw new Error(`Tavily API error: ${res.status}`);
					const data = await res.json();
					return data.results as TavilyResult[];
				});

				const bibleAiPromise = fetch("/api/ask-question", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ question: text }),
					signal: abortController.signal,
				}).then(async (res) => {
					if (!res.ok) {
						const contentType = res.headers.get("content-type");
						if (contentType?.includes("application/json")) {
							const data = await res.json();
							throw new Error(data.error || `API error: ${res.status}`);
						}
						throw new Error(`API error: ${res.status}`);
					}

					const reader = res.body?.getReader();
					if (!reader) throw new Error("No response body");

					setLoading(false);
					setIsStreaming(true);

					const decoder = new TextDecoder();
					let accumulated = "";
					let sourcesParsed = false;

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						accumulated += decoder.decode(value, { stream: true });

						// Parse sources marker from stream prefix
						if (!sourcesParsed && accumulated.includes("-->")) {
							const markerMatch = accumulated.match(/<!--SOURCES:(.*?)-->/);
							if (markerMatch) {
								try {
									const sourcesData = JSON.parse(markerMatch[1]);
									updateAssistant((m) => ({
										...m,
										retrievedVerses: sourcesData.verses,
										averageSimilarity: sourcesData.averageSimilarity,
									}));
								} catch {
									// Ignore parse errors
								}
								accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");
								sourcesParsed = true;
							}
						}

						const displayContent = sourcesParsed
							? accumulated
							: accumulated.replace(/<!--SOURCES:.*/, "");
						updateAssistant((m) => ({ ...m, content: displayContent }));
					}

					accumulated += decoder.decode();
					accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");

					// Parse follow-up questions from completed response
					const followUpRegex = /\[FOLLOWUP\]\s*(.+)/g;
					const followUps: string[] = [];
					let match;
					while ((match = followUpRegex.exec(accumulated)) !== null) {
						followUps.push(match[1].trim());
					}
					const cleanContent = accumulated.replace(/\[FOLLOWUP\]\s*.+/g, "").trimEnd();

					updateAssistant((m) => ({
						...m,
						content: cleanContent,
						...(followUps.length > 0 ? { followUps } : {}),
					}));

					return cleanContent;
				});

				const results = await Promise.allSettled([tavilyPromise, bibleAiPromise]);

				// Attach tavily results
				if (results[0].status === "fulfilled" && results[0].value) {
					updateAssistant((m) => ({ ...m, tavilyResults: results[0].status === "fulfilled" ? results[0].value : undefined }));
				}

				// Check for Bible AI failure
				if (results[1].status === "rejected") {
					throw results[1].reason;
				}

				// Mark streaming done
				updateAssistant((m) => ({ ...m, isStreaming: false }));

				if (results[0].status === "rejected") {
					console.warn("Tavily search failed:", results[0].reason);
				}
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") return;
				console.error("Error:", err);
				const errorMsg = err instanceof Error ? err.message : "An unknown error occurred";
				setError(errorMsg);
				updateAssistant((m) => ({
					...m,
					content: m.content || "Sorry, an error occurred while generating a response.",
					isStreaming: false,
				}));
			} finally {
				setLoading(false);
				setIsStreaming(false);
			}
		},
		[activeConversationId]
	);

	return {
		messages,
		conversations,
		activeConversationId,
		activeConversation,
		isStreaming,
		loading,
		error,
		sendMessage,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	};
};

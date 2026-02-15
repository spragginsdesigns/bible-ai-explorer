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
	createdAt: string;
}

/** Map a DB message to our client ChatMessage shape */
function toClientMessage(dbMsg: {
	id: string;
	role: string;
	content: string;
	metadata?: Record<string, unknown> | null;
	createdAt: string;
}): ChatMessage {
	const meta = dbMsg.metadata ?? {};
	return {
		id: dbMsg.id,
		role: dbMsg.role as "user" | "assistant",
		content: dbMsg.content,
		tavilyResults: (meta as Record<string, unknown>).tavilyResults as TavilyResult[] | undefined,
		retrievedVerses: (meta as Record<string, unknown>).retrievedVerses as RetrievedVerse[] | undefined,
		averageSimilarity: (meta as Record<string, unknown>).averageSimilarity as number | undefined,
		followUps: (meta as Record<string, unknown>).followUps as string[] | undefined,
		timestamp: new Date(dbMsg.createdAt).getTime(),
	};
}

export const useChat = () => {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [initialLoading, setInitialLoading] = useState(true);
	const abortControllerRef = useRef<AbortController | null>(null);
	const initialized = useRef(false);
	const conversationsRef = useRef<Conversation[]>([]);

	// Keep ref in sync with state
	useEffect(() => {
		conversationsRef.current = conversations;
	}, [conversations]);

	// Load conversations from API on mount
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		(async () => {
			try {
				const res = await fetch("/api/conversations");
				if (res.ok) {
					const data = await res.json();
					setConversations(
						data.map((c: { id: string; title: string; createdAt: string }) => ({
							id: c.id,
							title: c.title,
							messages: [],
							createdAt: c.createdAt,
						}))
					);
				}
			} catch {
				// Silent fail on initial load
			} finally {
				setInitialLoading(false);
			}
		})();
	}, []);

	const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;
	const messages = activeConversation?.messages ?? [];

	// Load messages when switching conversations
	const switchConversation = useCallback(async (id: string) => {
		setActiveConversationId(id);
		setError(null);

		// Check if messages are already loaded
		const existing = conversationsRef.current.find((c) => c.id === id);
		if (existing && existing.messages.length > 0) return;

		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (res.ok) {
				const data = await res.json();
				const msgs = (data.messages ?? []).map(toClientMessage);
				setConversations((prev) =>
					prev.map((c) =>
						c.id === id ? { ...c, messages: msgs } : c
					)
				);
			}
		} catch {
			// Silent fail
		}
	}, []);

	const newConversation = useCallback(() => {
		setActiveConversationId(null);
		setError(null);
	}, []);

	const deleteConversation = useCallback(
		async (id: string) => {
			setConversations((prev) => prev.filter((c) => c.id !== id));
			if (activeConversationId === id) {
				setActiveConversationId(null);
			}
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Silent fail
			}
		},
		[activeConversationId]
	);

	const clearAllConversations = useCallback(async () => {
		const ids = conversationsRef.current.map((c) => c.id);
		setConversations([]);
		setActiveConversationId(null);
		// Delete all in background
		for (const id of ids) {
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Continue
			}
		}
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
			let previousMessages: { role: string; content: string }[] = [];
			let dbConvoId: string | null = null;

			if (!convoId) {
				// Create new conversation via API
				const tempId = crypto.randomUUID();
				const newConvo: Conversation = {
					id: tempId,
					title: text.slice(0, 60),
					messages: [userMsg, assistantMsg],
					createdAt: new Date().toISOString(),
				};
				setConversations((prev) => [newConvo, ...prev]);
				setActiveConversationId(tempId);
				convoId = tempId;

				try {
					const res = await fetch("/api/conversations", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: text.slice(0, 60) }),
					});
					if (res.ok) {
						const created = await res.json();
						dbConvoId = created.id;
						// Update local state with real DB id
						setConversations((prev) =>
							prev.map((c) =>
								c.id === tempId ? { ...c, id: created.id } : c
							)
						);
						setActiveConversationId(created.id);
						convoId = created.id;
					}
				} catch {
					// Continue with streaming even if create fails
				}
			} else {
				dbConvoId = convoId;
				// Use ref to get the latest conversations
				const existingConvo = conversationsRef.current.find((c) => c.id === convoId);
				if (existingConvo) {
					previousMessages = existingConvo.messages
						.filter((m) => m.content.trim())
						.map((m) => ({ role: m.role, content: m.content }));
				}

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

			// Build the full history
			const history = [
				...previousMessages,
				{ role: "user", content: text },
			];

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

			// Save user message to DB in background
			if (dbConvoId) {
				fetch(`/api/conversations/${dbConvoId}/messages`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messages: { role: "user", content: text },
					}),
				}).then((res) => {
					if (res.ok) {
						res.json().then((saved) => {
							if (saved?.[0]?.id) {
								// Update the user message ID with the real DB id
								setConversations((prev) =>
									prev.map((c) =>
										c.id === currentConvoId
											? {
													...c,
													messages: c.messages.map((m) =>
														m.id === userMsg.id
															? { ...m, id: saved[0].id }
															: m
													),
												}
											: c
									)
								);
							}
						});
					}
				}).catch(() => {});
			}

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
					body: JSON.stringify({ question: text, history }),
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

					return { cleanContent, followUps };
				});

				const results = await Promise.allSettled([tavilyPromise, bibleAiPromise]);

				let tavilyResults: TavilyResult[] | undefined;
				if (results[0].status === "fulfilled" && results[0].value) {
					tavilyResults = results[0].value;
					updateAssistant((m) => ({ ...m, tavilyResults }));
				}

				if (results[1].status === "rejected") {
					throw results[1].reason;
				}

				// Mark streaming done
				updateAssistant((m) => ({ ...m, isStreaming: false }));

				// Save assistant message to DB
				if (dbConvoId && results[1].status === "fulfilled") {
					const { cleanContent, followUps } = results[1].value;

					// Get the latest assistant message state for metadata
					const latestConvo = conversationsRef.current.find(
						(c) => c.id === currentConvoId
					);
					const latestAssistant = latestConvo?.messages.find(
						(m) => m.id === assistantMsg.id
					);

					const metadata: Record<string, unknown> = {};
					if (tavilyResults) metadata.tavilyResults = tavilyResults;
					if (latestAssistant?.retrievedVerses)
						metadata.retrievedVerses = latestAssistant.retrievedVerses;
					if (latestAssistant?.averageSimilarity !== undefined)
						metadata.averageSimilarity = latestAssistant.averageSimilarity;
					if (followUps.length > 0) metadata.followUps = followUps;

					fetch(`/api/conversations/${dbConvoId}/messages`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							messages: {
								role: "assistant",
								content: cleanContent,
								metadata: Object.keys(metadata).length > 0 ? metadata : null,
							},
						}),
					}).catch(() => {});
				}

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
		initialLoading,
		error,
		sendMessage,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	};
};

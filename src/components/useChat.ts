"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
	buildConversationRequestHistory,
	type ConversationHistoryMessage,
} from "@/utils/chatContext";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
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

interface SourcesMetadata {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}

const HISTORY_LOAD_ERROR =
	"We couldn't load this conversation. Retry to restore its context, or start a new chat.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseSourcesMetadata(value: unknown): SourcesMetadata | undefined {
	if (!isRecord(value) || !Array.isArray(value.verses)) return undefined;

	const verses = value.verses.flatMap((verse): RetrievedVerse[] => {
		if (!isRecord(verse)) return [];
		if (typeof verse.reference !== "string" || typeof verse.similarity !== "number") {
			return [];
		}

		return [{
			reference: verse.reference,
			similarity: verse.similarity,
			...(typeof verse.text === "string" ? { text: verse.text } : {}),
		}];
	});

	return {
		verses,
		averageSimilarity:
			typeof value.averageSimilarity === "number" ? value.averageSimilarity : 0,
	};
}

function parseTavilyResults(value: unknown): TavilyResult[] | undefined {
	if (!Array.isArray(value)) return undefined;

	return value.flatMap((result): TavilyResult[] => {
		if (
			!isRecord(result) ||
			typeof result.title !== "string" ||
			typeof result.content !== "string" ||
			typeof result.url !== "string"
		) {
			return [];
		}

		return [{ title: result.title, content: result.content, url: result.url }];
	});
}

function visibleResponseContent(content: string): string {
	return content.replace(/\r?\n?\[FOLLOWUP\][\s\S]*$/, "").trimEnd();
}

function parseCompletedResponse(content: string): {
	cleanContent: string;
	followUps: string[];
} {
	const followUps: string[] = [];
	const seen = new Set<string>();
	const followUpRegex = /\[FOLLOWUP\]\s*([^\r\n]+)/g;
	let match: RegExpExecArray | null;

	while ((match = followUpRegex.exec(content)) !== null && followUps.length < 2) {
		const question = match[1].trim();
		const normalized = question.toLowerCase();
		if (question && !seen.has(normalized)) {
			seen.add(normalized);
			followUps.push(question);
		}
	}

	return {
		cleanContent: content.replace(/\r?\n?\[FOLLOWUP\][^\r\n]*/g, "").trimEnd(),
		followUps,
	};
}

/** Map a DB message to our client ChatMessage shape */
function toClientMessage(value: unknown): ChatMessage {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.role !== "user" && value.role !== "assistant") ||
		typeof value.content !== "string" ||
		typeof value.createdAt !== "string"
	) {
		throw new Error("Conversation history response contained an invalid message.");
	}

	const timestamp = Date.parse(value.createdAt);
	if (!Number.isFinite(timestamp)) {
		throw new Error("Conversation history response contained an invalid timestamp.");
	}

	const meta = isRecord(value.metadata) ? value.metadata : {};
	const sources = parseSourcesMetadata({
		verses: meta.retrievedVerses,
		averageSimilarity: meta.averageSimilarity,
	});
	const followUps = Array.isArray(meta.followUps)
		? meta.followUps.filter((item): item is string => typeof item === "string")
		: undefined;
	const tavilyResults = parseTavilyResults(meta.tavilyResults);

	return {
		id: value.id,
		role: value.role,
		content: value.content,
		...(tavilyResults ? { tavilyResults } : {}),
		...(sources ? {
			retrievedVerses: sources.verses,
			averageSimilarity: sources.averageSimilarity,
		} : {}),
		...(followUps ? { followUps } : {}),
		timestamp,
	};
}

export const useChat = () => {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [initialLoading, setInitialLoading] = useState(true);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const initialized = useRef(false);
	const conversationsRef = useRef<Conversation[]>([]);
	const historyLoadVersionRef = useRef(0);
	const historyLoadingRef = useRef(false);
	const historyErrorConversationIdRef = useRef<string | null>(null);
	const loadedConversationIdsRef = useRef(new Set<string>());

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
		const loadVersion = ++historyLoadVersionRef.current;
		setActiveConversationId(id);
		setError(null);
		setHistoryError(null);
		historyErrorConversationIdRef.current = null;

		// Check if messages are already loaded
		const existing = conversationsRef.current.find((c) => c.id === id);
		if (loadedConversationIdsRef.current.has(id) || (existing && existing.messages.length > 0)) {
			loadedConversationIdsRef.current.add(id);
			historyLoadingRef.current = false;
			setHistoryLoading(false);
			return;
		}

		historyLoadingRef.current = true;
		setHistoryLoading(true);

		try {
			const res = await fetch(`/api/conversations/${id}`);
			if (!res.ok) {
				throw new Error("Conversation history request failed.");
			}

			const data: unknown = await res.json();
			if (loadVersion !== historyLoadVersionRef.current) return;
			if (!isRecord(data) || !Array.isArray(data.messages)) {
				throw new Error("Conversation history response was invalid.");
			}

			const msgs = data.messages.map(toClientMessage);
			loadedConversationIdsRef.current.add(id);
			setConversations((prev) =>
				prev.map((c) =>
					c.id === id ? { ...c, messages: msgs } : c
				)
			);
		} catch {
			if (loadVersion === historyLoadVersionRef.current) {
				historyErrorConversationIdRef.current = id;
				setHistoryError(HISTORY_LOAD_ERROR);
			}
		} finally {
			if (loadVersion === historyLoadVersionRef.current) {
				historyLoadingRef.current = false;
				setHistoryLoading(false);
			}
		}
	}, []);

	const retryHistory = useCallback(() => {
		if (activeConversationId) {
			void switchConversation(activeConversationId);
		}
	}, [activeConversationId, switchConversation]);

	const newConversation = useCallback(() => {
		historyLoadVersionRef.current += 1;
		historyLoadingRef.current = false;
		historyErrorConversationIdRef.current = null;
		setHistoryLoading(false);
		setHistoryError(null);
		setActiveConversationId(null);
		setError(null);
	}, []);

	const deleteConversation = useCallback(
		async (id: string) => {
			loadedConversationIdsRef.current.delete(id);
			if (activeConversationId === id) {
				historyLoadVersionRef.current += 1;
				historyLoadingRef.current = false;
				historyErrorConversationIdRef.current = null;
				setHistoryLoading(false);
				setHistoryError(null);
			}
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
		historyLoadVersionRef.current += 1;
		historyLoadingRef.current = false;
		historyErrorConversationIdRef.current = null;
		loadedConversationIdsRef.current.clear();
		setHistoryLoading(false);
		setHistoryError(null);
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
			if (
				!text.trim() ||
				historyLoadingRef.current ||
				historyErrorConversationIdRef.current !== null ||
				abortControllerRef.current
			) return;

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
			let previousMessages: ConversationHistoryMessage[] = [];
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

			const history = buildConversationRequestHistory(previousMessages, text);

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
					body: JSON.stringify({ query: text, history }),
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
					let sourcesMetadata: SourcesMetadata | undefined;

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						accumulated += decoder.decode(value, { stream: true });

						if (!sourcesParsed && accumulated.includes("-->")) {
							const markerMatch = accumulated.match(/<!--SOURCES:(.*?)-->/);
							if (markerMatch) {
								try {
									const parsedJson: unknown = JSON.parse(markerMatch[1]);
									const sourcesData = parseSourcesMetadata(parsedJson);
									if (sourcesData) {
										sourcesMetadata = sourcesData;
										updateAssistant((m) => ({
											...m,
											retrievedVerses: sourcesData.verses,
											averageSimilarity: sourcesData.averageSimilarity,
										}));
									}
								} catch {
									// Ignore parse errors
								}
								accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");
								sourcesParsed = true;
							}
						}

						const responseContent = sourcesParsed
							? accumulated
							: accumulated.replace(/<!--SOURCES:.*/, "");
						updateAssistant((m) => ({
							...m,
							content: visibleResponseContent(responseContent),
						}));
					}

					accumulated += decoder.decode();
					accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");

					const { cleanContent, followUps } = parseCompletedResponse(accumulated);

					updateAssistant((m) => ({
						...m,
						content: cleanContent,
						...(followUps.length > 0 ? { followUps } : {}),
					}));

					return { cleanContent, followUps, sourcesMetadata };
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
					const { cleanContent, followUps, sourcesMetadata } = results[1].value;

					const metadata: Record<string, unknown> = {};
					if (tavilyResults) metadata.tavilyResults = tavilyResults;
					if (sourcesMetadata?.verses.length)
						metadata.retrievedVerses = sourcesMetadata.verses;
					if (sourcesMetadata)
						metadata.averageSimilarity = sourcesMetadata.averageSimilarity;
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
				if (abortControllerRef.current === abortController) {
					abortControllerRef.current = null;
				}
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
		historyLoading,
		historyError,
		error,
		sendMessage,
		newConversation,
		switchConversation,
		retryHistory,
		deleteConversation,
		clearAllConversations,
	};
};

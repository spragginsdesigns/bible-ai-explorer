"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SureWordUIMessage } from "@/lib/ai-tools";
import {
	composeMessageWithAttachment,
	type VerseAttachment,
} from "@/lib/chat/verseActions";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

export interface TavilyResult {
	title: string;
	content: string;
	url: string;
}

export interface NoteAction {
	noteId: string;
	noteTitle: string;
	created: boolean;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	tavilyResults?: TavilyResult[];
	retrievedVerses?: RetrievedVerse[];
	averageSimilarity?: number;
	followUps?: string[];
	noteActions?: NoteAction[];
	/** Human-readable label for the tool currently running, e.g. "Searching the Scriptures". */
	activity?: string;
	isStreaming?: boolean;
	timestamp: number;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
}

const HISTORY_LOAD_ERROR =
	"We couldn't load this conversation. Retry to restore its context, or start a new chat.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	"tool-searchScripture": "Searching the Scriptures",
	"tool-getPassage": "Opening the passage",
	"tool-webSearch": "Searching the web",
	"tool-addToNote": "Writing to your note",
	"tool-findNotes": "Looking through your notes",
};

function visibleResponseContent(content: string): string {
	return content.replace(/\r?\n?\[FOLLOWUP\][\s\S]*$/, "").trimEnd();
}

function parseFollowUps(content: string): string[] {
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

	return followUps;
}

function parseVerses(value: unknown): RetrievedVerse[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((verse): RetrievedVerse[] => {
		if (
			!isRecord(verse) ||
			typeof verse.reference !== "string" ||
			typeof verse.similarity !== "number"
		) {
			return [];
		}
		return [{
			reference: verse.reference,
			similarity: verse.similarity,
			...(typeof verse.text === "string" ? { text: verse.text } : {}),
		}];
	});
}

function parseTavilyResults(value: unknown): TavilyResult[] {
	if (!Array.isArray(value)) return [];
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

interface LegacyMessageMetadata {
	retrievedVerses?: unknown;
	averageSimilarity?: unknown;
	tavilyResults?: unknown;
	followUps?: unknown;
}

/**
 * Convert an AI SDK UIMessage (live or restored) into the view model the chat
 * components render. Tool results become verse/web/note cards; [FOLLOWUP]
 * marker lines become chips.
 */
export function toViewMessage(
	message: SureWordUIMessage,
	options: { isStreaming: boolean }
): ChatMessage {
	const legacy = isRecord(message.metadata)
		? (message.metadata as LegacyMessageMetadata)
		: {};

	let text = "";
	const retrievedVerses: RetrievedVerse[] = parseVerses(legacy.retrievedVerses);
	const similarities: number[] = [];
	const tavilyResults: TavilyResult[] = parseTavilyResults(legacy.tavilyResults);
	const noteActions: NoteAction[] = [];
	let activity: string | undefined;

	for (const part of message.parts) {
		if (part.type === "text") {
			text += part.text;
			continue;
		}

		if (!part.type.startsWith("tool-")) continue;
		const toolPart = part as {
			type: string;
			state: string;
			output?: unknown;
		};

		if (toolPart.state === "input-streaming" || toolPart.state === "input-available") {
			activity = TOOL_ACTIVITY_LABELS[toolPart.type] ?? "Working";
			continue;
		}
		if (toolPart.state !== "output-available" || !isRecord(toolPart.output)) continue;

		const output = toolPart.output;
		if (part.type === "tool-searchScripture") {
			const verses = parseVerses(output.verses);
			retrievedVerses.push(...verses);
			similarities.push(...verses.map((verse) => verse.similarity));
		} else if (part.type === "tool-getPassage") {
			retrievedVerses.push(...parseVerses(output.verses));
		} else if (part.type === "tool-webSearch") {
			tavilyResults.push(...parseTavilyResults(output.results));
		} else if (part.type === "tool-addToNote") {
			if (typeof output.noteId === "string" && typeof output.noteTitle === "string") {
				noteActions.push({
					noteId: output.noteId,
					noteTitle: output.noteTitle,
					created: output.created === true,
				});
			}
		}
	}

	const followUps = options.isStreaming
		? parseFollowUps(text)
		: [
				...new Set([
					...parseFollowUps(text),
					...(Array.isArray(legacy.followUps)
						? legacy.followUps.filter((f): f is string => typeof f === "string")
						: []),
				]),
			].slice(0, 2);

	const averageSimilarity =
		typeof legacy.averageSimilarity === "number"
			? legacy.averageSimilarity
			: similarities.length > 0
				? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
				: undefined;

	return {
		id: message.id,
		role: message.role === "user" ? "user" : "assistant",
		content: visibleResponseContent(text),
		...(retrievedVerses.length > 0 ? { retrievedVerses } : {}),
		...(averageSimilarity !== undefined ? { averageSimilarity } : {}),
		...(tavilyResults.length > 0 ? { tavilyResults } : {}),
		...(followUps.length > 0 ? { followUps } : {}),
		...(noteActions.length > 0 ? { noteActions } : {}),
		...(activity && options.isStreaming ? { activity } : {}),
		...(options.isStreaming ? { isStreaming: true } : {}),
		timestamp: Date.now(),
	};
}

/** Map a stored DB message row to a UIMessage for the AI SDK chat state. */
export function dbMessageToUIMessage(value: unknown): SureWordUIMessage {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.role !== "user" && value.role !== "assistant") ||
		typeof value.content !== "string"
	) {
		throw new Error("Conversation history response contained an invalid message.");
	}

	const metadata = isRecord(value.metadata) ? value.metadata : {};
	const parts = Array.isArray(metadata.parts)
		? (metadata.parts as SureWordUIMessage["parts"])
		: [{ type: "text" as const, text: value.content }];

	const { parts: _ignored, ...legacyMetadata } = metadata;

	return {
		id: value.id,
		role: value.role,
		parts,
		...(Object.keys(legacyMetadata).length > 0 ? { metadata: legacyMetadata } : {}),
	};
}

export const useChat = () => {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [initialLoading, setInitialLoading] = useState(true);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [attachment, setAttachmentState] = useState<VerseAttachment | null>(null);
	const setAttachment = useCallback(
		(next: VerseAttachment) => setAttachmentState(next),
		[]
	);
	const clearAttachment = useCallback(() => setAttachmentState(null), []);
	const initialized = useRef(false);
	const conversationIdRef = useRef<string | null>(null);
	const historyLoadVersionRef = useRef(0);
	const historyLoadingRef = useRef(false);
	const historyErrorRef = useRef(false);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<SureWordUIMessage>({
				api: "/api/ask-question",
				prepareSendMessagesRequest: ({ messages }) => ({
					body: {
						messages,
						conversationId: conversationIdRef.current,
					},
				}),
			}),
		[]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		stop,
		status,
		error: chatError,
	} = useAIChat<SureWordUIMessage>({ transport });

	// Load conversation list on mount
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

	const switchConversation = useCallback(
		async (id: string) => {
			if (id === conversationIdRef.current) return;
			const loadVersion = ++historyLoadVersionRef.current;

			stop();
			setActiveConversationId(id);
			conversationIdRef.current = id;
			setSendError(null);
			setHistoryError(null);
			historyErrorRef.current = false;
			historyLoadingRef.current = true;
			setHistoryLoading(true);
			setUIMessages([]);

			try {
				const res = await fetch(`/api/conversations/${id}`);
				if (!res.ok) throw new Error("Conversation history request failed.");

				const data: unknown = await res.json();
				if (loadVersion !== historyLoadVersionRef.current) return;
				if (!isRecord(data) || !Array.isArray(data.messages)) {
					throw new Error("Conversation history response was invalid.");
				}

				setUIMessages(data.messages.map(dbMessageToUIMessage));
			} catch {
				if (loadVersion === historyLoadVersionRef.current) {
					historyErrorRef.current = true;
					setHistoryError(HISTORY_LOAD_ERROR);
				}
			} finally {
				if (loadVersion === historyLoadVersionRef.current) {
					historyLoadingRef.current = false;
					setHistoryLoading(false);
				}
			}
		},
		[stop, setUIMessages]
	);

	const retryHistory = useCallback(() => {
		const id = conversationIdRef.current;
		if (id) {
			conversationIdRef.current = null;
			void switchConversation(id);
		}
	}, [switchConversation]);

	const newConversation = useCallback(() => {
		historyLoadVersionRef.current += 1;
		historyLoadingRef.current = false;
		historyErrorRef.current = false;
		stop();
		setHistoryLoading(false);
		setHistoryError(null);
		setActiveConversationId(null);
		conversationIdRef.current = null;
		setSendError(null);
		setUIMessages([]);
	}, [stop, setUIMessages]);

	const deleteConversation = useCallback(
		async (id: string) => {
			setConversations((prev) => prev.filter((c) => c.id !== id));
			if (conversationIdRef.current === id) {
				newConversation();
			}
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Silent fail
			}
		},
		[newConversation]
	);

	const clearAllConversations = useCallback(async () => {
		const ids = conversations.map((c) => c.id);
		setConversations([]);
		newConversation();
		for (const id of ids) {
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Continue
			}
		}
	}, [conversations, newConversation]);

	const sendMessage = useCallback(
		async (text: string) => {
			const composed = composeMessageWithAttachment(text, attachment);
			if (
				!composed ||
				historyLoadingRef.current ||
				historyErrorRef.current ||
				status === "submitted" ||
				status === "streaming"
			) {
				return;
			}

			setSendError(null);

			// Create the conversation first so the server can persist the exchange.
			if (!conversationIdRef.current) {
				try {
					const res = await fetch("/api/conversations", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: composed.slice(0, 60) }),
					});
					if (res.ok) {
						const created = await res.json();
						conversationIdRef.current = created.id;
						setActiveConversationId(created.id);
						setConversations((prev) => [
							{
								id: created.id,
								title: composed.slice(0, 60),
								createdAt: new Date().toISOString(),
							},
							...prev,
						]);
					}
				} catch {
					// Continue without persistence if conversation creation fails
				}
			}

			setAttachmentState(null);
			void sendUIMessage({ text: composed });
		},
		[attachment, sendUIMessage, status]
	);

	const isStreaming = status === "streaming";
	const loading = status === "submitted";

	const messages = useMemo(() => {
		const lastAssistantId = [...uiMessages]
			.reverse()
			.find((message) => message.role === "assistant")?.id;

		const viewMessages = uiMessages.map((message) =>
			toViewMessage(message, {
				isStreaming:
					(isStreaming || loading) &&
					message.role === "assistant" &&
					message.id === lastAssistantId,
			})
		);

		// While waiting for the stream to start there is no assistant message
		// yet; show a typing indicator in its place.
		if (loading && viewMessages.at(-1)?.role === "user") {
			viewMessages.push({
				id: "pending-assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
				timestamp: Date.now(),
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, loading]);

	const activeConversation =
		conversations.find((c) => c.id === activeConversationId) ?? null;

	const error = sendError ?? (chatError ? chatError.message : null);

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
		input,
		setInput,
		attachment,
		setAttachment,
		clearAttachment,
		sendMessage,
		newConversation,
		switchConversation,
		retryHistory,
		deleteConversation,
		clearAllConversations,
	};
};

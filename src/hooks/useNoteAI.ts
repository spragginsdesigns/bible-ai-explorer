"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SureWordUIMessage } from "@/lib/ai-tools";
import {
	isRenderableChatMessage,
	streamingAssistantId,
} from "@/lib/chat/message-display";
import {
	dbMessageToUIMessage,
	toViewMessage,
	type ChatMessage,
} from "@/components/useChat";
import {
	classifyChatError,
	type ClassifiedChatError,
} from "@/lib/chat/chatErrors";

export interface NoteAppendEvent {
	noteId: string;
	appendedHtml: string;
}

function collectAddToNoteCalls(
	messages: SureWordUIMessage[]
): Array<{ toolCallId: string; noteId: string; appendedHtml: string }> {
	const calls: Array<{ toolCallId: string; noteId: string; appendedHtml: string }> = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type !== "tool-addToNote" || part.state !== "output-available") continue;
			const output = part.output as { noteId?: unknown; appendedHtml?: unknown };
			if (typeof output?.noteId === "string" && typeof output?.appendedHtml === "string") {
				calls.push({
					toolCallId: part.toolCallId,
					noteId: output.noteId,
					appendedHtml: output.appendedHtml,
				});
			}
		}
	}
	return calls;
}

export function useNoteAI(
	noteId: string,
	options?: { onNoteAppended?: (event: NoteAppendEvent) => void }
) {
	const [historyLoading, setHistoryLoading] = useState(false);
	const [clearError, setClearError] = useState<ClassifiedChatError | null>(null);
	const noteIdRef = useRef(noteId);
	noteIdRef.current = noteId;
	const loadedNoteIdRef = useRef<string | null>(null);
	const appliedToolCallsRef = useRef(new Set<string>());
	const onNoteAppendedRef = useRef(options?.onNoteAppended);
	onNoteAppendedRef.current = options?.onNoteAppended;

	const transport = useMemo(
		() =>
			new DefaultChatTransport<SureWordUIMessage>({
				api: "/api/note-ai",
				prepareSendMessagesRequest: ({ messages }) => ({
					body: {
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						messages,
						noteId: noteIdRef.current,
					},
				}),
			}),
		[]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		regenerate,
		clearError: clearChatError,
		stop,
		status,
		error: chatError,
	} = useAIChat<SureWordUIMessage>({ transport, throttle: 50 });

	// Load persisted AI messages when the note changes
	useEffect(() => {
		if (!noteId || loadedNoteIdRef.current === noteId) return;
		loadedNoteIdRef.current = noteId;
		stop();
		setUIMessages([]);
		setClearError(null);
		clearChatError();
		setHistoryLoading(true);

		(async () => {
			try {
				const res = await fetch(`/api/notes/${noteId}/ai-messages`);
				if (!res.ok) return;
				const data: unknown = await res.json();
				if (!Array.isArray(data) || loadedNoteIdRef.current !== noteId) return;

				const restored = data.map(dbMessageToUIMessage);
				// Past addToNote results are already part of the stored note;
				// mark them applied so they never re-insert into the editor.
				for (const call of collectAddToNoteCalls(restored)) {
					appliedToolCallsRef.current.add(call.toolCallId);
				}
				setUIMessages(restored);
			} catch {
				// Silent fail
			} finally {
				if (loadedNoteIdRef.current === noteId) setHistoryLoading(false);
			}
		})();
	}, [noteId, stop, setUIMessages, clearChatError]);

	// Apply live addToNote results to the open editor exactly once each
	useEffect(() => {
		for (const call of collectAddToNoteCalls(uiMessages)) {
			if (appliedToolCallsRef.current.has(call.toolCallId)) continue;
			appliedToolCallsRef.current.add(call.toolCallId);
			onNoteAppendedRef.current?.({
				noteId: call.noteId,
				appendedHtml: call.appendedHtml,
			});
		}
	}, [uiMessages]);

	const sendMessage = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (!trimmed || status === "submitted" || status === "streaming") return;
			void sendUIMessage({ text: trimmed });
		},
		[sendUIMessage, status]
	);

	// Clear the server copy first: wiping local state before the DELETE would
	// leave a failed clear looking like a fresh conversation.
	const clearHistory = useCallback(async () => {
		try {
			const res = await fetch(`/api/notes/${noteIdRef.current}/ai-messages`, { method: "DELETE" });
			if (!res.ok) {
				const bodyText = await res.text().catch(() => undefined);
				const classified = classifyChatError({ status: res.status, bodyText });
				setClearError({
					...classified,
					title: "Couldn't clear the conversation",
					retryable: true,
				});
				return;
			}
		} catch {
			setClearError({
				...classifyChatError({ isNetworkError: true }),
				title: "Couldn't clear the conversation",
				retryable: true,
			});
			return;
		}
		setClearError(null);
		stop();
		setUIMessages([]);
		appliedToolCallsRef.current.clear();
	}, [stop, setUIMessages]);

	// A failed clear re-runs the DELETE; a failed send regenerates the last exchange.
	const retry = useCallback(() => {
		if (clearError) {
			void clearHistory();
			return;
		}
		clearChatError();
		void regenerate();
	}, [clearError, clearHistory, clearChatError, regenerate]);

	const isStreaming = status === "streaming";
	const loading = status === "submitted" || historyLoading;

	const messages: ChatMessage[] = useMemo(() => {
		const busy = isStreaming || status === "submitted";
		const activeAssistantId = streamingAssistantId(uiMessages, busy);

		const viewMessages = uiMessages.map((message) =>
			toViewMessage(message, {
				isStreaming:
					busy &&
					message.role === "assistant" &&
					message.id === activeAssistantId,
			})
		).filter(isRenderableChatMessage);

		if (status === "submitted" && viewMessages.at(-1)?.role === "user") {
			viewMessages.push({
				id: "pending-assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
				timestamp: Date.now(),
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, status]);

	// The transport throws pre-stream HTTP failures with the raw response body
	// as the message and mid-stream chunks as "[code] message" - the classifier
	// unpacks both shapes.
	const error: ClassifiedChatError | null =
		clearError ?? (chatError ? classifyChatError({ message: chatError.message }) : null);

	return {
		messages,
		isStreaming,
		loading,
		error,
		sendMessage,
		clearHistory,
		retry,
	};
}

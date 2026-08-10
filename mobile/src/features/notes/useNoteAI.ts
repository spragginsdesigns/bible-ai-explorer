import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { API_URL, makeAuthedFetch } from "@/lib/api";
import { dbMessageToUIMessage, toViewMessage, type ChatViewMessage } from "@/lib/chatView";
import * as api from "./api";
import { useStableGetToken } from "./useStableGetToken";

export interface NoteAppendEvent {
	noteId: string;
	appendedHtml: string;
}

interface AddToNoteCall {
	toolCallId: string;
	noteId: string;
	appendedHtml: string;
}

function collectAddToNoteCalls(messages: UIMessage[]): AddToNoteCall[] {
	const calls: AddToNoteCall[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (!part.type.startsWith("tool-")) continue;
			const toolPart = part as unknown as {
				type: string;
				state: string;
				toolCallId: string;
				output?: { noteId?: unknown; appendedHtml?: unknown };
			};
			if (toolPart.type !== "tool-addToNote" || toolPart.state !== "output-available") continue;
			const output = toolPart.output;
			if (typeof output?.noteId === "string" && typeof output?.appendedHtml === "string") {
				calls.push({
					toolCallId: toolPart.toolCallId,
					noteId: output.noteId,
					appendedHtml: output.appendedHtml,
				});
			}
		}
	}
	return calls;
}

/**
 * Per-note AI chat, ported from the web useNoteAI hook. The transport must use
 * the expo/fetch-backed authed fetch or the UIMessage stream never arrives on
 * native.
 */
export function useNoteAI(
	noteId: string,
	options?: { onNoteAppended?: (event: NoteAppendEvent) => void }
) {
	const getToken = useStableGetToken();
	const [historyLoading, setHistoryLoading] = useState(false);
	const [clearError, setClearError] = useState<string | null>(null);

	const noteIdRef = useRef(noteId);
	noteIdRef.current = noteId;
	const loadedNoteIdRef = useRef<string | null>(null);
	const appliedToolCallsRef = useRef(new Set<string>());
	const onNoteAppendedRef = useRef(options?.onNoteAppended);
	onNoteAppendedRef.current = options?.onNoteAppended;

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: `${API_URL}/api/note-ai`,
				fetch: makeAuthedFetch(getToken) as unknown as typeof globalThis.fetch,
				prepareSendMessagesRequest: ({ messages }) => ({
					body: { messages, noteId: noteIdRef.current },
				}),
			}),
		[getToken]
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
	} = useChat<UIMessage>({ transport });

	// Restore the persisted conversation whenever the note changes.
	useEffect(() => {
		if (!noteId || loadedNoteIdRef.current === noteId) return;
		loadedNoteIdRef.current = noteId;
		stop();
		setUIMessages([]);
		setHistoryLoading(true);

		(async () => {
			try {
				const rows = await api.fetchNoteAIMessages(getToken, noteId);
				if (!Array.isArray(rows) || loadedNoteIdRef.current !== noteId) return;
				const restored = rows.map(dbMessageToUIMessage);
				// Past appends are already part of the stored note; mark them applied
				// so restoring history never re-inserts them into the editor.
				for (const call of collectAddToNoteCalls(restored)) {
					appliedToolCallsRef.current.add(call.toolCallId);
				}
				setUIMessages(restored);
			} catch {
				// An unreadable history should not block a new conversation.
			} finally {
				if (loadedNoteIdRef.current === noteId) setHistoryLoading(false);
			}
		})();
	}, [getToken, noteId, stop, setUIMessages]);

	// Fire each live append exactly once.
	useEffect(() => {
		for (const call of collectAddToNoteCalls(uiMessages)) {
			if (appliedToolCallsRef.current.has(call.toolCallId)) continue;
			appliedToolCallsRef.current.add(call.toolCallId);
			onNoteAppendedRef.current?.({ noteId: call.noteId, appendedHtml: call.appendedHtml });
		}
	}, [uiMessages]);

	const isStreaming = status === "streaming";
	const loading = status === "submitted" || historyLoading;

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
			await api.clearNoteAIMessages(getToken, noteIdRef.current);
		} catch (err) {
			setClearError(
				err instanceof Error ? err.message : "The conversation could not be cleared."
			);
			return;
		}
		setClearError(null);
		stop();
		setUIMessages([]);
		appliedToolCallsRef.current.clear();
	}, [getToken, stop, setUIMessages]);

	const retry = useCallback(() => {
		setClearError(null);
		clearChatError();
		void regenerate();
	}, [clearChatError, regenerate]);

	const messages: ChatViewMessage[] = useMemo(() => {
		const lastAssistantId = [...uiMessages]
			.reverse()
			.find((message) => message.role === "assistant")?.id;

		const viewMessages = uiMessages.map((message) =>
			toViewMessage(message, {
				isStreaming:
					(isStreaming || status === "submitted") &&
					message.role === "assistant" &&
					message.id === lastAssistantId,
			})
		);

		if (status === "submitted" && viewMessages.at(-1)?.role === "user") {
			viewMessages.push({
				id: "pending-assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, status]);

	return {
		messages,
		isStreaming,
		loading,
		error: clearError ?? (chatError ? chatError.message : null),
		sendMessage,
		clearHistory,
		retry,
	};
}

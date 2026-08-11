"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SureWordUIMessage } from "@/lib/ai-tools";
import {
	dbMessageToUIMessage,
	toViewMessage,
	type ChatMessage,
} from "@/components/useChat";

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
		stop,
		status,
	} = useAIChat<SureWordUIMessage>({ transport });

	// Load persisted AI messages when the note changes
	useEffect(() => {
		if (!noteId || loadedNoteIdRef.current === noteId) return;
		loadedNoteIdRef.current = noteId;
		stop();
		setUIMessages([]);
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
	}, [noteId, stop, setUIMessages]);

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

	const clearHistory = useCallback(async () => {
		stop();
		setUIMessages([]);
		await fetch(`/api/notes/${noteIdRef.current}/ai-messages`, { method: "DELETE" });
	}, [stop, setUIMessages]);

	const isStreaming = status === "streaming";
	const loading = status === "submitted" || historyLoading;

	const messages: ChatMessage[] = useMemo(() => {
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
				timestamp: Date.now(),
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, status]);

	return {
		messages,
		isStreaming,
		loading,
		sendMessage,
		clearHistory,
	};
}

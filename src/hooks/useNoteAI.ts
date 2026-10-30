"use client";
import { consentFetch } from "@/lib/ai-consent-gate";


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

import { userForNoteReply, type NoteAIOperationController } from "@/lib/notes/note-ai-operation";

export function useNoteAI(
	noteId: string,
	operation: NoteAIOperationController
) {
	const [historyLoading, setHistoryLoading] = useState(false);
	const [clearError, setClearError] = useState<ClassifiedChatError | null>(null);
	const noteIdRef = useRef(noteId);
	noteIdRef.current = noteId;
	const loadedNoteIdRef = useRef<string | null>(null);
	const ownerRef = useRef(operation); ownerRef.current = operation;
	const loadedOwner = useRef<NoteAIOperationController | null>(null);
	const generation = useRef(0);
	const reload = useRef<() => Promise<void>>(async () => {});
	const submissions = useRef(new Map<string, { owner: NoteAIOperationController; finish: (accepted: boolean) => void }>());
	const accept = useCallback((id: string | undefined, accepted: boolean) => { if (!id) return; const pending = submissions.current.get(id); submissions.current.delete(id); pending?.finish(accepted); }, []);
	const runs = useRef(new Map<string, { owner: NoteAIOperationController; id: string }>());

	const transport = useMemo(
		() =>
			new DefaultChatTransport<SureWordUIMessage>({
				api: "/api/note-ai",
                fetch: async (input, init) => {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					const user = (body.messages as SureWordUIMessage[] | undefined)?.findLast(message => message.role === "user");
					const owner = user ? submissions.current.get(user.id)?.owner : undefined;
					if (!owner || owner !== ownerRef.current || !owner.isCurrent()) { accept(user?.id, false); throw new Error("The note or reading account changed before sending."); }
					let request;
					try { request = await owner.begin(body); } catch (error) { accept(user?.id, false); throw error; }
					if (user) runs.current.set(user.id, { owner, id: request.operationId });
					if (!owner.isCurrent()) { accept(user?.id, false); throw new Error("The reading account changed."); }
					try {
						const response = await consentFetch(input, { ...init, body: JSON.stringify(request) });
						accept(user?.id, response.ok && owner.isCurrent());
						if (!response.ok) await owner.recover(request.operationId);
						return response;
					} catch (error) { accept(user?.id, false); await owner.recover(request.operationId); throw error; }
				},
				prepareSendMessagesRequest: ({ messages }) => ({
					body: {
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						messages,
						noteId: noteIdRef.current,
					},
				}),
			}),
		[accept]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		clearError: clearChatError,
		stop,
		status,
		error: chatError,
	} = useAIChat<SureWordUIMessage>({ transport, throttle: 50,
		onFinish: async ({ message, messages }) => {
			const userId = userForNoteReply(messages, message.id);
			const run = userId ? runs.current.get(userId) : undefined;
			if (!run) return;
			const current = generation.current;
			const settled = await run.owner.recover(run.id);
			runs.current.delete(userId!);
			if (settled && run.owner === ownerRef.current && current === generation.current) await reload.current();
		},
	});
	const reloadHistory = useCallback(async () => {
		const owner = ownerRef.current, current = generation.current, id = noteIdRef.current;
		try {
			if (!owner.isCurrent()) return;
			const response = await consentFetch(`/api/notes/${id}/ai-messages`, { cache: "no-store" });
			if (!response.ok) return;
			const rows: unknown = await response.json();
			if (owner.isCurrent() && owner === ownerRef.current && current === generation.current && Array.isArray(rows)) setUIMessages(rows.map(dbMessageToUIMessage));
		} catch { /* Keep the current history; never replay an uncertain write. */ }
	}, [setUIMessages]);
	reload.current = reloadHistory;

	// Load persisted AI messages when the note changes
	useEffect(() => {
		if (!noteId || (loadedNoteIdRef.current === noteId && loadedOwner.current === operation)) return;
		loadedNoteIdRef.current = noteId; loadedOwner.current = operation;
		const owner = operation, current = ++generation.current;
		stop();
		setUIMessages([]);
		setClearError(null);
		clearChatError();
		setHistoryLoading(true);

		(async () => {
			try {
				const res = await consentFetch(`/api/notes/${noteId}/ai-messages`);
				if (!res.ok) return;
				const data: unknown = await res.json();
				if (!Array.isArray(data) || loadedNoteIdRef.current !== noteId || ownerRef.current !== owner || !owner.isCurrent() || generation.current !== current) return;

				const restored = data.map(dbMessageToUIMessage);
				setUIMessages(restored);
			} catch {
				// Silent fail
			} finally {
				if (loadedNoteIdRef.current === noteId) setHistoryLoading(false);
			}
		})();
	}, [noteId, operation, stop, setUIMessages, clearChatError]);

	useEffect(() => { const pending = submissions.current; return () => { void stop(); for (const submission of pending.values()) submission.finish(false); pending.clear(); }; }, [stop]);

	const sendMessage = useCallback(
		(text: string) => {
			const trimmed = text.trim(), owner = ownerRef.current;
			if (!trimmed || !owner.canEdit() || status === "submitted" || status === "streaming") return Promise.resolve(false);
			generation.current += 1;
			const id = crypto.randomUUID();
			const accepted = new Promise<boolean>(resolve => submissions.current.set(id, { owner, finish: resolve }));
			void sendUIMessage({ id, role: "user", parts: [{ type: "text", text: trimmed }] })
				.catch(() => accept(id, false)).finally(() => accept(id, false));
			return accepted;
		},
		[sendUIMessage, status, accept]
	);

	// Clear the server copy first: wiping local state before the DELETE would
	// leave a failed clear looking like a fresh conversation.
	const clearHistory = useCallback(async () => {
		const owner = ownerRef.current, current = ++generation.current, id = noteIdRef.current;
		try {
			if (!await owner.recover() || !owner.isCurrent() || ownerRef.current !== owner || generation.current !== current) return;
			const res = await consentFetch(`/api/notes/${id}/ai-messages`, { method: "DELETE" });
			if (!owner.isCurrent() || ownerRef.current !== owner || generation.current !== current) return;
			if (!res.ok) {
				const bodyText = await res.text().catch(() => undefined);
				if (!owner.isCurrent() || ownerRef.current !== owner || generation.current !== current) return;
				const classified = classifyChatError({ status: res.status, bodyText });
				setClearError({
					...classified,
					title: "Couldn't clear the conversation",
					retryable: true,
				});
				return;
			}
		} catch {
			if (!owner.isCurrent() || ownerRef.current !== owner || generation.current !== current) return;
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
		return true;
	}, [stop, setUIMessages]);

	// A failed clear may repeat its DELETE. An uncertain AI request only recovers.
	const retry = useCallback(() => {
		if (clearError) {
			void clearHistory();
			return;
		}
		clearChatError();
		void (async () => { const owner = ownerRef.current, current = generation.current; if (await owner.recover() && owner === ownerRef.current && current === generation.current) await reload.current(); })();
	}, [clearError, clearHistory, clearChatError]);

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
		stop,
		reloadHistory,
		clearHistory,
		retry,
	};
}

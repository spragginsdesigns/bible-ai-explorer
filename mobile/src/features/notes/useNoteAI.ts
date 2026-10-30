import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { randomUUID } from "expo-crypto";
import { DefaultChatTransport, type UIMessage } from "ai";
import { API_URL, makeAuthedFetch } from "@/lib/api";
import {
	dbMessageToUIMessage,
	isRenderableChatViewMessage,
	streamingAssistantId,
	toViewMessage,
	type ChatViewMessage,
} from "@/lib/chatView";
import * as api from "./api";
import { userForNoteReply, type NoteAIOperationController } from "./noteAIOperation";
import { useStableGetToken } from "./useStableGetToken";

/**
 * Per-note AI chat, ported from the web useNoteAI hook. The transport must use
 * the expo/fetch-backed authed fetch or the UIMessage stream never arrives on
 * native.
 */
export function useNoteAI(
	noteId: string,
	operation: NoteAIOperationController
) {
	const rawToken = useStableGetToken();
	const operationOwner = useRef(operation);
	operationOwner.current = operation;
	const getToken = useCallback(async (flags?: { fresh?: boolean }) => {
		const owner = operationOwner.current;
		if (!owner.isCurrent()) throw new Error("The note changed.");
		const token = await rawToken(flags);
		if (!owner.isCurrent() || operationOwner.current !== owner) throw new Error("The reading account changed.");
		return token;
	}, [rawToken]);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [clearError, setClearError] = useState<string | null>(null);

	const noteIdRef = useRef(noteId);
	noteIdRef.current = noteId;
	const loadedNoteIdRef = useRef<string | null>(null);
	const loadedOwner = useRef<NoteAIOperationController | null>(null);
	const chatGeneration = useRef(0);
	const reload = useRef<() => Promise<void>>(async () => {});
	const submissions = useRef(new Map<string, { owner: NoteAIOperationController; finish: (accepted: boolean) => void }>());
	const accept = useCallback((id: string | undefined, accepted: boolean) => { if (!id) return; const pending = submissions.current.get(id); submissions.current.delete(id); pending?.finish(accepted); }, []);
	const runs = useRef(new Map<string, { owner: NoteAIOperationController; id: string }>());
	const operationRef = useRef(operation);
	operationRef.current = operation;

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: `${API_URL}/api/note-ai`,
				fetch: (async (input, init) => {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					const user = (body.messages as UIMessage[] | undefined)?.findLast(message => message.role === "user");
					const owner = user ? submissions.current.get(user.id)?.owner : undefined;
					if (!owner || owner !== operationRef.current || !owner.isCurrent()) { accept(user?.id, false); throw new Error("The note or reading account changed before sending."); }
					let request;
					try { request = await owner.begin(body); } catch (error) { accept(user?.id, false); throw error; }
					if (user) runs.current.set(user.id, { owner, id: request.operationId });
					if (!owner.isCurrent()) { accept(user?.id, false); throw new Error("The note changed."); }
					try {
						const response = await makeAuthedFetch(async flags => {
							if (!owner.isCurrent()) throw new Error("The note changed.");
							const token = await getToken(flags);
							if (!owner.isCurrent()) throw new Error("The reading account changed.");
							return token;
						})(String(input), { ...init, body: JSON.stringify(request) });
						accept(user?.id, response.ok && owner.isCurrent() && operationRef.current === owner);
						if (!response.ok) await owner.recover(request.operationId);
						return response;
					} catch (error) { accept(user?.id, false); await owner.recover(request.operationId); throw error; }
				}) as typeof globalThis.fetch,
				prepareSendMessagesRequest: ({ messages }) => ({
					body: { messages, noteId: noteIdRef.current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
				}),
			}),
		[getToken, accept]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		clearError: clearChatError,
		stop,
		status,
		error: chatError,
	} = useChat<UIMessage>({ transport, throttle: 50,
		onFinish: async ({ message, messages }) => {
			const userId = userForNoteReply(messages, message.id);
			const run = userId ? runs.current.get(userId) : undefined;
			if (run) {
				const generation = chatGeneration.current;
				const reconciled = await run.owner.recover(run.id);
				runs.current.delete(userId!);
				if (reconciled && run.owner === operationRef.current && generation === chatGeneration.current) await reload.current();
			}
		},
	});

	const reloadHistory = useCallback(async () => {
		const owner = operationRef.current;
		const generation = chatGeneration.current;
		try {
			const rows = await api.fetchNoteAIMessages(getToken, noteIdRef.current);
			if (owner.isCurrent() && owner === operationRef.current && generation === chatGeneration.current && Array.isArray(rows)) setUIMessages(rows.map(dbMessageToUIMessage));
		} catch { /* Keep the current history and its error; never retry a write. */ }
	}, [getToken, setUIMessages]);
	reload.current = reloadHistory;

	// Restore the persisted conversation whenever the note changes.
	useEffect(() => {
		if (!noteId || (loadedNoteIdRef.current === noteId && loadedOwner.current === operation)) return;
		loadedNoteIdRef.current = noteId;
		loadedOwner.current = operation;
		const owner = operation;
		const generation = ++chatGeneration.current;
		stop();
		setUIMessages([]);
		setHistoryLoading(true);

		(async () => {
			try {
				const rows = await api.fetchNoteAIMessages(getToken, noteId);
				if (!Array.isArray(rows) || loadedNoteIdRef.current !== noteId || !owner.isCurrent() || operationRef.current !== owner || generation !== chatGeneration.current) return;
				const restored = rows.map(dbMessageToUIMessage);
				setUIMessages(restored);
			} catch {
				// An unreadable history should not block a new conversation.
			} finally {
				if (loadedNoteIdRef.current === noteId) setHistoryLoading(false);
			}
		})();
	}, [getToken, noteId, operation, stop, setUIMessages]);


	useEffect(() => { const pending = submissions.current; return () => { void stop(); for (const submission of pending.values()) submission.finish(false); pending.clear(); }; }, [stop]);

	const isStreaming = status === "streaming";
	const loading = status === "submitted" || historyLoading;

	const sendMessage = useCallback(
		(text: string) => {
			const trimmed = text.trim(), owner = operationRef.current;
			if (!trimmed || !owner.canEdit() || status === "submitted" || status === "streaming") return Promise.resolve(false);
			chatGeneration.current += 1;
			const id = randomUUID();
			const accepted = new Promise<boolean>(finish => submissions.current.set(id, { owner, finish }));
			void sendUIMessage({ id, role: "user", parts: [{ type: "text", text: trimmed }] })
				.catch(() => accept(id, false)).finally(() => accept(id, false));
			return accepted;
		},
		[sendUIMessage, status, accept]
	);

	// Clear the server copy first: wiping local state before the DELETE would
	// leave a failed clear looking like a fresh conversation.
	const clearHistory = useCallback(async () => {
		const generation = ++chatGeneration.current;
		const owner = operationRef.current;
		const note = noteIdRef.current;
		try {
			if (!await owner.recover() || !owner.isCurrent() || operationRef.current !== owner || generation !== chatGeneration.current) return;
			await api.clearNoteAIMessages(async flags => {
				if (!owner.isCurrent() || operationRef.current !== owner) throw new Error("The reading account changed.");
				const token = await getToken(flags);
				if (!owner.isCurrent() || operationRef.current !== owner) throw new Error("The reading account changed.");
				return token;
			}, note);
			if (!owner.isCurrent() || operationRef.current !== owner || generation !== chatGeneration.current) return;
		} catch (err) {
			setClearError(
				err instanceof Error ? err.message : "The conversation could not be cleared."
			);
			return;
		}
		setClearError(null);
		stop();
		setUIMessages([]);
		return true;
	}, [getToken, stop, setUIMessages]);

	const retry = useCallback(() => {
		setClearError(null);
		clearChatError();
		void (async () => { const owner = operationRef.current; const generation = chatGeneration.current; if (await owner.recover() && owner === operationRef.current && generation === chatGeneration.current) await reload.current(); })();
	}, [clearChatError]);

	const messages: ChatViewMessage[] = useMemo(() => {
		const busy = isStreaming || status === "submitted";
		const activeAssistantId = streamingAssistantId(uiMessages, busy);

		const viewMessages = uiMessages.map((message) =>
			toViewMessage(message, {
				isStreaming:
					busy &&
					message.role === "assistant" &&
					message.id === activeAssistantId,
			})
		).filter(isRenderableChatViewMessage);

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
		stop,
		reloadHistory,
		clearHistory,
		retry,
	};
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useAuth } from "@clerk/expo";
import { API_URL, apiJson, makeAuthedFetch, type GetToken } from "@/lib/api";
import { dbMessageToUIMessage, toViewMessage, type ChatViewMessage } from "@/lib/chatView";
import { composeMessageWithAttachment, type VerseAttachment } from "./verseActions";

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
}

export interface VerseMindChat {
	messages: ChatViewMessage[];
	conversations: Conversation[];
	activeConversationId: string | null;
	activeConversation: Conversation | null;
	isStreaming: boolean;
	loading: boolean;
	initialLoading: boolean;
	historyLoading: boolean;
	historyError: string | null;
	error: string | null;
	/** Draft text of the chat input, so screens can prefill it (e.g. ?prompt=). */
	input: string;
	setInput: (text: string) => void;
	/** Verse/chapter context attached to the next outgoing message. */
	attachment: VerseAttachment | null;
	setAttachment: (attachment: VerseAttachment) => void;
	clearAttachment: () => void;
	sendMessage: (text: string) => Promise<void>;
	stop: () => void;
	retrySend: () => void;
	retryHistory: () => void;
	newConversation: () => void;
	switchConversation: (id: string) => Promise<void>;
	deleteConversation: (id: string) => Promise<void>;
	clearAllConversations: () => Promise<void>;
}

const HISTORY_LOAD_ERROR =
	"We couldn't load this conversation. Retry to restore its context, or start a new chat.";

/**
 * The AI SDK's FetchFunction is not re-exported from `ai`, and expo/fetch's
 * Response is structurally narrower than the DOM one. Borrow the transport's
 * own parameter type so the cast stays contained to a single line.
 */
type TransportInit = NonNullable<ConstructorParameters<typeof DefaultChatTransport<UIMessage>>[0]>;
type TransportFetch = NonNullable<TransportInit["fetch"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Native port of the web client's useChat hook (src/components/useChat.ts):
 * conversation list + persistence, history restore, and the AI SDK stream
 * mapped into the ChatViewMessage render model.
 */
export function useVerseMindChat(): VerseMindChat {
	const { getToken } = useAuth();
	const getTokenRef = useRef(getToken);
	useEffect(() => {
		getTokenRef.current = getToken;
	}, [getToken]);
	// Stable indirection: Clerk hands back a new getToken on every render.
	// `{ fresh: true }` skips the token cache (API layer's 401 retry).
	const authToken = useCallback<GetToken>(
		(opts) => getTokenRef.current(opts?.fresh ? { skipCache: true } : undefined),
		[]
	);

	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [initialLoading, setInitialLoading] = useState(true);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [attachment, setAttachmentState] = useState<VerseAttachment | null>(null);
	const setAttachment = useCallback((next: VerseAttachment) => setAttachmentState(next), []);
	const clearAttachment = useCallback(() => setAttachmentState(null), []);

	const initialized = useRef(false);
	const conversationIdRef = useRef<string | null>(null);
	const historyLoadVersionRef = useRef(0);
	const historyLoadingRef = useRef(false);
	const historyErrorRef = useRef(false);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: `${API_URL}/api/ask-question`,
				fetch: makeAuthedFetch(authToken) as unknown as TransportFetch,
				prepareSendMessagesRequest: ({ messages }) => ({
					body: { messages, conversationId: conversationIdRef.current },
				}),
			}),
		[authToken]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		regenerate,
		clearError,
		stop,
		status,
		error: chatError,
	} = useAIChat<UIMessage>({ transport, experimental_throttle: 50 });

	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		void (async () => {
			try {
				const data = await apiJson<Conversation[]>(authToken, "/api/conversations");
				setConversations(
					data.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }))
				);
			} catch {
				// Non-fatal: chatting still works without the history list.
			} finally {
				setInitialLoading(false);
			}
		})();
	}, [authToken]);

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
				const data = await apiJson<unknown>(authToken, `/api/conversations/${id}`);
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
		[authToken, stop, setUIMessages]
	);

	const retryHistory = useCallback(() => {
		const id = conversationIdRef.current;
		if (!id) return;
		conversationIdRef.current = null;
		void switchConversation(id);
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
			if (conversationIdRef.current === id) newConversation();
			try {
				await apiJson<unknown>(authToken, `/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// The row is already gone locally; a failed delete resurfaces on reload.
			}
		},
		[authToken, newConversation]
	);

	const clearAllConversations = useCallback(async () => {
		const ids = conversations.map((c) => c.id);
		setConversations([]);
		newConversation();
		for (const id of ids) {
			try {
				await apiJson<unknown>(authToken, `/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Keep going so one failure doesn't strand the rest.
			}
		}
	}, [authToken, conversations, newConversation]);

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
			clearError();

			// Create the conversation first so the server can persist the exchange.
			if (!conversationIdRef.current) {
				const title = composed.slice(0, 60);
				try {
					const created = await apiJson<{ id: string }>(authToken, "/api/conversations", {
						method: "POST",
						body: { title },
					});
					conversationIdRef.current = created.id;
					setActiveConversationId(created.id);
					setConversations((prev) => [
						{ id: created.id, title, createdAt: new Date().toISOString() },
						...prev,
					]);
				} catch {
					// Continue unpersisted rather than dropping the user's question.
				}
			}

			setAttachmentState(null);
			void sendUIMessage({ text: composed });
		},
		[attachment, authToken, clearError, sendUIMessage, status]
	);

	const retrySend = useCallback(() => {
		setSendError(null);
		clearError();
		void regenerate();
	}, [clearError, regenerate]);

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

		// Before the stream opens there is no assistant message yet — stand in
		// with a typing indicator.
		if (loading && viewMessages.at(-1)?.role === "user") {
			viewMessages.push({
				id: "pending-assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, loading]);

	const activeConversation =
		conversations.find((c) => c.id === activeConversationId) ?? null;

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
		error: sendError ?? (chatError ? chatError.message : null),
		input,
		setInput,
		attachment,
		setAttachment,
		clearAttachment,
		sendMessage,
		stop,
		retrySend,
		retryHistory,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	};
}

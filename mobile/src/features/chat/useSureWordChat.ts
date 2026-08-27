import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useAuth } from "@clerk/expo";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { API_URL, apiJson, makeAuthedFetch, type GetToken } from "@/lib/api";
import { dbMessageToUIMessage, toViewMessage, type ChatViewMessage } from "@/lib/chatView";
import { getAndroidClipboardImages } from "@/lib/clipboardImages";
import { markConversationStopped } from "@/features/notifications/chatStopSignals";
import { completedHistory } from "./answerRecovery";
import {
	classifyChatError,
	recoveryExhaustedError,
	type ClassifiedChatError,
} from "./chatErrors";
import {
	composeMessageWithAttachment,
	type VerseAttachment,
} from "./verseActions";
import { getSettings } from "@/features/settings/settingsStore";
import {
	type ChatAttachmentDescriptor,
	type LocalChatAttachment,
	deleteChatAttachment,
	normalizeLocalAttachment,
	uploadChatAttachments,
	validateLocalAttachmentBatch,
} from "./fileAttachments";
import { pastedImageMetadata, type PastedImageFile } from "./pastedImages";

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
}

export interface SureWordChat {
	messages: ChatViewMessage[];
	conversations: Conversation[];
	activeConversationId: string | null;
	activeConversation: Conversation | null;
	isStreaming: boolean;
	loading: boolean;
	initialLoading: boolean;
	historyLoading: boolean;
	historyError: ClassifiedChatError | null;
	error: ClassifiedChatError | null;
	/** Draft text of the chat input, so screens can prefill it (e.g. ?prompt=). */
	input: string;
	setInput: (text: string) => void;
	/** Verse/chapter context attached to the next outgoing message. */
	attachment: VerseAttachment | null;
	setAttachment: (attachment: VerseAttachment) => void;
	clearAttachment: () => void;
	fileAttachments: ChatAttachmentDescriptor[];
	uploadingAttachments: boolean;
	attachmentError: string | null;
	takePhoto: () => Promise<void>;
	chooseImages: () => Promise<void>;
	chooseFiles: () => Promise<void>;
	pasteImage: () => Promise<void>;
	attachPastedImages: (files: PastedImageFile[], nativeError?: string) => Promise<void>;
	removeFileAttachment: (id: string) => Promise<void>;
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

const CONVERSATION_CREATE_ERROR =
	"Couldn't start the conversation. Check your connection and try again.";

/** How often the recovery poll asks the server whether the answer has landed. */
const RECOVERY_POLL_INTERVAL_MS = 3_000;
/**
 * How long to keep collecting. The route's own budget is 120s (maxDuration),
 * so this outlasts the slowest possible answer plus its persistence.
 */
const RECOVERY_MAX_MS = 150_000;
/**
 * Grace period after the app returns to the foreground. A stream that merely
 * stalled while backgrounded often resumes on its own, and tearing it down to
 * poll instead would throw away a live answer.
 */
const RESUME_GRACE_MS = 4_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
export function useSureWordChat(): SureWordChat {
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
	const [historyError, setHistoryError] = useState<ClassifiedChatError | null>(null);
	const [sendError, setSendError] = useState<ClassifiedChatError | null>(null);
	const [input, setInput] = useState("");
	const [attachment, setAttachmentState] = useState<VerseAttachment | null>(null);
	const [fileAttachments, setFileAttachments] = useState<ChatAttachmentDescriptor[]>([]);
	const [uploadingAttachments, setUploadingAttachments] = useState(false);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const attachmentDraftVersionRef = useRef(0);
	const setAttachment = useCallback((next: VerseAttachment) => setAttachmentState(next), []);
	const clearAttachment = useCallback(() => setAttachmentState(null), []);

	const addLocalAttachments = useCallback(async (files: LocalChatAttachment[]) => {
		if (files.length === 0 || uploadingAttachments) return;
		const draftVersion = attachmentDraftVersionRef.current;
		setAttachmentError(null);
		try {
			validateLocalAttachmentBatch(files, fileAttachments);
			setUploadingAttachments(true);
			const completed = await uploadChatAttachments(authToken, files);
			if (draftVersion !== attachmentDraftVersionRef.current) {
				for (const item of completed) void deleteChatAttachment(authToken, item.id).catch(() => undefined);
			} else {
				setFileAttachments((current) => [...current, ...completed]);
			}
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not upload the selected files.");
		} finally {
			setUploadingAttachments(false);
		}
	}, [authToken, fileAttachments, uploadingAttachments]);

	const imageAssetToLocal = useCallback((asset: ImagePicker.ImagePickerAsset): LocalChatAttachment => {
		const mediaType = asset.mimeType ?? "application/octet-stream";
		const fallbackExtension = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
		return normalizeLocalAttachment({
			uri: asset.uri,
			filename: asset.fileName ?? `photo-${Date.now()}.${fallbackExtension}`,
			mediaType,
			size: asset.fileSize,
		});
	}, []);

	const takePhoto = useCallback(async () => {
		try {
			const permission = await ImagePicker.requestCameraPermissionsAsync();
			if (!permission.granted) throw new Error("Camera permission is required to take a photo.");
			const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
			if (!result.canceled) await addLocalAttachments(result.assets.map(imageAssetToLocal));
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not open the camera.");
		}
	}, [addLocalAttachments, imageAssetToLocal]);

	const chooseImages = useCallback(async () => {
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				allowsMultipleSelection: true,
				selectionLimit: Math.max(1, 5 - fileAttachments.length),
				quality: 1,
			});
			if (!result.canceled) await addLocalAttachments(result.assets.map(imageAssetToLocal));
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not open the photo library.");
		}
	}, [addLocalAttachments, fileAttachments.length, imageAssetToLocal]);

	const chooseFiles = useCallback(async () => {
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: [
					"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
					"text/plain", "text/markdown", "text/csv", "application/json",
				],
				copyToCacheDirectory: true,
				multiple: true,
			});
			if (!result.canceled) {
				await addLocalAttachments(result.assets.map((asset) => normalizeLocalAttachment({
					uri: asset.uri,
					filename: asset.name,
					mediaType: asset.mimeType ?? "application/octet-stream",
					size: asset.size,
				})));
			}
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not open the file picker.");
		}
	}, [addLocalAttachments]);

	const attachPastedImages = useCallback(async (
		files: PastedImageFile[],
		nativeError?: string,
	) => {
		if (nativeError) {
			setAttachmentError(`Could not paste the keyboard image: ${nativeError}`);
			return;
		}
		const timestamp = Date.now();
		try {
			await addLocalAttachments(files.map((file, index) =>
				normalizeLocalAttachment(pastedImageMetadata(file, index, timestamp))
			));
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not paste the keyboard image.");
		}
	}, [addLocalAttachments]);

	const pasteImage = useCallback(async () => {
		try {
			const androidImages = await getAndroidClipboardImages();
			if (androidImages && androidImages.length > 0) {
				await attachPastedImages(androidImages);
				return;
			}

			const image = await Clipboard.getImageAsync({ format: "png" });
			if (!image) throw new Error("There isn't an image on the clipboard.");
			const file = new File(Paths.cache, `clipboard-${Date.now()}.png`);
			file.create({ overwrite: true });
			file.write(image.data.split(",", 2)[1], { encoding: "base64" });
			await attachPastedImages([{
				uri: file.uri,
				fileName: file.name,
				type: "image/png",
				fileSize: file.size,
			}]);
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not paste the clipboard image.");
		}
	}, [attachPastedImages]);

	const removeFileAttachment = useCallback(async (id: string) => {
		try {
			await deleteChatAttachment(authToken, id);
			setFileAttachments((current) => current.filter((attachment) => attachment.id !== id));
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : "Could not remove the attachment.");
		}
	}, [authToken]);

	const discardFileAttachments = useCallback((attachments: ChatAttachmentDescriptor[]) => {
		for (const item of attachments) void deleteChatAttachment(authToken, item.id).catch(() => undefined);
	}, [authToken]);

	const initialized = useRef(false);
	const conversationIdRef = useRef<string | null>(null);
	const historyLoadVersionRef = useRef(0);
	const historyLoadingRef = useRef(false);
	const historyErrorRef = useRef(false);
	/** Text of a send that failed before the stream opened, so retry can resend it. */
	const lastFailedSendRef = useRef<string | null>(null);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: `${API_URL}/api/ask-question`,
				fetch: makeAuthedFetch(authToken) as unknown as TransportFetch,
				prepareSendMessagesRequest: ({ messages }) => ({
					body: {
						messages,
						conversationId: conversationIdRef.current,
						translation: getSettings().translation,
						modelId: getSettings().chatModelId,
						effort: getSettings().chatEffort,
					},
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
	} = useAIChat<UIMessage>({ transport, throttle: 50 });

	// --- Never lose an answer to a backgrounded app -------------------------
	//
	// Android suspends the app's sockets when it leaves the foreground, so the
	// streaming fetch dies mid-answer. The server does not stop: it drains its
	// own copy of the stream and persists the finished answer (see the
	// consumeSseStream drain in /api/ask-question). So a dead stream is never a
	// lost answer - the client just has to collect it from the conversation.
	//
	// `pendingAnswerRef` holds the conversation whose answer is still owed.
	const pendingAnswerRef = useRef<string | null>(null);
	const [recovering, setRecovering] = useState(false);
	const recoveringRef = useRef(false);
	const recoverVersionRef = useRef(0);
	/** When the stream last produced anything - a stalled stream shows as old. */
	const lastStreamActivityRef = useRef(0);
	const statusRef = useRef(status);

	useEffect(() => {
		statusRef.current = status;
	}, [status]);

	useEffect(() => {
		lastStreamActivityRef.current = Date.now();
	}, [uiMessages]);

	// A stream that finished on its own owes nothing.
	useEffect(() => {
		if (status === "ready" && !recoveringRef.current) pendingAnswerRef.current = null;
	}, [status]);

	/**
	 * Walking away from an answer on purpose: stop the stream and remember that
	 * this conversation's "answer is ready" push is unwanted. The server sends
	 * that push for any dropped connection and cannot tell a deliberate stop
	 * from a backgrounded app.
	 */
	const abandonPendingAnswer = useCallback(() => {
		const conversationId = pendingAnswerRef.current;
		if (conversationId) markConversationStopped(conversationId);
		// An abandoned send must not leave its attribution attached to a later
		// question. Normal sends clear this immediately after the conversation is
		// created; this covers stop/recovery and navigation paths as well.
		setAttachmentState(null);
		stop();
	}, [stop]);

	const cancelRecovery = useCallback(() => {
		recoverVersionRef.current += 1;
		recoveringRef.current = false;
		pendingAnswerRef.current = null;
		setRecovering(false);
	}, []);

	/**
	 * Poll the conversation until the finished answer appears, then swap it in
	 * as if the stream had never broken. Only gives up after the server's own
	 * budget has run out, at which point retrying the question is the honest
	 * option.
	 */
	const collectPendingAnswer = useCallback(
		async (conversationId: string) => {
			if (recoveringRef.current) return;
			recoveringRef.current = true;
			const version = ++recoverVersionRef.current;
			setRecovering(true);

			const deadline = Date.now() + RECOVERY_MAX_MS;
			try {
				while (Date.now() < deadline) {
					if (version !== recoverVersionRef.current) return;
					if (conversationIdRef.current !== conversationId) return;
					try {
						const data = await apiJson<unknown>(
							authToken,
							`/api/conversations/${conversationId}`
						);
						if (version !== recoverVersionRef.current) return;
						const restored = completedHistory(data);
						if (restored) {
							setUIMessages(restored.map(dbMessageToUIMessage));
							pendingAnswerRef.current = null;
							setSendError(null);
							clearError();
							return;
						}
					} catch {
						// Offline or a transient failure - the answer is still being
						// written server-side, so keep asking until the deadline.
					}
					await delay(RECOVERY_POLL_INTERVAL_MS);
				}
				if (version !== recoverVersionRef.current) return;
				pendingAnswerRef.current = null;
				setSendError(recoveryExhaustedError());
			} finally {
				if (version === recoverVersionRef.current) {
					recoveringRef.current = false;
					setRecovering(false);
				}
			}
		},
		[authToken, clearError, setUIMessages]
	);

	// A broken stream is a collection job, not a failure to show the user.
	useEffect(() => {
		if (!chatError) return;
		const conversationId = pendingAnswerRef.current;
		if (!conversationId) return;
		void collectPendingAnswer(conversationId);
	}, [chatError, collectPendingAnswer]);

	// Coming back to the app: give a stalled stream a moment to resume, and
	// collect from the server only once it is clear nothing is arriving.
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			const conversationId = pendingAnswerRef.current;
			if (!conversationId || recoveringRef.current) return;

			void (async () => {
				await delay(RESUME_GRACE_MS);
				if (pendingAnswerRef.current !== conversationId || recoveringRef.current) return;
				if (statusRef.current === "ready") return;
				if (Date.now() - lastStreamActivityRef.current < RESUME_GRACE_MS) return;
				abandonPendingAnswer();
				void collectPendingAnswer(conversationId);
			})();
		});
		return () => subscription.remove();
	}, [abandonPendingAnswer, collectPendingAnswer]);

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
			attachmentDraftVersionRef.current += 1;

			discardFileAttachments(fileAttachments);
			setFileAttachments([]);
			setAttachmentState(null);
			abandonPendingAnswer();
			cancelRecovery();
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
			} catch (error) {
				if (loadVersion === historyLoadVersionRef.current) {
					historyErrorRef.current = true;
					setHistoryError(classifyChatError(error, { message: HISTORY_LOAD_ERROR }));
				}
			} finally {
				if (loadVersion === historyLoadVersionRef.current) {
					historyLoadingRef.current = false;
					setHistoryLoading(false);
				}
			}
		},
		[abandonPendingAnswer, authToken, cancelRecovery, discardFileAttachments, fileAttachments, setUIMessages]
	);

	const retryHistory = useCallback(() => {
		const id = conversationIdRef.current;
		if (!id) return;
		conversationIdRef.current = null;
		void switchConversation(id);
	}, [switchConversation]);

	const newConversation = useCallback(() => {
		historyLoadVersionRef.current += 1;
		attachmentDraftVersionRef.current += 1;
		historyLoadingRef.current = false;
		historyErrorRef.current = false;
		discardFileAttachments(fileAttachments);
		setFileAttachments([]);
		setAttachmentState(null);
		abandonPendingAnswer();
		cancelRecovery();
		setHistoryLoading(false);
		setHistoryError(null);
		setActiveConversationId(null);
		conversationIdRef.current = null;
		lastFailedSendRef.current = null;
		setSendError(null);
		setUIMessages([]);
	}, [abandonPendingAnswer, cancelRecovery, discardFileAttachments, fileAttachments, setUIMessages]);

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
				(!composed && fileAttachments.length === 0) ||
				uploadingAttachments ||
				historyLoadingRef.current ||
				historyErrorRef.current ||
				status === "submitted" ||
				status === "streaming"
			) {
				return;
			}

			setSendError(null);
			clearError();
			lastFailedSendRef.current = null;
			const sendingAttachment = attachment;

			// Create the conversation first so the server can persist the exchange.
			if (!conversationIdRef.current) {
				const title = (composed || `Attachment: ${fileAttachments[0]?.filename ?? "New chat"}`).slice(0, 60);
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
				} catch (error) {
					// Do NOT send without a conversation: the recovery poll collects a
					// finished answer from the conversation, so a conversationless
					// stream could lose the answer outright. Remember the question so
					// "Try again" resends it instead of regenerating nothing.
					lastFailedSendRef.current = text;
					setSendError(classifyChatError(error, { message: CONVERSATION_CREATE_ERROR }));
					return;
				}
			}

			setAttachmentState(null);
			const sendingAttachments = fileAttachments;
			setFileAttachments([]);
			// From here the server owns the answer: if this device's stream dies
			// (backgrounded, screen locked, network changed) the answer is still
			// written and persisted, and the recovery poll collects it. Without a
			// conversation there is nothing to collect from.
			pendingAnswerRef.current = conversationIdRef.current;
			lastStreamActivityRef.current = Date.now();
			void sendUIMessage({
				metadata: {
					...(sendingAttachments.length > 0
						? { attachmentIds: sendingAttachments.map((item) => item.id) }
						: {}),
					...(sendingAttachment?.origin ? { origin: sendingAttachment.origin } : {}),
				},
				parts: [
					...sendingAttachments.map((item) => ({
						type: "file" as const,
						filename: item.filename,
						mediaType: item.mediaType,
						url: item.previewUrl,
					})),
					...(composed ? [{ type: "text" as const, text: composed }] : []),
				],
			});
		},
		[attachment, authToken, clearError, fileAttachments, sendUIMessage, status, uploadingAttachments]
	);

	const retrySend = useCallback(() => {
		// The send never happened (the conversation could not be created), so
		// there is no stream to regenerate - resend the original question.
		const failedSend = lastFailedSendRef.current;
		if (failedSend !== null && !conversationIdRef.current) {
			lastFailedSendRef.current = null;
			setSendError(null);
			void sendMessage(failedSend);
			return;
		}
		abandonPendingAnswer();
		cancelRecovery();
		setSendError(null);
		clearError();
		pendingAnswerRef.current = conversationIdRef.current;
		lastStreamActivityRef.current = Date.now();
		void regenerate();
	}, [abandonPendingAnswer, cancelRecovery, clearError, regenerate, sendMessage]);

	const isStreaming = status === "streaming";
	// Collecting a finished answer from the server reads as "still working" -
	// the user asked a question and one is on its way, same as a live stream.
	const loading = status === "submitted" || recovering;

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
		// A broken stream while an answer is being collected is not the user's
		// problem to see - it resolves itself.
		error: recovering ? null : (sendError ?? (chatError ? classifyChatError(chatError) : null)),
		input,
		setInput,
		attachment,
		fileAttachments,
		uploadingAttachments,
		attachmentError,
		setAttachment,
		clearAttachment,
		takePhoto,
		chooseImages,
		chooseFiles,
		pasteImage,
		attachPastedImages,
		removeFileAttachment,
		sendMessage,
		stop: abandonPendingAnswer,
		retrySend,
		retryHistory,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	};
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { composeMessageWithAttachment, type VerseAttachment } from "./verseActions";
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
	historyError: string | null;
	error: string | null;
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
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
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
			attachmentDraftVersionRef.current += 1;

			discardFileAttachments(fileAttachments);
			setFileAttachments([]);
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
		[authToken, discardFileAttachments, fileAttachments, stop, setUIMessages]
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
		stop();
		setHistoryLoading(false);
		setHistoryError(null);
		setActiveConversationId(null);
		conversationIdRef.current = null;
		setSendError(null);
		setUIMessages([]);
	}, [discardFileAttachments, fileAttachments, stop, setUIMessages]);

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
					if (fileAttachments.length > 0) {
						setSendError(error instanceof Error ? error.message : "Could not create the conversation.");
						return;
					}
				}
			}

			setAttachmentState(null);
			const sendingAttachments = fileAttachments;
			setFileAttachments([]);
			void sendUIMessage({
				metadata: sendingAttachments.length > 0
					? { attachmentIds: sendingAttachments.map((item) => item.id) }
					: {},
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
		stop,
		retrySend,
		retryHistory,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	};
}

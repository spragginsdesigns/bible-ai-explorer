import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	Pressable,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text } from "@/components/AppText";
import { typography } from "@/theme";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Screen } from "@/components/ui";
import { ChatInputBar } from "@/features/chat/ChatInputBar";
import { ModelPickerSheet } from "@/features/chat/ModelPickerSheet";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { ErrorCard } from "@/features/chat/ErrorCard";
import { HistoryModal } from "@/features/chat/HistoryModal";
import { MessageList } from "@/features/chat/MessageList";
import { SanctuaryBackdrop, WelcomeState } from "@/features/chat/WelcomeState";
import { ChatHeader } from "@/features/chat/ChatHeader";
import { chatColors } from "@/features/chat/chatAppearance";
import { guidePhase } from "@/components/guideMotion";
import { useKeyboardVisible, useTabBarSpace } from "@/features/chat/layout";
import { CHAT_SLASH_COMMANDS, type LocalCommandAction } from "@/features/chat/slashCommands";
import { useSureWordChat } from "@/features/chat/useSureWordChat";
import { ShareActions } from "@/features/share/ShareActions";
import type { ChatViewMessage } from "@/lib/chatView";
import { takePendingShare, usePendingShare } from "@/features/share/shareInbox";
import { shareActionMessage, shareActionsFor, type ShareAction } from "@/features/share/shareIntake";
import { TRANSLATIONS, type TranslationId } from "@/features/bible/translations";
import { spacing, type Colors } from "@/theme";
import { useSettings, useThemedStyles, useTheme } from "@/features/settings/settingsStore";

// A render crash shows a Try again screen in place of this route instead of closing the app.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

export default function ChatScreen() {
	const router = useRouter();
	const chat = useSureWordChat();
	const styles = useThemedStyles(createStyles);
	const { colors: themeColors } = useTheme();
	const colors = chatColors(themeColors);
	const { translation: defaultTranslation } = useSettings();
	const [historyOpen, setHistoryOpen] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const getToken = useStableGetToken();
	const tabBarSpace = useTabBarSpace();
	const keyboardVisible = useKeyboardVisible();
	const params = useLocalSearchParams<{
		prompt?: string;
		attachRef?: string;
		attachText?: string;
		attachTranslation?: string;
		verseOfDayId?: string;
		conversationId?: string;
	}>();
	const promptParam = typeof params.prompt === "string" ? params.prompt : "";
	const conversationIdParam =
		typeof params.conversationId === "string" ? params.conversationId : "";
	const attachRefParam = typeof params.attachRef === "string" ? params.attachRef : "";
	const attachTextParam = typeof params.attachText === "string" ? params.attachText : "";
	const attachTranslationParam =
		typeof params.attachTranslation === "string" ? params.attachTranslation : "";
	const verseOfDayIdParam = typeof params.verseOfDayId === "string" ? params.verseOfDayId : "";
	const [focusSignal, setFocusSignal] = useState(0);
	const lastSeededPrompt = useRef("");
	const lastSeededAttachment = useRef("");
	const lastOpenedConversation = useRef("");
	const { isSignedIn } = useAuth();
	const pendingShare = usePendingShare();
	/** Set while a chat opened from "Share into SureWord" has not been sent yet. */
	const [shareNotices, setShareNotices] = useState<string[] | null>(null);

	/**
	 * The message being edited, and the draft it pushed aside: the composer
	 * holds the message's words until it is sent or cancelled, and then the
	 * draft comes back. Anything else that takes the composer (a follow-up
	 * chip, an Ask from the Bible tab, a pinned verse, a share) ends the edit
	 * first, so a later Send can never turn into an edit by surprise.
	 */
	const [editing, setEditing] = useState<{
		messageId: string;
		draft: string;
		allowEmpty: boolean;
	} | null>(null);
	const editingRef = useRef(editing);
	useEffect(() => {
		editingRef.current = editing;
	}, [editing]);
	// Read through a ref so Edit's callback, and with it every memoized
	// bubble, does not change identity on each keystroke.
	const inputRef = useRef(chat.input);
	useEffect(() => {
		inputRef.current = chat.input;
	}, [chat.input]);

	/** Leave edit mode; the pushed-aside draft returns unless the composer is being taken. */
	const leaveEdit = useCallback(
		(restoreDraft: boolean) => {
			const current = editingRef.current;
			if (!current) return;
			editingRef.current = null;
			if (restoreDraft) chat.setInput(current.draft);
			setEditing(null);
		},
		[chat.setInput]
	);

	// "Share into SureWord": open what was shared as a new chat. Waits for a
	// signed-in session (uploads need one) and for any upload already running,
	// which would otherwise make the new one bail out.
	useEffect(() => {
		if (!pendingShare || !isSignedIn || chat.uploadingAttachments) return;
		const draft = takePendingShare();
		if (!draft) return;
		setHistoryOpen(false);
		setModelPickerOpen(false);
		setShareNotices(draft.notices);
		setFocusSignal((signal) => signal + 1);
		// The share takes the composer, so the old draft must not come back over it.
		leaveEdit(false);
		void chat.startSharedChat(draft);
	}, [pendingShare, isSignedIn, chat.uploadingAttachments, chat.startSharedChat, leaveEdit]);

	// Once the shared chat has a message, the share actions have done their job.
	useEffect(() => {
		if (chat.messages.length > 0) setShareNotices(null);
	}, [chat.messages.length]);

	// Tapping an "answer is ready" notification lands here with the
	// conversation it belongs to - open it rather than whatever was last on
	// screen.
	useEffect(() => {
		if (!conversationIdParam || conversationIdParam === lastOpenedConversation.current) return;
		lastOpenedConversation.current = conversationIdParam;
		void chat.switchConversation(conversationIdParam);
	}, [conversationIdParam, chat.switchConversation]);

	// Ask-AI entry points (e.g. the Bible tab) push here with ?prompt= — prefill
	// the input and focus it, but leave sending to the user.
	useEffect(() => {
		if (!promptParam || promptParam === lastSeededPrompt.current) return;
		lastSeededPrompt.current = promptParam;
		leaveEdit(false);
		chat.setInput(promptParam);
		setFocusSignal((signal) => signal + 1);
	}, [promptParam, chat.setInput, leaveEdit]);

	// Verse/chapter attachments (?attachRef= etc.): pin the passage above the
	// input and focus so the user can type their own question — the draft text
	// they may have typed stays untouched.
	useEffect(() => {
		if (!attachRefParam) return;
		const key = `${attachRefParam}${attachTranslationParam}${attachTextParam}${verseOfDayIdParam}`;
		if (key === lastSeededAttachment.current) return;
		lastSeededAttachment.current = key;
		leaveEdit(true);
		const translation: TranslationId =
			attachTranslationParam in TRANSLATIONS
				? (attachTranslationParam as TranslationId)
				: defaultTranslation;
		chat.setAttachment({
			reference: attachRefParam,
			text: attachTextParam,
			translation,
			...(verseOfDayIdParam
				? {
						origin: {
							surface: "daily-cross" as const,
							verseOfDayId: verseOfDayIdParam,
							reference: attachRefParam,
							action: "go-deeper" as const,
						},
				  }
				: {}),
		});
		setFocusSignal((signal) => signal + 1);
	}, [
		attachRefParam,
		attachTextParam,
		attachTranslationParam,
		verseOfDayIdParam,
		defaultTranslation,
		chat.setAttachment,
		leaveEdit,
	]);

	const {
		messages,
		historyLoading,
		historyError,
		error,
		isStreaming,
		loading,
		sendMessage,
		editMessage,
		retryAnswer,
		stop,
		retrySend,
		retryHistory,
		newConversation,
	} = chat;
	const busy = loading || isStreaming;

	const startEdit = useCallback(
		(message: ChatViewMessage) => {
			const next = {
				messageId: message.id,
				// Editing a second message keeps the draft from before the first.
				draft: editingRef.current ? editingRef.current.draft : inputRef.current,
				allowEmpty: (message.attachments?.length ?? 0) > 0,
			};
			editingRef.current = next;
			setEditing(next);
			chat.setInput(message.content);
			setFocusSignal((signal) => signal + 1);
		},
		[chat.setInput]
	);

	const cancelEdit = useCallback(() => leaveEdit(true), [leaveEdit]);

	// The edited message can vanish under the editor (new chat, another
	// conversation, a history reload); the edit goes with it.
	useEffect(() => {
		if (editing && !messages.some((message) => message.id === editing.messageId)) {
			leaveEdit(true);
		}
	}, [editing, messages, leaveEdit]);

	// A follow-up chip or opening question is always a new question.
	const send = useCallback(
		(text: string) => {
			leaveEdit(true);
			void sendMessage(text);
		},
		[leaveEdit, sendMessage]
	);

	// Only the composer sends an edit. One that could not go out (an answer
	// still running) keeps its words and stays open.
	const submitComposer = useCallback(
		(text: string) => {
			const current = editingRef.current;
			if (!current) {
				void sendMessage(text);
				return;
			}
			void editMessage(current.messageId, text).then((sent) => {
				if (sent) leaveEdit(true);
				else chat.setInput(text);
			});
		},
		[editMessage, leaveEdit, sendMessage, chat.setInput]
	);

	const openHistory = useCallback(() => setHistoryOpen(true), []);
	const closeHistory = useCallback(() => setHistoryOpen(false), []);

	const onNewChat = useCallback(() => {
		newConversation();
		setShareNotices(null);
		setHistoryOpen(false);
	}, [newConversation]);

	const onShareAction = useCallback(
		(action: ShareAction) => {
			const message = shareActionMessage(action, chat.input);
			leaveEdit(false);
			chat.setInput("");
			setShareNotices(null);
			void sendMessage(message);
		},
		[chat.input, chat.setInput, leaveEdit, sendMessage]
	);

	const onLocalCommand = useCallback(
		(action: LocalCommandAction) => {
			if (action === "new") {
				onNewChat();
			} else if (action === "history") {
				setHistoryOpen(true);
			} else if (action === "clear") {
				const activeId = chat.activeConversationId;
				if (!activeId) {
					onNewChat();
					return;
				}
				Alert.alert(
					"Delete this conversation?",
					"The conversation and its messages will be removed.",
					[
						{ text: "Cancel", style: "cancel" },
						{
							text: "Delete",
							style: "destructive",
							onPress: () => void chat.deleteConversation(activeId),
						},
					]
				);
			}
		},
		[chat, onNewChat]
	);

	const showWelcome = messages.length === 0 && !historyLoading && !historyError && !error;
	const inputBar = (
		<ChatInputBar
			onSend={submitComposer}
			onStop={stop}
			loading={loading}
			isStreaming={isStreaming}
			disabled={historyLoading || historyError !== null}
			commands={CHAT_SLASH_COMMANDS}
			onLocalCommand={onLocalCommand}
			value={chat.input}
			onChangeText={chat.setInput}
			attachment={chat.attachment}
			onClearAttachment={chat.clearAttachment}
			fileAttachments={chat.fileAttachments}
			uploadingAttachments={chat.uploadingAttachments || chat.videoStatus !== null}
			uploadingLabel={
				chat.videoStatus
					?? (chat.uploadingAudio
						? "Uploading and transcribing the voice message..."
						: "Uploading...")
			}
			attachmentError={chat.attachmentError}
			onTakePhoto={() => void chat.takePhoto()}
			onChooseImages={() => void chat.chooseImages()}
			onChooseFiles={() => void chat.chooseFiles()}
			onPasteImage={() => void chat.pasteImage()}
			onPasteImages={(files, attachmentError) =>
				void chat.attachPastedImages(files, attachmentError)
			}
			onRemoveFileAttachment={(id) => void chat.removeFileAttachment(id)}
			focusSignal={focusSignal}
			prominent={showWelcome}
			editing={editing ? { allowEmpty: editing.allowEmpty, onCancel: cancelEdit } : null}
		/>
	);

	return (
		<Screen style={styles.screen}>
			<KeyboardAvoidingView
				style={styles.fill}
				behavior="padding"
				enabled={keyboardVisible}
			>
				{showWelcome ? <SanctuaryBackdrop /> : null}
				<ChatHeader
					title={chat.activeConversation?.title}
					phase={guidePhase(busy, messages.find(message => message.role === "assistant" && message.isStreaming)?.content ?? "")}
					onNewChat={onNewChat}
					onOpenModelPicker={() => setModelPickerOpen(true)}
					onOpenHistory={openHistory}
					onOpenSettings={() => router.push("/settings")}
				/>

				{historyLoading ? (
					<View style={styles.center}>
						<ActivityIndicator color={colors.accent} />
						<Text style={styles.centerLabel}>Restoring this conversation...</Text>
					</View>
				) : historyError ? (
					<View style={styles.centerPadded}>
						<ErrorCard
							title={historyError.title}
							message={historyError.message}
							code={historyError.code}
							onRetry={retryHistory}
						/>
					</View>
				) : showWelcome ? (
					<WelcomeState onSelectQuestion={send} bottomInset={spacing.lg} />
				) : (
					<MessageList
						messages={messages}
						onFollowUp={send}
						bottomInset={spacing.lg}
						defaultNoteTitle={chat.activeConversation?.title}
						onFeedback={chat.setFeedback}
						conversationId={chat.activeConversationId}
						onEdit={busy ? undefined : startEdit}
						onRetry={busy || error ? undefined : retryAnswer}
					>
						{error && (
							<ErrorCard
								title={error.title}
								message={error.message}
								code={error.code}
								retryLabel="Try again"
								onRetry={error.retryable ? retrySend : undefined}
							/>
						)}
					</MessageList>
				)}

				{/* Docked in every state, the welcome included, so the composer
				    never jumps when the first answer replaces the empty screen. */}
				<View style={[styles.inputWrap, { paddingBottom: tabBarSpace + spacing.md }]}>
					{shareNotices !== null && (
						<ShareActions
							notices={shareNotices}
							actionable={
								Boolean(chat.input.trim()) ||
								chat.fileAttachments.length > 0 ||
								chat.uploadingAttachments
							}
							actions={shareActionsFor(chat.input)}
							disabled={chat.uploadingAttachments || chat.videoStatus !== null || loading || isStreaming}
							onAction={onShareAction}
							onDismiss={() => setShareNotices(null)}
						/>
					)}
					{inputBar}
				</View>
			</KeyboardAvoidingView>

			<ModelPickerSheet
				visible={modelPickerOpen}
				onClose={() => setModelPickerOpen(false)}
				getToken={getToken}
			/>

			<HistoryModal
				visible={historyOpen}
				conversations={chat.conversations}
				activeConversationId={chat.activeConversationId}
				loading={chat.initialLoading}
				onClose={closeHistory}
				onSelect={(id) => {
					setShareNotices(null);
					void chat.switchConversation(id);
				}}
				onDelete={(id) => void chat.deleteConversation(id)}
				onNewChat={onNewChat}
				onClearAll={() => void chat.clearAllConversations()}
			/>
		</Screen>
	);
}

const createStyles = (theme: Colors) => {
	const c = chatColors(theme);
	return StyleSheet.create({
		screen: { backgroundColor: c.bg },
		fill: { flex: 1 },
		center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
		centerLabel: { color: c.textMuted, ...typography.support },
		centerPadded: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
		inputWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
	});
};

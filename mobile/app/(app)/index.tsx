import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	Pressable,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BrandTitle, Screen } from "@/components/ui";
import { ChatInputBar } from "@/features/chat/ChatInputBar";
import { ModelPickerSheet } from "@/features/chat/ModelPickerSheet";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { ErrorCard } from "@/features/chat/ErrorCard";
import { HistoryModal } from "@/features/chat/HistoryModal";
import { MessageList } from "@/features/chat/MessageList";
import { WelcomeState } from "@/features/chat/WelcomeState";
import { useTabBarSpace } from "@/features/chat/layout";
import { CHAT_SLASH_COMMANDS, type LocalCommandAction } from "@/features/chat/slashCommands";
import { useSureWordChat } from "@/features/chat/useSureWordChat";
import { TRANSLATIONS, type TranslationId } from "@/features/bible/translations";
import { radius, spacing, type Colors } from "@/theme";
import { useSettings, useThemedStyles, useTheme } from "@/features/settings/settingsStore";

export default function ChatScreen() {
	const router = useRouter();
	const chat = useSureWordChat();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { translation: defaultTranslation } = useSettings();
	const [historyOpen, setHistoryOpen] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const getToken = useStableGetToken();
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{
		prompt?: string;
		attachRef?: string;
		attachText?: string;
		attachTranslation?: string;
	}>();
	const promptParam = typeof params.prompt === "string" ? params.prompt : "";
	const attachRefParam = typeof params.attachRef === "string" ? params.attachRef : "";
	const attachTextParam = typeof params.attachText === "string" ? params.attachText : "";
	const attachTranslationParam =
		typeof params.attachTranslation === "string" ? params.attachTranslation : "";
	const [focusSignal, setFocusSignal] = useState(0);
	const lastSeededPrompt = useRef("");
	const lastSeededAttachment = useRef("");

	// Ask-AI entry points (e.g. the Bible tab) push here with ?prompt= — prefill
	// the input and focus it, but leave sending to the user.
	useEffect(() => {
		if (!promptParam || promptParam === lastSeededPrompt.current) return;
		lastSeededPrompt.current = promptParam;
		chat.setInput(promptParam);
		setFocusSignal((signal) => signal + 1);
	}, [promptParam, chat.setInput]);

	// Verse/chapter attachments (?attachRef= etc.): pin the passage above the
	// input and focus so the user can type their own question — the draft text
	// they may have typed stays untouched.
	useEffect(() => {
		if (!attachRefParam) return;
		const key = `${attachRefParam}${attachTranslationParam}${attachTextParam}`;
		if (key === lastSeededAttachment.current) return;
		lastSeededAttachment.current = key;
		const translation: TranslationId =
			attachTranslationParam in TRANSLATIONS
				? (attachTranslationParam as TranslationId)
				: defaultTranslation;
		chat.setAttachment({ reference: attachRefParam, text: attachTextParam, translation });
		setFocusSignal((signal) => signal + 1);
	}, [attachRefParam, attachTextParam, attachTranslationParam, defaultTranslation, chat.setAttachment]);

	const {
		messages,
		historyLoading,
		historyError,
		error,
		isStreaming,
		loading,
		sendMessage,
		stop,
		retrySend,
		retryHistory,
		newConversation,
	} = chat;

	const send = useCallback(
		(text: string) => {
			void sendMessage(text);
		},
		[sendMessage]
	);

	const openHistory = useCallback(() => setHistoryOpen(true), []);
	const closeHistory = useCallback(() => setHistoryOpen(false), []);

	const onNewChat = useCallback(() => {
		newConversation();
		setHistoryOpen(false);
	}, [newConversation]);

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

	const showWelcome = messages.length === 0 && !historyLoading && !historyError;

	return (
		<Screen>
			<KeyboardAvoidingView
				style={styles.fill}
				behavior="padding"
			>
				<View style={styles.header}>
					<View style={styles.headerTitle}>
						<BrandTitle size={26} />
						{chat.activeConversation && (
							<Text style={styles.subtitle} numberOfLines={1}>
								{chat.activeConversation.title}
							</Text>
						)}
					</View>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Choose AI model"
						onPress={() => setModelPickerOpen(true)}
						style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
					>
						<Ionicons name="sparkles-outline" size={16} color={colors.textMuted} />
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="New chat"
						onPress={onNewChat}
						style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
					>
						<Text style={styles.headerGlyph}>✦</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Conversation history"
						onPress={openHistory}
						style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
					>
						<Text style={styles.headerGlyph}>☰</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Settings"
						onPress={() => router.push("/settings")}
						style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
					>
						<Text style={styles.headerGlyph}>⚙</Text>
					</Pressable>
				</View>

				{historyLoading ? (
					<View style={styles.center}>
						<ActivityIndicator color={colors.accent} />
						<Text style={styles.centerLabel}>Restoring this conversation...</Text>
					</View>
				) : historyError ? (
					<View style={styles.centerPadded}>
						<ErrorCard message={historyError} onRetry={retryHistory} />
					</View>
				) : showWelcome ? (
					<WelcomeState onSelectQuestion={send} bottomInset={spacing.lg} />
				) : (
					<MessageList
						messages={messages}
						onFollowUp={send}
						bottomInset={spacing.lg}
						defaultNoteTitle={chat.activeConversation?.title}
					>
						{error && (
							<ErrorCard
								message={`Something went wrong while answering: ${error}`}
								retryLabel="Try again"
								onRetry={retrySend}
							/>
						)}
					</MessageList>
				)}

				<View style={[styles.inputWrap, { paddingBottom: tabBarSpace + spacing.sm }]}>
					<ChatInputBar
						onSend={send}
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
						uploadingAttachments={chat.uploadingAttachments}
						attachmentError={chat.attachmentError}
						onTakePhoto={() => void chat.takePhoto()}
						onChooseImages={() => void chat.chooseImages()}
						onChooseFiles={() => void chat.chooseFiles()}
						onPasteImage={() => void chat.pasteImage()}
						onRemoveFileAttachment={(id) => void chat.removeFileAttachment(id)}
						focusSignal={focusSignal}
					/>
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
				onSelect={(id) => void chat.switchConversation(id)}
				onDelete={(id) => void chat.deleteConversation(id)}
				onNewChat={onNewChat}
				onClearAll={() => void chat.clearAllConversations()}
			/>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
			paddingBottom: spacing.md,
		},
		headerTitle: { flex: 1, minWidth: 0 },
		subtitle: { color: c.textFaint, fontSize: 12, marginTop: 2 },
		headerButton: {
			width: 38,
			height: 38,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		headerButtonPressed: { backgroundColor: c.surfacePressed },
		headerGlyph: { color: c.textMuted, fontSize: 15 },
		center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
		centerLabel: { color: c.textFaint, fontSize: 13 },
		centerPadded: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
		inputWrap: {
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
		},
	});

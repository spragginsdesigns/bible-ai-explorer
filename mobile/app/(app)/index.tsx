import React, { useCallback, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { BrandTitle, Screen } from "@/components/ui";
import { ChatInputBar } from "@/features/chat/ChatInputBar";
import { ErrorCard } from "@/features/chat/ErrorCard";
import { HistoryModal } from "@/features/chat/HistoryModal";
import { MessageList } from "@/features/chat/MessageList";
import { WelcomeState } from "@/features/chat/WelcomeState";
import { useTabBarSpace } from "@/features/chat/layout";
import { useVerseMindChat } from "@/features/chat/useVerseMindChat";
import { colors, radius, spacing } from "@/theme";

export default function ChatScreen() {
	const chat = useVerseMindChat();
	const [historyOpen, setHistoryOpen] = useState(false);
	const tabBarSpace = useTabBarSpace();

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

	const showWelcome = messages.length === 0 && !historyLoading && !historyError;

	return (
		<Screen>
			<KeyboardAvoidingView
				style={styles.fill}
				behavior={Platform.OS === "ios" ? "padding" : undefined}
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
					<MessageList messages={messages} onFollowUp={send} bottomInset={spacing.lg}>
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
					/>
				</View>
			</KeyboardAvoidingView>

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

const styles = StyleSheet.create({
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
	subtitle: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
	headerButton: {
		width: 38,
		height: 38,
		borderRadius: radius.full,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
	},
	headerButtonPressed: { backgroundColor: colors.surfacePressed },
	headerGlyph: { color: colors.textMuted, fontSize: 15 },
	center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
	centerLabel: { color: colors.textFaint, fontSize: 13 },
	centerPadded: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
	inputWrap: {
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.sm,
	},
});

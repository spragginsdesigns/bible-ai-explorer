import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ChatViewMessage } from "@/lib/chatView";
import { colors, radius, spacing } from "@/theme";
import { FollowUpChips } from "./FollowUpChips";
import { MarkdownBody } from "./MarkdownBody";
import { NoteActionCard } from "./NoteActionCard";
import { RetrievedVersesCard } from "./RetrievedVersesCard";
import { TypingDots } from "./TypingDots";
import { WebResultsCard } from "./WebResultsCard";

interface MessageBubbleProps {
	message: ChatViewMessage;
	/** Only supplied for the newest assistant message. */
	onFollowUp?: (question: string) => void;
}

export function MessageBubble({ message, onFollowUp }: MessageBubbleProps) {
	if (message.role === "user") {
		return (
			<View style={styles.userRow}>
				<View style={styles.userBubble}>
					<Text style={styles.userText}>{message.content}</Text>
				</View>
			</View>
		);
	}

	const settled = !message.isStreaming;

	return (
		<View style={styles.assistantRow}>
			<View style={styles.avatar}>
				<Text style={styles.avatarGlyph}>✦</Text>
			</View>
			<View style={styles.assistantBody}>
				{message.content ? (
					<MarkdownBody content={message.content} />
				) : message.isStreaming && !message.activity ? (
					<TypingDots />
				) : null}

				{message.isStreaming && message.activity && (
					<View style={styles.activityRow}>
						<ActivityIndicator size="small" color={colors.accentDim} />
						<Text style={styles.activityLabel}>{message.activity}...</Text>
					</View>
				)}

				{message.noteActions?.map((action, index) => (
					<NoteActionCard key={`${action.noteId}-${index}`} action={action} />
				))}

				{settled && message.retrievedVerses && message.retrievedVerses.length > 0 && (
					<RetrievedVersesCard
						verses={message.retrievedVerses}
						averageSimilarity={message.averageSimilarity ?? 0}
					/>
				)}

				{settled && message.tavilyResults && message.tavilyResults.length > 0 && (
					<WebResultsCard results={message.tavilyResults} />
				)}

				{settled && onFollowUp && message.followUps && message.followUps.length > 0 && (
					<FollowUpChips questions={message.followUps} onSelect={onFollowUp} />
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	userRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		marginBottom: spacing.xl,
	},
	userBubble: {
		maxWidth: "85%",
		backgroundColor: colors.surfaceStrong,
		borderColor: colors.borderStrong,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.lg,
		borderBottomRightRadius: radius.sm,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
	},
	userText: { color: colors.text, fontSize: 15, lineHeight: 22 },
	assistantRow: {
		flexDirection: "row",
		gap: spacing.md,
		marginBottom: spacing.xl,
	},
	avatar: {
		width: 30,
		height: 30,
		borderRadius: radius.full,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
		borderColor: colors.borderStrong,
		borderWidth: StyleSheet.hairlineWidth,
		marginTop: 2,
	},
	avatarGlyph: { color: colors.accent, fontSize: 14 },
	assistantBody: { flex: 1, minWidth: 0 },
	activityRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.sm,
		paddingVertical: spacing.sm,
	},
	activityLabel: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
});

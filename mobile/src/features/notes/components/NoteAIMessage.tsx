import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import type { ChatViewMessage } from "@/lib/chatView";
import { NoteMarkdown } from "./NoteMarkdown";
import { TypingDots } from "./TypingDots";

export function NoteAIMessage({ message }: { message: ChatViewMessage }) {
	if (message.role === "user") {
		return (
			<View style={styles.userRow}>
				<View style={styles.userBubble}>
					<Text style={styles.userText}>{message.content}</Text>
				</View>
			</View>
		);
	}

	const showDots = !!message.isStreaming && !message.content && !message.activity;

	return (
		<View style={styles.assistantRow}>
			<View style={styles.avatar}>
				<Text style={styles.avatarGlyph}>✦</Text>
			</View>
			<View style={styles.assistantBody}>
				{message.content ? <NoteMarkdown content={message.content} /> : null}
				{showDots ? <TypingDots /> : null}
				{message.isStreaming && message.activity ? (
					<Text style={styles.activity}>{message.activity}…</Text>
				) : null}
				{message.noteActions?.map((action, index) => (
					<View key={`${action.noteId}-${index}`} style={styles.noteAction}>
						<Text style={styles.noteActionGlyph}>✎</Text>
						<Text style={styles.noteActionText} numberOfLines={2}>
							{action.created ? "Created note " : "Added to note "}
							<Text style={styles.noteActionTitle}>{action.noteTitle}</Text>
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	userRow: { alignItems: "flex-end", marginBottom: spacing.md },
	userBubble: {
		maxWidth: "86%",
		backgroundColor: colors.surfaceStrong,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		borderRadius: radius.lg,
		borderBottomRightRadius: radius.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
	},
	userText: { color: colors.text, fontSize: 14, lineHeight: 20 },

	assistantRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
	avatar: {
		width: 24,
		height: 24,
		borderRadius: 12,
		marginTop: 2,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
	},
	avatarGlyph: { color: colors.accent, fontSize: 11 },
	assistantBody: { flex: 1, minWidth: 0 },
	activity: { color: colors.textFaint, fontSize: 12, paddingVertical: 4 },

	noteAction: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.sm,
		marginTop: 6,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderRadius: radius.md,
		backgroundColor: colors.accentSoft,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.accentBorder,
	},
	noteActionGlyph: { color: colors.accent, fontSize: 12 },
	noteActionText: { flex: 1, color: colors.textSecondary, fontSize: 12 },
	noteActionTitle: { color: colors.accent, fontWeight: "600" },
});

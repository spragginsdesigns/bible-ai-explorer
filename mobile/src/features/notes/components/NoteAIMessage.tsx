import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { ChatViewMessage } from "@/lib/chatView";
import { NoteMarkdown } from "./NoteMarkdown";
import { TypingDots } from "./TypingDots";

export function NoteAIMessage({ message }: { message: ChatViewMessage }) {
	const styles = useThemedStyles(createStyles);

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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		userRow: { alignItems: "flex-end", marginBottom: spacing.md },
		userBubble: {
			maxWidth: "86%",
			backgroundColor: c.surfaceStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			borderRadius: radius.lg,
			borderBottomRightRadius: radius.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
		},
		userText: { color: c.text, fontSize: 14, lineHeight: 20 },

		assistantRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
		avatar: {
			width: 24,
			height: 24,
			borderRadius: 12,
			marginTop: 2,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		avatarGlyph: { color: c.accent, fontSize: 11 },
		assistantBody: { flex: 1, minWidth: 0 },
		activity: { color: c.textFaint, fontSize: 12, paddingVertical: 4 },

		noteAction: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: 6,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.md,
			backgroundColor: c.accentSoft,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
		},
		noteActionGlyph: { color: c.accent, fontSize: 12 },
		noteActionText: { flex: 1, color: c.textSecondary, fontSize: 12 },
		noteActionTitle: { color: c.accent, fontWeight: "600" },
	});

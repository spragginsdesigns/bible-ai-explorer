import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import { radius, spacing, typography } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { ChatViewMessage } from "@/lib/chatView";
import { normalizeAssistantMarkdown } from "@/lib/assistantMarkdown";
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
			<SureWordGuideAvatar size={26} active={Boolean(message.isStreaming)} />
			<View style={styles.assistantBody}>
				{/* The same normalizer the three other assistant renderers use;
				    fb2eec4 wired it into chat and web but missed this panel. */}
				{message.content ? (
					<NoteMarkdown
						content={normalizeAssistantMarkdown(message.content, {
							streaming: Boolean(message.isStreaming),
						})}
					/>
				) : null}
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
		userText: { ...typography.body, color: c.text },

		assistantRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
		assistantBody: { flex: 1, minWidth: 0 },
		activity: { ...typography.meta, color: c.textFaint, paddingVertical: 4 },

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
		noteActionText: { ...typography.support, flex: 1, color: c.textSecondary },
		noteActionTitle: { color: c.accent, fontWeight: "600" },
	});

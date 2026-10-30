import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import { guidePhase } from "@/components/guideMotion";
import { radius, spacing, typography } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { dbMessageToUIMessage, toViewMessage, type ChatViewMessage } from "@/lib/chatView";
import { normalizeAssistantMarkdown } from "@/lib/assistantMarkdown";
import { HistoryReviewCard } from "@/features/chat/HistoryReviewCard";
import { ReceiptLine } from "@/features/chat/ReceiptLine";
import { NoteMarkdown } from "./NoteMarkdown";
import { TypingDots } from "./TypingDots";

interface NoteAIMessageProps { message: ChatViewMessage; noteId: string; beforeNavigate: () => Promise<boolean>; onNavigated: () => void }
export function NoteAIMessage(props: NoteAIMessageProps) {
	const review = props.message.historyVerification;
	if (props.message.role === "assistant" && review) {
		return <HistoryReviewCard review={review} locator={{ surface: "note", parentId: props.noteId, messageId: props.message.id }}
			renderVerified={row => <NoteAIMessageContent {...props} message={toViewMessage(dbMessageToUIMessage(row), { isStreaming: false })} />} />;
	}
	return <NoteAIMessageContent {...props} />;
}
function NoteAIMessageContent({ message, beforeNavigate, onNavigated }: NoteAIMessageProps) {
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
			<SureWordGuideAvatar size={26} phase={guidePhase(Boolean(message.isStreaming), message.content)} />
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
				{message.receipts?.length ? <ReceiptLine receipts={message.receipts} beforeNavigate={beforeNavigate} onNavigated={onNavigated} /> : null}
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

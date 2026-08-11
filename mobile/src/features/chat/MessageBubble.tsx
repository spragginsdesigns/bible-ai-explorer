import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ChatViewMessage } from "@/lib/chatView";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { AddToNoteSheet } from "./AddToNoteSheet";
import { FollowUpChips } from "./FollowUpChips";
import { MarkdownBody } from "./MarkdownBody";
import { NoteActionCard } from "./NoteActionCard";
import { RetrievedVersesCard } from "./RetrievedVersesCard";
import { TypingDots } from "./TypingDots";
import { openReferenceInReader, segmentVerseReferences } from "./verseLinks";
import { WebResultsCard } from "./WebResultsCard";
import { FileAttachmentCards } from "./FileAttachmentCards";

interface MessageBubbleProps {
	message: ChatViewMessage;
	/** Only supplied for the newest assistant message. */
	onFollowUp?: (question: string) => void;
	/** Active conversation title — default title when saving to a new note. */
	defaultNoteTitle?: string;
}

export const MessageBubble = React.memo(function MessageBubble({
	message,
	onFollowUp,
	defaultNoteTitle,
}: MessageBubbleProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const [noteSheetOpen, setNoteSheetOpen] = useState(false);

	if (message.role === "user") {
		// Plain-text bubble, but Bible references still become tappable links
		// into the reader (assistant messages get this via MarkdownBody).
		const segments = segmentVerseReferences(message.content);
		return (
			<View style={styles.userRow}>
				<View style={styles.userBubble}>
					{message.attachments && message.attachments.length > 0 && (
						<View style={message.content ? styles.userFiles : undefined}>
							<FileAttachmentCards attachments={message.attachments} />
						</View>
					)}
					{message.content.length > 0 && <Text style={styles.userText}>
						{segments.map((segment, index) =>
							segment.type === "verse-ref" ? (
								<Text
									key={`ref-${index}`}
									accessibilityRole="link"
									style={styles.userRefLink}
									onPress={() => openReferenceInReader(router, segment.value)}
								>
									{segment.value}
								</Text>
							) : (
								<Text key={`text-${index}`}>{segment.value}</Text>
							)
						)}
					</Text>}
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

				{settled && message.content.length > 0 && (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Add this answer to your notes"
						onPress={() => setNoteSheetOpen(true)}
						style={({ pressed }) => [styles.addToNote, pressed && styles.addToNotePressed]}
					>
						<Text style={styles.addToNoteGlyph}>✎</Text>
						<Text style={styles.addToNoteLabel}>Add to notes</Text>
					</Pressable>
				)}

				<AddToNoteSheet
					visible={noteSheetOpen}
					markdown={message.content}
					defaultTitle={defaultNoteTitle}
					onClose={() => setNoteSheetOpen(false)}
				/>

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
});

const createStyles = (c: Colors) =>
	StyleSheet.create({
		userRow: {
			flexDirection: "row",
			justifyContent: "flex-end",
			marginBottom: spacing.xl,
		},
		userBubble: {
			maxWidth: "85%",
			backgroundColor: c.surfaceStrong,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			borderBottomRightRadius: radius.sm,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		userText: { color: c.text, fontSize: 15, lineHeight: 22 },
		userFiles: { marginBottom: spacing.sm },
		userRefLink: { color: c.accent, textDecorationLine: "underline" },
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
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			marginTop: 2,
		},
		avatarGlyph: { color: c.accent, fontSize: 14 },
		assistantBody: { flex: 1, minWidth: 0 },
		activityRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingVertical: spacing.sm,
		},
		activityLabel: { color: c.textMuted, fontSize: 13, fontStyle: "italic" },
		addToNote: {
			flexDirection: "row",
			alignItems: "center",
			alignSelf: "flex-start",
			gap: 6,
			marginTop: spacing.sm,
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		addToNotePressed: { backgroundColor: c.surfacePressed },
		addToNoteGlyph: { color: c.textFaint, fontSize: 12 },
		addToNoteLabel: { color: c.textFaint, fontSize: 12.5 },
	});

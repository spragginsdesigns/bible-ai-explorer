import React, { useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	Alert,
	Pressable,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import type { ChatViewMessage } from "@/lib/chatView";
import { normalizeAssistantMarkdown } from "@/lib/assistantMarkdown";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import {
	copyableAnswerText,
	nextFeedback,
	type AnswerFeedback,
	type SetAnswerFeedback,
} from "@/lib/answerFeedback";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { presentShareSheet, shareAnswer } from "./shareApi";
import { AddToNoteSheet } from "./AddToNoteSheet";
import { FeedbackSheet } from "./FeedbackSheet";
import { FollowUpChips } from "./FollowUpChips";
import { MarkdownBody } from "./MarkdownBody";
import { CrossActionCard } from "./CrossActionCard";
import { ReceiptLine } from "./ReceiptLine";
import { RetrievedVersesCard } from "./RetrievedVersesCard";
import { WorkActivity } from "./WorkActivity";
import { TypingDots } from "./TypingDots";
import { openReferenceInReader, segmentVerseReferences } from "./verseLinks";
import { WebResultsCard } from "./WebResultsCard";
import { FileAttachmentCards } from "./FileAttachmentCards";

interface MessageBubbleProps {
	message: ChatViewMessage;
	/** Only supplied for the newest assistant message. */
	onFollowUp?: (question: string) => void;
	/** Active conversation title - default title when saving to a new note. */
	defaultNoteTitle?: string;
	/**
	 * Rate this answer. Absent when nothing can be rated (no conversation is
	 * loaded yet), which is also what hides the thumbs.
	 */
	onFeedback?: SetAnswerFeedback;
	/**
	 * The conversation this answer belongs to, which the share route
	 * owner-checks. Null until a conversation exists (the very first question is
	 * still in flight), and that is what hides "Share" rather than letting a tap
	 * fail. Same source the thumbs use: the chat hook's active conversation.
	 */
	conversationId?: string | null;
}

export const MessageBubble = React.memo(function MessageBubble({
	message,
	onFollowUp,
	defaultNoteTitle,
	onFeedback,
	conversationId,
}: MessageBubbleProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();
	const [noteSheetOpen, setNoteSheetOpen] = useState(false);
	const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// The checkmark is the only confirmation a copy gets, so its timer has to
	// die with the bubble: a virtualized list unmounts these while the timer is
	// still pending, and firing setState afterwards is a leak and a warning.
	useEffect(
		() => () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		},
		[]
	);

	// Both parses run over the whole message body, so they are hoisted above the
	// user/assistant split to keep the hook order unconditional, and each one
	// short-circuits for the role that never uses it.
	// Plain-text user bubbles still get tappable Bible references (assistant
	// messages get theirs via MarkdownBody).
	const segments = useMemo(
		() => (message.role === "user" ? segmentVerseReferences(message.content) : null),
		[message.role, message.content],
	);
	const assistantMarkdown = useMemo(
		() =>
			message.role === "user" || !message.content
				? null
				: normalizeAssistantMarkdown(message.content, {
					streaming: Boolean(message.isStreaming),
				}),
		[message.role, message.content, message.isStreaming],
	);

	if (message.role === "user") {
		return (
			<View style={styles.userRow}>
				<View style={styles.userBubble}>
					{message.attachments && message.attachments.length > 0 && (
						<View style={message.content ? styles.userFiles : undefined}>
							<FileAttachmentCards attachments={message.attachments} />
						</View>
					)}
					{message.content.length > 0 && <Text style={styles.userText}>
						{(segments ?? []).map((segment, index) =>
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
	const chosen = message.feedback ?? null;

	// The thumb is recorded on the tap itself, so dismissing the reason sheet by
	// the backdrop still leaves the rating saved. Send then adds the reason.
	const rate = (tapped: AnswerFeedback) => {
		if (!onFeedback) return;
		const next = nextFeedback(chosen, tapped);
		onFeedback(message.id, next);
		if (next === "down") setFeedbackSheetOpen(true);
	};

	/**
	 * The answer on the clipboard, as markdown minus the follow-up markers.
	 * Nothing here touches the server, so Copy shows on every settled answer
	 * even before a conversation exists to share or rate.
	 */
	const copy = () => {
		void (async () => {
			try {
				await Clipboard.setStringAsync(copyableAnswerText(message.content));
			} catch {
				Alert.alert("Couldn't copy that", "The clipboard didn't take the answer.");
				return;
			}
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			setCopied(true);
			// The glyph swap is silent to a screen reader, so say it.
			AccessibilityInfo.announceForAccessibility("Copied");
			copiedTimer.current = setTimeout(() => setCopied(false), 1500);
		})();
	};

	/**
	 * Mint the public link, then open the system share sheet with it. Minting is
	 * idempotent server-side, so tapping Share again on an answer that has
	 * already been shared hands over the same link instead of a second one.
	 */
	const share = () => {
		if (sharing || !conversationId) return;
		setSharing(true);
		void (async () => {
			try {
				const link = await shareAnswer(getToken, conversationId, message.id);
				await presentShareSheet(link.url);
			} catch (error) {
				Alert.alert(
					"Couldn't share that",
					error instanceof Error && error.message
						? error.message
						: "The link didn't reach the server. Check your connection and try again."
				);
			} finally {
				setSharing(false);
			}
		})();
	};

	return (
		<View style={styles.assistantRow}>
			<SureWordGuideAvatar active={Boolean(message.isStreaming)} />
			<View style={styles.assistantBody}>
				{message.progress && <WorkActivity progress={message.progress} isStreaming={Boolean(message.isStreaming)} />}
				{assistantMarkdown !== null ? (
					<MarkdownBody content={assistantMarkdown} />
				) : message.isStreaming && !message.activity && !message.progress ? (
					<TypingDots />
				) : null}

				{message.isStreaming && message.activity && !message.progress && (
					<View style={styles.activityRow}>
						<ActivityIndicator size="small" color={colors.accentDim} />
						<Text style={styles.activityLabel}>{message.activity}...</Text>
					</View>
				)}

				{settled && message.content.length > 0 && (
					<View style={styles.answerActions}>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={copied ? "Answer copied" : "Copy this answer"}
							onPress={copy}
							hitSlop={6}
							style={({ pressed }) => [styles.thumb, pressed && styles.thumbPressed]}
						>
							<Ionicons
								name={copied ? "checkmark" : "copy-outline"}
								size={16}
								color={copied ? colors.accent : colors.textFaint}
							/>
						</Pressable>

						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Add this answer to your notes"
							onPress={() => setNoteSheetOpen(true)}
							hitSlop={6}
							style={({ pressed }) => [styles.thumb, pressed && styles.thumbPressed]}
						>
							<Ionicons name="create-outline" size={16} color={colors.textFaint} />
						</Pressable>

						{onFeedback && (
							<>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="This answer was helpful"
									accessibilityState={{ selected: chosen === "up" }}
									onPress={() => rate("up")}
									hitSlop={6}
									style={({ pressed }) => [styles.thumb, pressed && styles.thumbPressed]}
								>
									<Ionicons
										name={chosen === "up" ? "thumbs-up" : "thumbs-up-outline"}
										size={16}
										color={chosen === "up" ? colors.accent : colors.textFaint}
									/>
								</Pressable>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="This answer was not helpful"
									accessibilityState={{ selected: chosen === "down" }}
									onPress={() => rate("down")}
									hitSlop={6}
									style={({ pressed }) => [styles.thumb, pressed && styles.thumbPressed]}
								>
									<Ionicons
										name={chosen === "down" ? "thumbs-down" : "thumbs-down-outline"}
										size={16}
										color={chosen === "down" ? colors.accent : colors.textFaint}
									/>
								</Pressable>
							</>
						)}

						{conversationId && (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Share this answer"
								accessibilityState={{ busy: sharing, disabled: sharing }}
								disabled={sharing}
								onPress={share}
								hitSlop={6}
								style={({ pressed }) => [styles.thumb, pressed && styles.thumbPressed]}
							>
								{sharing ? (
									<ActivityIndicator size="small" color={colors.accentDim} />
								) : (
									<Ionicons name="share-outline" size={16} color={colors.textFaint} />
								)}
							</Pressable>
						)}
					</View>
				)}

				<AddToNoteSheet
					visible={noteSheetOpen}
					markdown={message.content}
					defaultTitle={defaultNoteTitle}
					onClose={() => setNoteSheetOpen(false)}
				/>

				<FeedbackSheet
					visible={feedbackSheetOpen}
					onClose={() => setFeedbackSheetOpen(false)}
					onSubmit={({ reason, tags }) => {
						setFeedbackSheetOpen(false);
						onFeedback?.(message.id, "down", reason, tags);
					}}
				/>

				{/*
				  * Every receipt of the turn, one line, each fragment navigating by its
				  * target. This replaces the old per-kind Pressables and the separate
				  * "added to note" card: the note receipt is the note affordance now.
				  */}
				{message.receipts && message.receipts.length > 0 && (
					<ReceiptLine receipts={message.receipts} />
				)}

				{message.crossActions?.map((action, index) => (
					<CrossActionCard key={`${action.reference}-${index}`} action={action} />
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
		userText: { ...typography.chat, color: c.text },
		userFiles: { marginBottom: spacing.sm },
		userRefLink: { color: c.accent, textDecorationLine: "underline" },
		assistantRow: {
			flexDirection: "row",
			gap: spacing.md,
			marginBottom: spacing.xl,
		},
		assistantBody: { flex: 1, minWidth: 0 },
		activityRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingVertical: spacing.sm,
		},
		activityLabel: { color: c.textMuted, fontSize: 13, fontStyle: "italic" },
		answerActions: {
			flexDirection: "row",
			alignItems: "center",
			alignSelf: "flex-start",
			gap: spacing.xs,
			marginTop: spacing.sm,
		},
		// One shape for every glyph in the row: icon-only, quiet, and a real 44pt
		// target whatever the 16pt icon inside it measures.
		thumb: {
			alignItems: "center",
			justifyContent: "center",
			minHeight: 44,
			minWidth: 44,
			borderRadius: radius.md,
		},
		thumbPressed: { backgroundColor: c.surfacePressed },
	});

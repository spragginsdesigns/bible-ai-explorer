import React, { useCallback, useEffect, useRef } from "react";
import { FlatList, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { ChatViewMessage } from "@/lib/chatView";
import type { SetAnswerFeedback } from "@/lib/answerFeedback";
import { spacing } from "@/theme";
import { MessageBubble } from "./MessageBubble";

/** Distance from the bottom, in px, that still counts as "following along". */
const NEAR_BOTTOM_THRESHOLD = 120;

interface MessageListProps {
	messages: ChatViewMessage[];
	onFollowUp: (question: string) => void;
	bottomInset: number;
	/** Active conversation title - default title for "Add to notes" → new note. */
	defaultNoteTitle?: string;
	/** Thumbs up / down on a settled assistant answer. */
	onFeedback?: SetAnswerFeedback;
	/** Active conversation - the share route owner-checks an answer through it. */
	conversationId?: string | null;
	children?: React.ReactNode;
}

export function MessageList({ messages, onFollowUp, bottomInset, defaultNoteTitle, onFeedback, conversationId, children }: MessageListProps) {
	const scrollRef = useRef<FlatList<ChatViewMessage>>(null);
	const nearBottom = useRef(true);
	const latestUserId = [...messages].reverse().find(message => message.role === "user")?.id;
	const previousUserId = useRef(latestUserId);

	const latestAssistantId = [...messages]
		.reverse()
		.find((message) => message.role === "assistant")?.id;

	const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
		const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
		nearBottom.current = distance <= NEAR_BOTTOM_THRESHOLD;
	}, []);

	// Growing content follows the stream, but only while the reader is at the
	// bottom — scrolling up to re-read must not get yanked back.
	const onContentSizeChange = useCallback(() => {
		if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: true });
	}, []);

	// A newly sent question always pulls the view back down.
	useEffect(() => {
		// The first activity can arrive in the same render as the user's message.
		// Follow the new user id even when an assistant row is already last.
		if (latestUserId && latestUserId !== previousUserId.current) {
			nearBottom.current = true;
			scrollRef.current?.scrollToEnd({ animated: true });
		}
		previousUserId.current = latestUserId;
	}, [latestUserId]);

	return (
		<FlatList
			ref={scrollRef}
			data={messages}
			keyExtractor={(message) => message.id}
			renderItem={({ item: message }) => (
				<MessageBubble
					message={message}
					onFollowUp={message.id === latestAssistantId ? onFollowUp : undefined}
					defaultNoteTitle={defaultNoteTitle}
					onFeedback={onFeedback}
					conversationId={conversationId}
				/>
			)}
			ListFooterComponent={children ? <>{children}</> : null}
			style={styles.list}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			onScroll={onScroll}
			onContentSizeChange={onContentSizeChange}
			scrollEventThrottle={16}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
		/>
	);
}

const styles = StyleSheet.create({
	list: { flex: 1 },
	content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
});

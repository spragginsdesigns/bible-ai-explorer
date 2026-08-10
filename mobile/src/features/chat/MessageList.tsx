import React, { useCallback, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { ChatViewMessage } from "@/lib/chatView";
import { spacing } from "@/theme";
import { MessageBubble } from "./MessageBubble";

/** Distance from the bottom, in px, that still counts as "following along". */
const NEAR_BOTTOM_THRESHOLD = 120;

interface MessageListProps {
	messages: ChatViewMessage[];
	onFollowUp: (question: string) => void;
	bottomInset: number;
	/** Active conversation title — default title for "Add to notes" → new note. */
	defaultNoteTitle?: string;
	children?: React.ReactNode;
}

export function MessageList({ messages, onFollowUp, bottomInset, defaultNoteTitle, children }: MessageListProps) {
	const scrollRef = useRef<ScrollView>(null);
	const nearBottom = useRef(true);
	const previousCount = useRef(messages.length);

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
		const last = messages[messages.length - 1];
		if (messages.length > previousCount.current && last?.role === "user") {
			nearBottom.current = true;
			scrollRef.current?.scrollToEnd({ animated: true });
		}
		previousCount.current = messages.length;
	}, [messages]);

	return (
		<ScrollView
			ref={scrollRef}
			style={styles.list}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			onScroll={onScroll}
			onContentSizeChange={onContentSizeChange}
			scrollEventThrottle={16}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
		>
			{messages.map((message) => (
				<MessageBubble
					key={message.id}
					message={message}
					onFollowUp={message.id === latestAssistantId ? onFollowUp : undefined}
					defaultNoteTitle={defaultNoteTitle}
				/>
			))}
			{children}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	list: { flex: 1 },
	content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
});

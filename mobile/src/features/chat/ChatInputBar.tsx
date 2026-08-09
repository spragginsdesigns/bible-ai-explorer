import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

interface ChatInputBarProps {
	onSend: (text: string) => void;
	onStop: () => void;
	loading: boolean;
	isStreaming: boolean;
	disabled?: boolean;
}

export function ChatInputBar({
	onSend,
	onStop,
	loading,
	isStreaming,
	disabled = false,
}: ChatInputBarProps) {
	const [text, setText] = useState("");
	const busy = loading || isStreaming;
	const locked = busy || disabled;

	const submit = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || locked) return;
		setText("");
		onSend(trimmed);
	}, [locked, onSend, text]);

	return (
		<View style={styles.bar}>
			<TextInput
				value={text}
				onChangeText={setText}
				editable={!locked}
				multiline
				placeholder="Ask a question about the Bible..."
				placeholderTextColor={colors.textGhost}
				style={styles.input}
				submitBehavior="newline"
			/>
			{busy ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Stop generating"
					onPress={onStop}
					style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surfacePressed }]}
				>
					<ActivityIndicator size="small" color={colors.accentDim} />
				</Pressable>
			) : (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Send"
					disabled={!text.trim() || locked}
					onPress={submit}
					style={({ pressed }) => [
						styles.action,
						styles.send,
						pressed && { backgroundColor: colors.accentPressed },
						(!text.trim() || locked) && styles.sendDisabled,
					]}
				>
					<Text style={styles.sendGlyph}>↑</Text>
				</Pressable>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	bar: {
		flexDirection: "row",
		alignItems: "flex-end",
		gap: spacing.sm,
		padding: spacing.sm,
		paddingLeft: spacing.lg,
		backgroundColor: colors.glassLight,
		borderColor: colors.borderStrong,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.xl,
	},
	input: {
		flex: 1,
		maxHeight: 140,
		paddingTop: spacing.md,
		paddingBottom: spacing.md,
		color: colors.text,
		fontSize: 15,
		lineHeight: 21,
	},
	action: {
		width: 40,
		height: 40,
		borderRadius: radius.full,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
	},
	send: {
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
	},
	sendDisabled: { opacity: 0.35 },
	sendGlyph: { color: colors.accent, fontSize: 18, fontWeight: "700", lineHeight: 20 },
});

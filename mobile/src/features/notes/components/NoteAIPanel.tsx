import React, { useRef, useState } from "react";
import {
	KeyboardAvoidingView,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import {
	NOTE_SLASH_COMMANDS,
	matchSlashCommands,
	parseSlashCommand,
} from "@/features/chat/slashCommands";
import { ErrorCard } from "@/features/chat/ErrorCard";
import { useNoteAI, type NoteAppendEvent } from "../useNoteAI";
import { NoteAIMessage } from "./NoteAIMessage";
import { GlyphButton } from "./primitives";

const SUGGEST_VERSES_PROMPT =
	"Suggest the most relevant KJV Bible verses for this note and explain how each relates to the content.";

/** Slide-up per-note chat. Renders as a Modal so it clears the app tab bar. */
export function NoteAIPanel({
	noteId,
	visible,
	onClose,
	onNoteAppended,
}: {
	noteId: string;
	visible: boolean;
	onClose: () => void;
	onNoteAppended: (event: NoteAppendEvent) => void;
}) {
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { messages, isStreaming, loading, error, sendMessage, clearHistory, retry } = useNoteAI(
		noteId,
		{ onNoteAppended }
	);
	const [input, setInput] = useState("");
	const scrollRef = useRef<ScrollView>(null);

	const busy = loading || isStreaming;
	const suggestions = matchSlashCommands(input, NOTE_SLASH_COMMANDS);

	const handleSend = () => {
		const text = input.trim();
		if (!text || busy) return;

		const parsed = parseSlashCommand(text, NOTE_SLASH_COMMANDS);
		if (parsed) {
			if (parsed.def.requiresArgs && !parsed.args) return;
			setInput("");
			if (parsed.def.localAction === "suggest") {
				sendMessage(SUGGEST_VERSES_PROMPT);
			} else if (parsed.def.localAction === "clear-note-chat") {
				void clearHistory();
			} else {
				sendMessage(parsed.args ? `${parsed.def.command} ${parsed.args}` : parsed.def.command);
			}
			return;
		}

		setInput("");
		sendMessage(text);
	};

	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			statusBarTranslucent
			onRequestClose={onClose}
		>
			<View style={styles.root}>
				<Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close AI panel" />

				<KeyboardAvoidingView
					behavior="padding"
					style={styles.panel}
				>
					<View style={styles.header}>
						<GlyphButton icon="chevron-down" accessibilityLabel="Close AI panel" onPress={onClose} size={32} />
						<View style={styles.headerTitle}>
							<Text style={styles.headerGlyph}>✦</Text>
							<Text style={styles.headerLabel}>AI Assistant</Text>
						</View>
						{messages.length > 0 ? (
							<GlyphButton
								icon="trash-outline"
								accessibilityLabel="Clear conversation"
								onPress={() => void clearHistory()}
								size={32}
							/>
						) : (
							<View style={styles.headerSpacer} />
						)}
					</View>

					<ScrollView
						ref={scrollRef}
						style={styles.messages}
						contentContainerStyle={styles.messagesContent}
						keyboardShouldPersistTaps="handled"
						onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
					>
						{messages.length === 0 ? (
							<View style={styles.empty}>
								<Text style={styles.emptyGlyph}>✦</Text>
								<Text style={styles.emptyTitle}>Ask about your note</Text>
								<Text style={styles.emptyBody}>
									The AI can see this note and can write Scripture straight into it.
								</Text>
								<Pressable
									accessibilityRole="button"
									onPress={() => sendMessage(SUGGEST_VERSES_PROMPT)}
									disabled={busy}
									style={({ pressed }) => [
										styles.suggestButton,
										pressed && { backgroundColor: colors.accentPressed },
										busy && { opacity: 0.4 },
									]}
								>
									<Text style={styles.suggestLabel}>✦  Suggest Verses</Text>
								</Pressable>
							</View>
						) : (
							<>
									{messages.map((message) => (
										<NoteAIMessage key={message.id} message={message} />
									))}
									{error ? (
										<ErrorCard
											message={`Something went wrong: ${error}`}
											retryLabel="Try again"
											onRetry={retry}
										/>
									) : null}
								</>
						)}
					</ScrollView>

					{messages.length > 0 ? (
						<Pressable
							accessibilityRole="button"
							onPress={() => sendMessage(SUGGEST_VERSES_PROMPT)}
							disabled={busy}
							style={styles.suggestInline}
						>
							<Text style={[styles.suggestInlineLabel, busy && { opacity: 0.4 }]}>
								✦  Suggest Verses
							</Text>
						</Pressable>
					) : null}

					{suggestions.length > 0 && !busy && (
						<View style={styles.palette}>
							{suggestions.map((def) => (
								<Pressable
									key={def.command}
									accessibilityRole="button"
									onPress={() => {
										if (def.requiresArgs || def.hint) {
											setInput(`${def.command} `);
										} else {
											setInput(`${def.command}`);
										}
									}}
									style={({ pressed }) => [
										styles.paletteRow,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.paletteCommand}>
										{def.command}
										{def.hint ? <Text style={styles.paletteHint}> {def.hint}</Text> : null}
									</Text>
									<Text style={styles.paletteDescription} numberOfLines={1}>
										{def.description}
									</Text>
								</Pressable>
							))}
						</View>
					)}

					<View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
						<TextInput
							value={input}
							onChangeText={setInput}
							placeholder="Ask about your note…"
							placeholderTextColor={colors.textGhost}
							multiline
							style={styles.input}
						/>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Send"
							onPress={handleSend}
							disabled={!input.trim() || busy}
							style={({ pressed }) => [
								styles.send,
								pressed && { backgroundColor: colors.accentPressed },
								(!input.trim() || busy) && { opacity: 0.35 },
							]}
						>
							<Text style={styles.sendGlyph}>↑</Text>
						</Pressable>
					</View>
				</KeyboardAvoidingView>
			</View>
		</Modal>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		root: { flex: 1, justifyContent: "flex-end" },
		backdrop: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			backgroundColor: "rgba(0,0,0,0.7)",
		},
		panel: {
			height: "85%",
			backgroundColor: c.bgElevated,
			borderTopLeftRadius: radius.xl,
			borderTopRightRadius: radius.xl,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			overflow: "hidden",
		},

		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
		},
		headerTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
		headerGlyph: { color: c.accent, fontSize: 13 },
		headerLabel: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
		headerSpacer: { width: 32 },

		messages: { flex: 1 },
		messagesContent: { padding: spacing.lg, paddingBottom: spacing.sm, flexGrow: 1 },

		empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: spacing.xl },
		emptyGlyph: { color: c.accentDim, fontSize: 28, marginBottom: spacing.sm },
		emptyTitle: { color: c.textMuted, fontSize: 14, fontWeight: "600" },
		emptyBody: { ...typography.support, color: c.textGhost, textAlign: "center" },
		suggestButton: {
			marginTop: spacing.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: 10,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderWidth: 1,
			borderColor: c.accentBorder,
		},
		suggestLabel: { color: c.accent, fontSize: 13, fontWeight: "600" },
		suggestInline: { paddingHorizontal: spacing.lg, paddingBottom: 6 },
		suggestInlineLabel: { ...typography.meta, color: c.accentDim },

		palette: {
			marginHorizontal: spacing.md,
			marginBottom: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			overflow: "hidden",
		},
		paletteRow: {
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
		},
		paletteCommand: { color: c.accent, fontSize: 13, fontWeight: "600" },
		paletteHint: { color: c.textFaint, fontWeight: "400" },
		paletteDescription: { ...typography.meta, color: c.textMuted, marginTop: 1 },

		inputBar: {
			flexDirection: "row",
			alignItems: "flex-end",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingTop: spacing.md,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		input: {
			flex: 1,
			maxHeight: 110,
			minHeight: 42,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
			paddingTop: 11,
			paddingBottom: 11,
			color: c.text,
			fontSize: 14,
		},
		send: {
			width: 42,
			height: 42,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderWidth: 1,
			borderColor: c.accentBorder,
		},
		sendGlyph: { color: c.accent, fontSize: 18, fontWeight: "700" },
	});

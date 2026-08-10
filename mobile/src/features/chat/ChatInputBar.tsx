import React, { useCallback, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { colors, radius, spacing } from "@/theme";
import {
	matchSlashCommands,
	parseSlashCommand,
	type LocalCommandAction,
	type SlashCommand,
} from "./slashCommands";

interface ChatInputBarProps {
	onSend: (text: string) => void;
	onStop: () => void;
	loading: boolean;
	isStreaming: boolean;
	disabled?: boolean;
	placeholder?: string;
	commands?: SlashCommand[];
	onLocalCommand?: (action: LocalCommandAction, args: string) => void;
}

export function ChatInputBar({
	onSend,
	onStop,
	loading,
	isStreaming,
	disabled = false,
	placeholder = "Ask a question about the Bible...",
	commands = [],
	onLocalCommand,
}: ChatInputBarProps) {
	const [text, setText] = useState("");
	const busy = loading || isStreaming;
	const locked = busy || disabled;

	const suggestions = useMemo(
		() => (commands.length > 0 ? matchSlashCommands(text, commands) : []),
		[text, commands]
	);

	const runCommand = useCallback(
		(def: SlashCommand, args: string) => {
			if (def.kind === "local" && def.localAction) {
				onLocalCommand?.(def.localAction, args);
				return;
			}
			onSend(args ? `${def.command} ${args}` : def.command);
		},
		[onLocalCommand, onSend]
	);

	const selectSuggestion = useCallback(
		(def: SlashCommand) => {
			if (def.requiresArgs || def.hint) {
				setText(`${def.command} `);
				return;
			}
			setText("");
			runCommand(def, "");
		},
		[runCommand]
	);

	const submit = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || locked) return;

		const parsed = commands.length > 0 ? parseSlashCommand(trimmed, commands) : null;
		if (parsed) {
			if (parsed.def.requiresArgs && !parsed.args) return; // keep typing the argument
			setText("");
			runCommand(parsed.def, parsed.args);
			return;
		}

		setText("");
		onSend(trimmed);
	}, [commands, locked, onSend, runCommand, text]);

	return (
		<View style={styles.wrap}>
			{suggestions.length > 0 && !locked && (
				<View style={styles.palette}>
					<ScrollView keyboardShouldPersistTaps="always" style={styles.paletteScroll}>
						{suggestions.map((def) => (
							<Pressable
								key={def.command}
								accessibilityRole="button"
								onPress={() => selectSuggestion(def)}
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
					</ScrollView>
				</View>
			)}

			<View style={styles.bar}>
				<TextInput
					value={text}
					onChangeText={setText}
					editable={!locked}
					multiline
					placeholder={placeholder}
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
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { position: "relative" },
	palette: {
		position: "absolute",
		bottom: "100%",
		left: 0,
		right: 0,
		marginBottom: spacing.sm,
		backgroundColor: colors.bgElevated,
		borderColor: colors.borderStrong,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.lg,
		overflow: "hidden",
	},
	paletteScroll: { maxHeight: 264 },
	paletteRow: {
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	paletteCommand: { color: colors.accent, fontSize: 14, fontWeight: "600" },
	paletteHint: { color: colors.textFaint, fontWeight: "400" },
	paletteDescription: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },

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

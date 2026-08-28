import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ActivityIndicator,
	Keyboard,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import PasteInput, {
	type PastedFile,
	type PasteTextInputInstance,
} from "@mattermost/react-native-paste-input";
import { Ionicons } from "@expo/vector-icons";
import { fonts, radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import {
	matchSlashCommands,
	parseSlashCommand,
	type LocalCommandAction,
	type SlashCommand,
} from "./slashCommands";
import type { VerseAttachment } from "./verseActions";
import type { ChatAttachmentDescriptor } from "./fileAttachments";
import type { PastedImageFile } from "./pastedImages";
import { FileAttachmentCards } from "./FileAttachmentCards";
import { AttachmentSourceSheet } from "./AttachmentSourceSheet";
import { ErrorCard } from "./ErrorCard";

interface ChatInputBarProps {
	onSend: (text: string) => void;
	onStop: () => void;
	loading: boolean;
	isStreaming: boolean;
	disabled?: boolean;
	placeholder?: string;
	commands?: SlashCommand[];
	onLocalCommand?: (action: LocalCommandAction, args: string) => void;
	/** Verse/chapter context attached to the next message (dismissible pill). */
	attachment?: VerseAttachment | null;
	onClearAttachment?: () => void;
	fileAttachments?: ChatAttachmentDescriptor[];
	uploadingAttachments?: boolean;
	attachmentError?: string | null;
	onTakePhoto?: () => void;
	onChooseImages?: () => void;
	onChooseFiles?: () => void;
	onPasteImage?: () => void;
	onPasteImages?: (files: PastedImageFile[], error?: string) => void;
	onRemoveFileAttachment?: (id: string) => void;
	/** Controlled mode: when both are provided they replace the internal state. */
	value?: string;
	onChangeText?: (text: string) => void;
	/** Bump this number to focus the input (e.g. after a ?prompt= prefill). */
	focusSignal?: number;
	/** Art-forward treatment used on the empty welcome screen. */
	prominent?: boolean;
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
	attachment = null,
	onClearAttachment,
	fileAttachments = [],
	uploadingAttachments = false,
	attachmentError = null,
	onTakePhoto,
	onChooseImages,
	onChooseFiles,
	onPasteImage,
	onPasteImages,
	onRemoveFileAttachment,
	value,
	onChangeText,
	focusSignal,
	prominent = false,
}: ChatInputBarProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [innerText, setInnerText] = useState("");
	const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
	const inputRef = useRef<PasteTextInputInstance>(null);
	const text = value ?? innerText;
	const setText = useCallback(
		(next: string) => {
			if (onChangeText) onChangeText(next);
			else setInnerText(next);
		},
		[onChangeText],
	);
	const generating = loading || isStreaming;
	const locked = generating || uploadingAttachments || disabled;

	useEffect(() => {
		if (focusSignal) inputRef.current?.focus();
	}, [focusSignal]);

	const suggestions = useMemo(
		() => (commands.length > 0 ? matchSlashCommands(text, commands) : []),
		[text, commands],
	);

	const runCommand = useCallback(
		(def: SlashCommand, args: string) => {
			if (def.kind === "local" && def.localAction) {
				onLocalCommand?.(def.localAction, args);
				return;
			}
			onSend(args ? `${def.command} ${args}` : def.command);
		},
		[onLocalCommand, onSend],
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
		[runCommand],
	);

	const submit = useCallback(() => {
		const trimmed = text.trim();
		if ((!trimmed && !attachment && fileAttachments.length === 0) || locked)
			return;

		const parsed =
			commands.length > 0 ? parseSlashCommand(trimmed, commands) : null;
		if (parsed) {
			if (parsed.def.requiresArgs && !parsed.args) return; // keep typing the argument
			setText("");
			runCommand(parsed.def, parsed.args);
			return;
		}

		setText("");
		onSend(trimmed);
	}, [
		attachment,
		commands,
		fileAttachments.length,
		locked,
		onSend,
		runCommand,
		text,
	]);

	const canSend =
		Boolean(text.trim()) || Boolean(attachment) || fileAttachments.length > 0;

	const showAttachmentMenu = useCallback(() => {
		Keyboard.dismiss();
		setAttachmentMenuVisible(true);
	}, []);

	const handleNativePaste = useCallback((error: string | null | undefined, files: PastedFile[]) => {
		if (error) {
			onPasteImages?.([], error);
			return;
		}
		if (files.length > 0) onPasteImages?.(files);
	}, [onPasteImages]);

	return (
		<View style={styles.wrap}>
			<AttachmentSourceSheet
				visible={attachmentMenuVisible}
				onClose={() => setAttachmentMenuVisible(false)}
				onTakePhoto={onTakePhoto}
				onChooseImages={onChooseImages}
				onChooseFiles={onChooseFiles}
				onPasteImage={onPasteImage}
			/>
			{attachment && (
				<View style={styles.pill}>
					<Text style={styles.pillGlyph}>✦</Text>
					<Text style={styles.pillLabel} numberOfLines={1}>
						{attachment.reference} · {attachment.translation}
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Remove attachment"
						onPress={onClearAttachment}
						hitSlop={8}
						style={({ pressed }) => pressed && { opacity: 0.6 }}
					>
						<Text style={styles.pillClose}>×</Text>
					</Pressable>
				</View>
			)}
			{fileAttachments.length > 0 && (
				<View style={styles.files}>
					<FileAttachmentCards
						attachments={fileAttachments}
						onRemove={onRemoveFileAttachment}
					/>
				</View>
			)}
			{attachmentError && (
				<ErrorCard message={attachmentError} />
			)}
			{suggestions.length > 0 && !locked && (
				<View style={styles.palette}>
					<ScrollView
						keyboardShouldPersistTaps="always"
						style={styles.paletteScroll}
					>
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
									{def.hint ? (
										<Text style={styles.paletteHint}> {def.hint}</Text>
									) : null}
								</Text>
								<Text style={styles.paletteDescription} numberOfLines={1}>
									{def.description}
								</Text>
							</Pressable>
						))}
					</ScrollView>
				</View>
			)}

			<View style={[styles.bar, prominent && styles.barProminent]}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Add an attachment"
					disabled={locked}
					onPress={showAttachmentMenu}
					style={({ pressed }) => [
						styles.action,
						pressed && { backgroundColor: colors.surfacePressed },
						locked && styles.sendDisabled,
					]}
				>
					{uploadingAttachments ? (
						<ActivityIndicator size="small" color={colors.accentDim} />
					) : (
						<Ionicons name="attach" size={21} color={colors.accent} />
					)}
				</Pressable>
				<PasteInput
					ref={inputRef}
					value={text}
					onChangeText={setText}
					onPaste={handleNativePaste}
					editable={!locked}
					multiline
					placeholder={placeholder}
					placeholderTextColor={colors.textGhost}
					style={[styles.inputWrapper, styles.input]}
					submitBehavior="newline"
				/>
				{generating ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Stop generating"
						onPress={onStop}
						style={({ pressed }) => [
							styles.action,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<ActivityIndicator size="small" color={colors.accentDim} />
					</Pressable>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Send"
						disabled={!canSend || locked}
						onPress={submit}
						style={({ pressed }) => [
							styles.action,
							styles.send,
							pressed && { backgroundColor: colors.accentPressed },
							(!canSend || locked) && styles.sendDisabled,
						]}
					>
						<Ionicons name="arrow-up" size={19} color={colors.accent} />
					</Pressable>
				)}
			</View>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		wrap: { position: "relative" },
		pill: {
			flexDirection: "row",
			alignItems: "center",
			alignSelf: "flex-start",
			maxWidth: "100%",
			gap: spacing.sm,
			marginBottom: spacing.sm,
			paddingLeft: spacing.md,
			paddingRight: spacing.sm,
			paddingVertical: spacing.xs,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.full,
		},
		pillGlyph: { color: c.accent, fontSize: 11 },
		pillLabel: {
			flexShrink: 1,
			color: c.accent,
			fontSize: 12.5,
			fontFamily: fonts.sans,
			fontWeight: "600",
		},
		pillClose: {
			color: c.textMuted,
			fontSize: 15,
			lineHeight: 16,
			paddingHorizontal: 2,
		},
		files: { marginBottom: spacing.sm },
		palette: {
			position: "absolute",
			bottom: "100%",
			left: 0,
			right: 0,
			marginBottom: spacing.sm,
			backgroundColor: c.bgElevated,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			overflow: "hidden",
		},
		paletteScroll: { maxHeight: 264 },
		paletteRow: {
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
		},
		paletteCommand: { color: c.accent, fontSize: 14, fontWeight: "600" },
		paletteHint: { color: c.textFaint, fontWeight: "400" },
		paletteDescription: { color: c.textMuted, fontSize: 12.5, marginTop: 2 },

		bar: {
			flexDirection: "row",
			alignItems: "flex-end",
			gap: spacing.sm,
			padding: spacing.sm,
			paddingLeft: spacing.lg,
			backgroundColor: c.surfaceStrong,
			borderColor: c.borderStrong,
			borderWidth: 1,
			borderRadius: radius.xl,
			// A restrained light halo separates the composer from the black canvas.
			boxShadow: [
				{
					offsetX: 0,
					offsetY: 0,
					blurRadius: 10,
					spreadDistance: 0,
					color: c.borderStrong,
				},
			],
		},
		barProminent: {
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		input: {
			paddingTop: spacing.md,
			paddingBottom: spacing.md,
			backgroundColor: "transparent",
			color: c.text,
			fontSize: 15,
			lineHeight: 21,
		},
		inputWrapper: {
			flex: 1,
			minHeight: 45,
			maxHeight: 140,
		},
		action: {
			width: 40,
			height: 40,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		send: {
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
		},
		sendDisabled: { opacity: 0.35 },
	});

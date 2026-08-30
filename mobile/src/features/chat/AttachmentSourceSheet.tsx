import React, { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/features/notes/components/primitives";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useThemedStyles, useTheme } from "@/features/settings/settingsStore";

interface AttachmentSourceSheetProps {
	visible: boolean;
	onClose: () => void;
	onTakePhoto?: () => void;
	onChooseImages?: () => void;
	onChooseFiles?: () => void;
	onPasteImage?: () => void;
}

type SourceOptionProps = {
	icon: React.ComponentProps<typeof Ionicons>["name"];
	label: string;
	detail: string;
	action?: () => void;
	onSelect: (action?: () => void) => void;
};

function SourceOption({ icon, label, detail, action, onSelect }: SourceOptionProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={() => onSelect(action)}
			style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
		>
			<View style={styles.optionIcon}>
				<Ionicons name={icon} size={21} color={colors.accent} />
			</View>
			<View style={styles.optionCopy}>
				<Text style={styles.optionLabel}>{label}</Text>
				<Text style={styles.optionDetail}>{detail}</Text>
			</View>
			<Ionicons name="chevron-forward" size={18} color={colors.textGhost} />
		</Pressable>
	);
}

export function AttachmentSourceSheet({
	visible,
	onClose,
	onTakePhoto,
	onChooseImages,
	onChooseFiles,
	onPasteImage,
}: AttachmentSourceSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	const choose = useCallback(
		(action?: () => void) => {
			onClose();
			if (action) setTimeout(action, 220);
		},
		[onClose],
	);

	return (
		<BottomSheet visible={visible} onClose={onClose}>
			<View style={styles.header}>
				<View style={styles.headerCopy}>
					<Text style={styles.eyebrow}>ADD TO YOUR MESSAGE</Text>
					<Text style={styles.title}>Choose an attachment</Text>
					<Text style={styles.subtitle}>
						Photos, screenshots, documents, and text files
					</Text>
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Close attachment menu"
					onPress={onClose}
					style={({ pressed }) => [
						styles.close,
						pressed && styles.closePressed,
					]}
				>
					<Ionicons name="close" size={20} color={colors.textMuted} />
				</Pressable>
			</View>

			<View style={styles.options}>
				<SourceOption
					icon="camera-outline"
					label="Take a photo"
					detail="Use your camera"
					action={onTakePhoto}
					onSelect={choose}
				/>
				<SourceOption
					icon="images-outline"
					label="Photo library"
					detail="Choose one or more images"
					action={onChooseImages}
					onSelect={choose}
				/>
				<SourceOption
					icon="document-attach-outline"
					label="Choose files"
					detail="PDF, text, Markdown, CSV, or JSON"
					action={onChooseFiles}
					onSelect={choose}
				/>
				<SourceOption
					icon="clipboard-outline"
					label="Paste screenshot"
					detail="Use the image on your clipboard"
					action={onPasteImage}
					onSelect={choose}
				/>
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: spacing.md,
			marginBottom: spacing.lg,
		},
		headerCopy: { flex: 1, minWidth: 0 },
		eyebrow: {
			...typography.meta,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginBottom: spacing.xs,
		},
		title: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: "700" },
		subtitle: {
			...typography.support,
			color: c.textFaint,
			marginTop: 3,
		},
		close: {
			width: 38,
			height: 38,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		closePressed: { backgroundColor: c.surfacePressed },
		options: { gap: spacing.sm, paddingBottom: spacing.sm },
		option: {
			minHeight: 68,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		optionPressed: {
			backgroundColor: c.surfacePressed,
			borderColor: c.accentBorder,
		},
		optionIcon: {
			width: 42,
			height: 42,
			borderRadius: radius.md,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		optionCopy: { flex: 1, minWidth: 0 },
		optionLabel: { color: c.textSecondary, fontSize: 14.5, fontWeight: "600" },
		optionDetail: {
			...typography.meta,
			color: c.textFaint,
			marginTop: 2,
		},
	});

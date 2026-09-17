import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { BottomSheet } from "@/features/notes/components/primitives";
import {
	FEEDBACK_REASON_MAX_LENGTH,
	FEEDBACK_TAGS,
	type FeedbackTagId,
} from "@/lib/answerFeedback";

/** What Send hands back: the chips tapped, in tap order, plus the free note. */
export interface FeedbackDetails {
	tags: FeedbackTagId[];
	/** Trimmed, and empty when the user only tapped chips. */
	reason: string;
}

interface FeedbackSheetProps {
	visible: boolean;
	/** Send only. The thumb itself is already recorded by the time this opens. */
	onSubmit: (details: FeedbackDetails) => void;
	onClose: () => void;
}

/**
 * What went wrong, after a thumbs down. Skipping is a first-class answer: the
 * rating is already saved, and this only ever adds the detail a person reads
 * later when deciding whether the answer becomes an eval fixture
 * (docs/FEATURES.md, "Answer feedback").
 *
 * The chips carry most of the signal because they are comparable across
 * answers; the free line stays for the case no chip names.
 */
export function FeedbackSheet({ visible, onSubmit, onClose }: FeedbackSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [reason, setReason] = useState("");
	const [tags, setTags] = useState<FeedbackTagId[]>([]);

	// Fresh field and chips every time it opens - an answer's reason is its own.
	useEffect(() => {
		if (visible) {
			setReason("");
			setTags([]);
		}
	}, [visible]);

	const trimmed = reason.trim();
	const canSend = tags.length > 0 || trimmed.length > 0;

	// Tap order is kept rather than the list's order: it is what the user
	// reached for first, and the server preserves the order it is given.
	const toggleTag = (id: FeedbackTagId) => {
		setTags((current) =>
			current.includes(id) ? current.filter((tag) => tag !== id) : [...current, id]
		);
	};

	const submit = () => onSubmit({ tags, reason: trimmed });

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Thanks for saying so">
			<Text style={styles.blurb}>
				What went wrong? Pick any that apply, add a note if you like.
			</Text>
			<View style={styles.chips}>
				{FEEDBACK_TAGS.map((tag) => {
					const selected = tags.includes(tag.id);
					return (
						<Pressable
							key={tag.id}
							accessibilityRole="button"
							accessibilityLabel={tag.label}
							accessibilityState={{ selected }}
							onPress={() => toggleTag(tag.id)}
							style={({ pressed }) => [
								styles.chip,
								selected && styles.chipSelected,
								pressed && !selected && styles.chipPressed,
							]}
						>
							<Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
								{tag.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
			{/*
			  * No autoFocus any more: the chips are the primary answer, and a
			  * keyboard raised on open covers them and the Send row.
			  */}
			<TextInput
				value={reason}
				onChangeText={setReason}
				placeholder="Anything else? (optional)"
				placeholderTextColor={colors.textGhost}
				maxLength={FEEDBACK_REASON_MAX_LENGTH}
				returnKeyType="send"
				onSubmitEditing={() => (canSend ? submit() : onClose())}
				style={styles.input}
			/>
			<View style={styles.actions}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Skip the reason"
					onPress={onClose}
					style={({ pressed }) => [styles.skip, pressed && styles.skipPressed]}
				>
					<Text style={styles.skipLabel}>Skip</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Send the reason"
					accessibilityState={{ disabled: !canSend }}
					disabled={!canSend}
					onPress={submit}
					style={({ pressed }) => [
						styles.send,
						pressed && styles.sendPressed,
						!canSend && styles.dimmed,
					]}
				>
					<Text style={styles.sendLabel}>Send</Text>
				</Pressable>
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		blurb: { ...typography.support, color: c.textFaint, marginBottom: spacing.md },
		chips: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			marginBottom: spacing.md,
		},
		chip: {
			minHeight: 36,
			justifyContent: "center",
			paddingHorizontal: spacing.md,
			borderRadius: radius.full,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
		},
		chipPressed: { backgroundColor: c.surfacePressed },
		chipSelected: {
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
		},
		chipLabel: { color: c.textFaint, fontSize: 13 },
		chipLabelSelected: { color: c.accent, fontWeight: "600" },
		input: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 10,
			color: c.text,
			fontSize: 14,
		},
		actions: {
			flexDirection: "row",
			justifyContent: "flex-end",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.md,
		},
		skip: {
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			borderRadius: radius.md,
		},
		skipPressed: { backgroundColor: c.surfacePressed },
		skipLabel: { color: c.textFaint, fontSize: 14 },
		send: {
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		sendPressed: { backgroundColor: c.accentPressed },
		sendLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		dimmed: { opacity: 0.5 },
	});

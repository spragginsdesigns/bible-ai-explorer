import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/features/notes/components/primitives";
import { radius, spacing, type Colors } from "@/theme";
import {
	setChatEffort,
	setChatModel,
	useSettings,
	useTheme,
	useThemedStyles,
} from "@/features/settings/settingsStore";
import { fetchAiModels, PROVIDER_LABELS, type AiModelsResponse } from "@/features/settings/aiApi";
import type { GetToken } from "@/lib/api";

interface ModelPickerSheetProps {
	visible: boolean;
	onClose: () => void;
	getToken: GetToken;
}

const EFFORT_OPTIONS: { id: string | null; label: string }[] = [
	{ id: null, label: "Auto" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
];

/**
 * Model + reasoning-effort picker, mirroring the web chat's picker. Models
 * whose provider has no API key on the account are locked and point at
 * Settings → AI Providers. Picks persist locally and ride every chat request;
 * the server stores the last pick as the account default.
 */
export function ModelPickerSheet({ visible, onClose, getToken }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { chatModelId, chatEffort } = useSettings();
	const [data, setData] = useState<AiModelsResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	const load = useCallback(async () => {
		setLoadFailed(false);
		try {
			setData(await fetchAiModels(getToken));
		} catch {
			setLoadFailed(true);
		}
	}, [getToken]);

	useEffect(() => {
		if (visible && !data) void load();
	}, [visible, data, load]);

	const selectedId =
		data && data.models.some((model) => model.id === chatModelId && model.available)
			? chatModelId
			: data?.defaults.modelId ?? null;

	return (
		<BottomSheet visible={visible} onClose={onClose}>
			<View style={styles.header}>
				<View style={styles.headerCopy}>
					<Text style={styles.eyebrow}>AI MODEL</Text>
					<Text style={styles.title}>Choose a model</Text>
					<Text style={styles.subtitle}>
						Unlock more models by adding API keys in Settings
					</Text>
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Close model picker"
					onPress={onClose}
					style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
				>
					<Ionicons name="close" size={20} color={colors.textMuted} />
				</Pressable>
			</View>

			{loadFailed ? (
				<View style={styles.centerBox}>
					<Text style={styles.subtitle}>Couldn&apos;t load the model list.</Text>
					<Pressable accessibilityRole="button" onPress={() => void load()} hitSlop={8}>
						<Text style={styles.retry}>Retry</Text>
					</Pressable>
				</View>
			) : !data ? (
				<View style={styles.centerBox}>
					<ActivityIndicator color={colors.accent} />
				</View>
			) : (
				<>
					<ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
						{data.models.map((model) => {
							const active = model.id === selectedId;
							return (
								<Pressable
									key={model.id}
									accessibilityRole="button"
									accessibilityState={{ selected: active, disabled: !model.available }}
									disabled={!model.available}
									onPress={() => {
										setChatModel(model.id);
										onClose();
									}}
									style={({ pressed }) => [
										styles.row,
										active && styles.rowActive,
										pressed && { backgroundColor: colors.surfacePressed },
										!model.available && styles.rowLocked,
									]}
								>
									<View style={styles.rowCopy}>
										<Text style={[styles.rowLabel, active && { color: colors.accent }]}>
											{model.label}
										</Text>
										<Text style={styles.rowDetail}>
											{model.available
												? PROVIDER_LABELS[model.provider] ?? model.provider
												: `Add your ${PROVIDER_LABELS[model.provider] ?? model.provider} key in Settings`}
										</Text>
									</View>
									{model.available ? (
										active && <Ionicons name="checkmark" size={18} color={colors.accent} />
									) : (
										<Ionicons name="lock-closed-outline" size={16} color={colors.textGhost} />
									)}
								</Pressable>
							);
						})}
					</ScrollView>
					<View style={styles.effortBlock}>
						<Text style={styles.effortLabel}>REASONING</Text>
						<View style={styles.effortRow}>
							{EFFORT_OPTIONS.map((option) => {
								const active = chatEffort === option.id || (!chatEffort && option.id === null);
								return (
									<Pressable
										key={option.label}
										accessibilityRole="button"
										accessibilityState={{ selected: active }}
										onPress={() => setChatEffort(option.id)}
										style={({ pressed }) => [
											styles.effortChip,
											active && styles.effortChipActive,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<Text style={[styles.effortChipLabel, active && { color: colors.accent }]}>
											{option.label}
										</Text>
									</Pressable>
								);
							})}
						</View>
					</View>
				</>
			)}
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
			color: c.accent,
			fontSize: 10,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginBottom: spacing.xs,
		},
		title: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: "700" },
		subtitle: { color: c.textFaint, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
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
		centerBox: {
			minHeight: 120,
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.md,
			paddingBottom: spacing.lg,
		},
		retry: { color: c.accent, fontSize: 13, fontWeight: "700" },
		list: { maxHeight: 320 },
		row: {
			minHeight: 62,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			marginBottom: spacing.sm,
		},
		rowActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		rowLocked: { opacity: 0.55 },
		rowCopy: { flex: 1, minWidth: 0 },
		rowLabel: { color: c.textSecondary, fontSize: 14.5, fontWeight: "600" },
		rowDetail: { color: c.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
		effortBlock: {
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
			paddingTop: spacing.md,
			paddingBottom: spacing.sm,
			gap: spacing.sm,
		},
		effortLabel: {
			color: c.textFaint,
			fontSize: 10,
			fontWeight: "700",
			letterSpacing: 1.2,
		},
		effortRow: { flexDirection: "row", gap: spacing.sm },
		effortChip: {
			flex: 1,
			minHeight: 40,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		effortChipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		effortChipLabel: { color: c.textMuted, fontSize: 12.5, fontWeight: "700" },
	});

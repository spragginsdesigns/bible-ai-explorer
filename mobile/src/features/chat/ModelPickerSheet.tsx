import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
	fetchAiModels,
	PROVIDER_LABELS,
	type AiModelsResponse,
	type AiProviderSummary,
} from "@/features/settings/aiApi";
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
 * Model + reasoning-effort picker, mirroring the web chat's picker: providers
 * first, tap one to see every model its API key unlocks (listed live by the
 * server from the provider). Providers with no key on the account are locked
 * and point at Settings → AI Providers. Picks persist locally and ride every
 * chat request; the server stores the last pick as the account default.
 */
export function ModelPickerSheet({ visible, onClose, getToken }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { chatModelId, chatEffort } = useSettings();
	const [data, setData] = useState<AiModelsResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);

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

	const providers = useMemo<AiProviderSummary[]>(() => {
		if (!data) return [];
		if (data.providers?.length) return data.providers;
		// Older payload shape: derive the provider rows from the flat list.
		const seen = new Map<string, AiProviderSummary>();
		for (const model of data.models) {
			if (!seen.has(model.provider)) {
				seen.set(model.provider, {
					id: model.provider,
					label: PROVIDER_LABELS[model.provider] ?? model.provider,
					available: model.available,
				});
			}
		}
		return [...seen.values()];
	}, [data]);

	// Each open lands on the provider of the current model.
	const selectedProvider = data?.models.find((model) => model.id === selectedId)?.provider ?? null;
	useEffect(() => {
		if (visible) setExpanded(selectedProvider ?? providers[0]?.id ?? null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible, data]);

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
						{providers.map((provider) => {
							const providerModels = data.models.filter(
								(model) => model.provider === provider.id,
							);
							if (providerModels.length === 0) return null;
							const isExpanded = expanded === provider.id;
							return (
								<View key={provider.id}>
									<Pressable
										accessibilityRole="button"
										accessibilityState={{ expanded: isExpanded }}
										onPress={() =>
											setExpanded((current) => (current === provider.id ? null : provider.id))
										}
										style={({ pressed }) => [
											styles.row,
											pressed && { backgroundColor: colors.surfacePressed },
											!provider.available && styles.rowLocked,
										]}
									>
										<Ionicons
											name={isExpanded ? "chevron-down" : "chevron-forward"}
											size={16}
											color={colors.textMuted}
										/>
										<View style={styles.rowCopy}>
											<Text style={styles.rowLabel}>{provider.label}</Text>
											<Text style={styles.rowDetail}>
												{provider.available
													? `${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`
													: "Add your API key in Settings"}
											</Text>
										</View>
										{!provider.available && (
											<Ionicons name="lock-closed-outline" size={16} color={colors.textGhost} />
										)}
									</Pressable>
									{isExpanded &&
										providerModels.map((model) => {
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
														styles.modelRow,
														active && styles.rowActive,
														pressed && { backgroundColor: colors.surfacePressed },
														!model.available && styles.rowLocked,
													]}
												>
													<Text
														style={[
															styles.modelLabel,
															active && { color: colors.accent, fontWeight: "700" },
														]}
														numberOfLines={1}
													>
														{model.label}
													</Text>
													{active && (
														<Ionicons name="checkmark" size={16} color={colors.accent} />
													)}
												</Pressable>
											);
										})}
								</View>
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
		modelRow: {
			minHeight: 46,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginLeft: spacing.xl,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.xs,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			marginBottom: spacing.xs,
		},
		modelLabel: { flex: 1, minWidth: 0, color: c.textSecondary, fontSize: 13.5, fontWeight: "600" },
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

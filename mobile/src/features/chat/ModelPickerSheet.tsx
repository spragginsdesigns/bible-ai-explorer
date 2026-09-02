import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BottomSheet } from "@/features/notes/components/primitives";
import { radius, spacing, typography, type Colors } from "@/theme";
import {
	setChatEffort,
	setChatModel,
	useSettings,
	useTheme,
	useThemedStyles,
} from "@/features/settings/settingsStore";
import { fetchAiModels, type AiModelsResponse } from "@/features/settings/aiApi";
import {
	houseMode,
	modelsForProvider,
	selectModelId,
	visibleProviders,
} from "./modelPickerRules";
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
 * Model + reasoning-effort picker, mirroring the web chat's picker.
 *
 * Two shapes, decided by the server: an account with no provider key of its
 * own gets "house mode" - the one included model, effort pinned, nothing to
 * choose - while an account with keys gets its unlocked providers, tap one to
 * see every model that key lists live. Locked providers are never rendered;
 * the way in is the "Add an API key" row, not a dead row with a padlock.
 * Picks persist locally and ride every chat request; the server stores the
 * last pick as the account default and enforces house mode regardless.
 */
export function ModelPickerSheet({ visible, onClose, getToken }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
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

	const house = houseMode(data);
	const selectedId = selectModelId(chatModelId, data);
	const providers = useMemo(() => visibleProviders(data), [data]);

	// House mode pins both prefs so outgoing requests and the stored picks agree
	// with what the server will actually run - otherwise a pick left over from a
	// key that has since been removed keeps riding along on every message.
	useEffect(() => {
		if (!house) return;
		if (chatModelId !== house.modelId) setChatModel(house.modelId);
		if (chatEffort !== house.effort) setChatEffort(house.effort);
	}, [house, chatModelId, chatEffort]);

	const openProviderSettings = useCallback(() => {
		onClose();
		router.push("/settings");
	}, [onClose, router]);

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
					<Text style={styles.title}>{house ? "Your model" : "Choose a model"}</Text>
					{!house && (
						<Text style={styles.subtitle}>
							Unlock more models by adding API keys in Settings
						</Text>
					)}
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
			) : house ? (
				<View style={styles.houseBlock}>
					<View
						accessible
						accessibilityRole="text"
						accessibilityState={{ selected: true }}
						accessibilityLabel={`${house.label}, selected model`}
						style={[styles.row, styles.rowActive, styles.houseRow]}
					>
						<Text style={[styles.rowLabel, styles.houseLabel]} numberOfLines={1}>
							{house.label}
						</Text>
						<Ionicons name="checkmark" size={16} color={colors.accent} />
					</View>
					<Text style={[styles.subtitle, styles.houseNote]}>{house.note}</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Add an API key in Settings"
						onPress={openProviderSettings}
						style={({ pressed }) => [
							styles.row,
							styles.houseAction,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<Ionicons name="key-outline" size={16} color={colors.textMuted} />
						<View style={styles.rowCopy}>
							<Text style={styles.rowLabel}>Add an API key</Text>
							<Text style={styles.rowDetail}>Choose other models in Settings</Text>
						</View>
						<Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
					</Pressable>
				</View>
			) : (
				<>
					<ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
						{providers.map((provider) => {
							const providerModels = modelsForProvider(data, provider.id);
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
												{`${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`}
											</Text>
										</View>
									</Pressable>
									{isExpanded &&
										providerModels.map((model) => {
											const active = model.id === selectedId;
											return (
												<Pressable
													key={model.id}
													accessibilityRole="button"
													accessibilityState={{ selected: active }}
													onPress={() => {
														setChatModel(model.id);
														onClose();
													}}
													style={({ pressed }) => [
														styles.modelRow,
														active && styles.rowActive,
														pressed && { backgroundColor: colors.surfacePressed },
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
			...typography.meta,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginBottom: spacing.xs,
		},
		title: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: "700" },
		subtitle: { ...typography.support, color: c.textFaint, marginTop: 3 },
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
		rowCopy: { flex: 1, minWidth: 0 },
		houseBlock: { paddingBottom: spacing.sm },
		// The house row is a status, not a choice, so it carries no chevron and
		// the label takes the space a provider row gives its disclosure icon.
		houseRow: { marginBottom: 0 },
		houseLabel: { flex: 1, minWidth: 0, color: c.accent, fontWeight: "700" },
		houseNote: { marginTop: spacing.sm, marginBottom: spacing.md },
		houseAction: { marginBottom: 0 },
		rowLabel: { color: c.textSecondary, fontSize: 14.5, fontWeight: "600" },
		rowDetail: { ...typography.meta, color: c.textFaint, marginTop: 2 },
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
			...typography.meta,
			color: c.textFaint,
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
		effortChipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "700" },
	});

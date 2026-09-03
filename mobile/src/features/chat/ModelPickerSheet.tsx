import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BottomSheet } from "@/features/notes/components/primitives";
import { radius, spacing, typography, type Colors } from "@/theme";
import {
	setChatEffort,
	setChatMode,
	setChatModel,
	setChatSpeed,
	setChatVerbosity,
	useSettings,
	useTheme,
	useThemedStyles,
} from "@/features/settings/settingsStore";
import { fetchAiModels, type AiModel, type AiModelsResponse } from "@/features/settings/aiApi";
import {
	activeOptionId,
	filterModels,
	houseMode,
	modelMeta,
	modelPills,
	modelsForProvider,
	optionSections,
	providerLabel,
	seedRunOptions,
	selectModelId,
	selectedModel,
	showSearch,
	summaryLabel,
	visibleProviders,
	type OptionKind,
	type OptionSection,
} from "./modelPickerRules";
import type { GetToken } from "@/lib/api";

interface ModelPickerSheetProps {
	visible: boolean;
	onClose: () => void;
	getToken: GetToken;
}

/**
 * Model + run-options picker, mirroring the web chat's picker.
 *
 * Two shapes, decided by the server: an account with no provider key of its
 * own gets "house mode" - the one included model, everything pinned, nothing
 * to choose - while an account with keys gets its unlocked providers, tap one
 * to see every model that key lists live. Locked providers are never rendered;
 * the way in is the "Add an API key" row, not a dead row with a padlock.
 *
 * Under the list sit the run options the selected model actually offers:
 * reasoning effort, speed, answer length and reasoning mode. A section that a
 * model cannot vary is not drawn at all, and every chip is filtered through the
 * model's own capability arrays, so the picker can never send a value the
 * server would have to throw away. Picks persist locally and ride every chat
 * request; the server stores the last pick as the account default and enforces
 * house mode regardless.
 */
export function ModelPickerSheet({ visible, onClose, getToken }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const { height: windowHeight } = useWindowDimensions();
	const { chatModelId, chatEffort, chatSpeed, chatVerbosity, chatMode } = useSettings();
	const [data, setData] = useState<AiModelsResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [chromeHeight, setChromeHeight] = useState(0);
	const [optionsHeight, setOptionsHeight] = useState(0);

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
	const model = useMemo(() => selectedModel(data, chatModelId), [data, chatModelId]);
	const providers = useMemo(() => visibleProviders(data), [data]);
	const sections = useMemo(() => (house ? [] : optionSections(model)), [house, model]);

	const searchable = showSearch(data);
	const trimmedQuery = query.trim();
	const searching = searchable && trimmedQuery.length > 0;
	const results = useMemo(
		() => (searching ? filterModels(data, trimmedQuery) : []),
		[searching, data, trimmedQuery],
	);

	const summary = house
		? ""
		: summaryLabel(model, {
				effort: chatEffort,
				speed: chatSpeed,
				verbosity: chatVerbosity,
				mode: chatMode,
			});

	// House mode pins every pref so outgoing requests and the stored picks agree
	// with what the server will actually run - otherwise a pick left over from a
	// key that has since been removed keeps riding along on every message. The
	// house model runs one fixed configuration, so the three run options are
	// cleared rather than pinned: a stale Fast must not survive a removed key.
	useEffect(() => {
		if (!house) return;
		if (chatModelId !== house.modelId) setChatModel(house.modelId);
		if (chatEffort !== house.effort) setChatEffort(house.effort);
		if (chatSpeed !== null) setChatSpeed(null);
		if (chatVerbosity !== null) setChatVerbosity(null);
		if (chatMode !== null) setChatMode(null);
	}, [house, chatModelId, chatEffort, chatSpeed, chatVerbosity, chatMode]);

	// Keys mode: adopt the account defaults the server sent for anything this
	// device has never chosen. The server applies them to the request either
	// way, so without this the chips can say Standard while the answer runs Fast.
	useEffect(() => {
		if (!data || house) return;
		const seed = seedRunOptions(
			{ effort: chatEffort, speed: chatSpeed, verbosity: chatVerbosity, mode: chatMode },
			data.defaults,
		);
		if (seed.effort) setChatEffort(seed.effort);
		if (seed.speed) setChatSpeed(seed.speed);
		if (seed.verbosity) setChatVerbosity(seed.verbosity);
		if (seed.mode) setChatMode(seed.mode);
	}, [data, house, chatEffort, chatSpeed, chatVerbosity, chatMode]);

	const openProviderSettings = useCallback(() => {
		onClose();
		router.push("/settings");
	}, [onClose, router]);

	// Each open lands on the provider of the current model, with a clean search.
	const selectedProvider = data?.models.find((entry) => entry.id === selectedId)?.provider ?? null;
	useEffect(() => {
		if (!visible) return;
		setExpanded(selectedProvider ?? providers[0]?.id ?? null);
		setQuery("");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible, data]);

	const pickModel = useCallback(
		(id: string) => {
			setChatModel(id);
			onClose();
		},
		[onClose],
	);

	const applyOption = useCallback((kind: OptionKind, id: string) => {
		if (kind === "effort") setChatEffort(id);
		else if (kind === "speed") setChatSpeed(id);
		else if (kind === "verbosity") setChatVerbosity(id);
		else setChatMode(id);
	}, []);

	const storedFor = (kind: OptionKind): string | null => {
		if (kind === "effort") return chatEffort;
		if (kind === "speed") return chatSpeed;
		if (kind === "verbosity") return chatVerbosity;
		return chatMode;
	};

	// The sheet sizes itself to its content, so the list has to yield room to
	// whatever the options need: a model with all four sections would otherwise
	// push its own chips off the bottom of the screen.
	const listMaxHeight = Math.max(
		160,
		Math.round(windowHeight * 0.72) - chromeHeight - optionsHeight,
	);

	return (
		<BottomSheet visible={visible} onClose={onClose}>
			<View
				onLayout={(event) => {
					const next = Math.round(event.nativeEvent.layout.height);
					setChromeHeight((current) => (Math.abs(current - next) < 2 ? current : next));
				}}
			>
				<View style={styles.header}>
					<View style={styles.headerCopy}>
						<Text style={styles.eyebrow}>AI MODEL</Text>
						<Text style={styles.title}>{house ? "Your model" : "Choose a model"}</Text>
						{summary ? (
							<Text style={styles.summary} numberOfLines={1}>
								{`Using ${summary}`}
							</Text>
						) : null}
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

				{data && !house && searchable ? (
					<View style={styles.search}>
						<Ionicons name="search" size={15} color={colors.textFaint} />
						<TextInput
							variant="support"
							accessibilityLabel="Search models"
							value={query}
							onChangeText={setQuery}
							placeholder="Search models"
							placeholderTextColor={colors.textGhost}
							autoCapitalize="none"
							autoCorrect={false}
							returnKeyType="search"
							// The keyboard's Search key takes the top hit, so typing
							// "sol" and tapping it is the whole interaction.
							onSubmitEditing={() => {
								if (results.length > 0) pickModel(results[0].id);
							}}
							style={styles.searchInput}
						/>
						{query.length > 0 ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Clear search"
								onPress={() => setQuery("")}
								hitSlop={8}
							>
								<Ionicons name="close-circle" size={16} color={colors.textFaint} />
							</Pressable>
						) : null}
					</View>
				) : null}
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
					<ScrollView
						style={{ maxHeight: listMaxHeight }}
						keyboardShouldPersistTaps="handled"
						showsVerticalScrollIndicator={false}
					>
						{searching ? (
							results.length === 0 ? (
								<Text style={[styles.subtitle, styles.emptySearch]}>
									No models match that.
								</Text>
							) : (
								results.map((entry) => (
									<ModelRow
										key={entry.id}
										model={entry}
										active={entry.id === selectedId}
										providerName={providerLabel(data, entry.provider)}
										onPress={() => pickModel(entry.id)}
									/>
								))
							)
						) : (
							providers.map((provider) => {
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
											providerModels.map((entry) => (
												<ModelRow
													key={entry.id}
													model={entry}
													active={entry.id === selectedId}
													indented
													onPress={() => pickModel(entry.id)}
												/>
											))}
									</View>
								);
							})
						)}
					</ScrollView>

					{sections.length > 0 ? (
						<View
							style={styles.optionsBlock}
							onLayout={(event) => {
								const next = Math.round(event.nativeEvent.layout.height);
								setOptionsHeight((current) => (Math.abs(current - next) < 2 ? current : next));
							}}
						>
							{sections.map((section) => (
								<OptionRow
									key={section.kind}
									section={section}
									stored={storedFor(section.kind)}
									onSelect={(id) => applyOption(section.kind, id)}
								/>
							))}
						</View>
					) : null}
				</>
			)}
		</BottomSheet>
	);
}

/**
 * One model in the list: the label with its capability pills, and a second line
 * carrying the curated tagline or, failing that, the hard numbers the server
 * sent. In search results the provider name prefixes the label, since the
 * grouping that would otherwise say so is flattened away.
 */
function ModelRow({
	model,
	active,
	indented = false,
	providerName,
	onPress,
}: {
	model: AiModel;
	active: boolean;
	indented?: boolean;
	providerName?: string;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const pills = modelPills(model);
	const meta = modelMeta(model);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			accessibilityLabel={[providerName, model.label, ...pills, meta]
				.filter(Boolean)
				.join(", ")}
			onPress={onPress}
			style={({ pressed }) => [
				styles.modelRow,
				indented && styles.modelRowIndented,
				active && styles.rowActive,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			<View style={styles.modelCopy}>
				<View style={styles.modelTitleRow}>
					{providerName ? (
						<Text style={styles.modelProvider} numberOfLines={1}>
							{providerName}
						</Text>
					) : null}
					<Text
						style={[styles.modelLabel, active && { color: colors.accent, fontWeight: "700" }]}
						numberOfLines={1}
					>
						{model.label}
					</Text>
					{pills.map((pill) => (
						<View key={pill} style={styles.pill}>
							<Text style={styles.pillLabel}>{pill}</Text>
						</View>
					))}
				</View>
				{meta ? (
					<Text style={styles.modelMeta} numberOfLines={1}>
						{meta}
					</Text>
				) : null}
			</View>
			{active ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
		</Pressable>
	);
}

/**
 * One run-option section. The chips scroll horizontally because reasoning can
 * offer eight of them. Every chip stores its own id verbatim, and outside
 * reasoning that includes the default: only reasoning's Auto stores null, since
 * the server reads a null speed, length or mode as "apply the account default"
 * rather than as a choice.
 */
function OptionRow({
	section,
	stored,
	onSelect,
}: {
	section: OptionSection;
	stored: string | null;
	onSelect: (id: string) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const selected = activeOptionId(section, stored);
	return (
		<View style={styles.optionSection}>
			<Text accessibilityRole="header" style={styles.optionTitle}>
				{section.title}
			</Text>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={styles.optionRow}
			>
				{section.choices.map((choice) => {
					const active = selected === choice.id;
					return (
						<Pressable
							key={choice.label}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
							accessibilityLabel={`${section.name}: ${choice.label}`}
							onPress={() => onSelect(choice.id)}
							style={({ pressed }) => [
								styles.optionChip,
								active && styles.optionChipActive,
								pressed && { backgroundColor: colors.surfacePressed },
							]}
						>
							<Text style={[styles.optionChipLabel, active && { color: colors.accent }]}>
								{choice.label}
							</Text>
						</Pressable>
					);
				})}
			</ScrollView>
			{section.note ? <Text style={styles.optionNote}>{section.note}</Text> : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: spacing.md,
			marginBottom: spacing.md,
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
		summary: { ...typography.meta, color: c.textMuted, marginTop: 3 },
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
		search: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 42,
			paddingHorizontal: spacing.md,
			marginBottom: spacing.sm,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		searchInput: {
			flex: 1,
			minWidth: 0,
			paddingVertical: spacing.sm,
			color: c.text,
		},
		centerBox: {
			minHeight: 120,
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.md,
			paddingBottom: spacing.lg,
		},
		retry: { color: c.accent, fontSize: 13, fontWeight: "700" },
		emptySearch: { paddingVertical: spacing.lg, textAlign: "center" },
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
			minHeight: 54,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			marginBottom: spacing.xs,
		},
		modelRowIndented: { marginLeft: spacing.xl },
		modelCopy: { flex: 1, minWidth: 0 },
		modelTitleRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.xs,
		},
		modelProvider: { ...typography.micro, color: c.textFaint, flexShrink: 0 },
		modelLabel: { flexShrink: 1, color: c.textSecondary, fontSize: 13.5, fontWeight: "600" },
		pill: {
			flexShrink: 0,
			paddingHorizontal: 6,
			paddingVertical: 1,
			borderRadius: radius.sm,
			backgroundColor: c.surfaceStrong,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		pillLabel: { ...typography.micro, fontSize: 10, lineHeight: 14, color: c.textFaint },
		modelMeta: { ...typography.micro, color: c.textFaint, marginTop: 2 },
		optionsBlock: {
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
			paddingTop: spacing.md,
			paddingBottom: spacing.sm,
			gap: spacing.md,
		},
		optionSection: { gap: spacing.sm },
		optionTitle: {
			...typography.meta,
			color: c.textFaint,
			fontWeight: "700",
			letterSpacing: 1.2,
		},
		optionRow: { flexDirection: "row", gap: spacing.sm, paddingRight: spacing.sm },
		optionChip: {
			minHeight: 40,
			minWidth: 64,
			paddingHorizontal: spacing.md,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		optionChipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		optionChipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "700" },
		optionNote: { ...typography.micro, color: c.textFaint },
	});

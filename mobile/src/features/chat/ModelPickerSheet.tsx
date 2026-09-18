import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BottomSheet } from "@/features/notes/components/primitives";
import { StudyTabs } from "@/features/bible/verse-sheet/StudyTabs";
import { radius, spacing, typography, type Colors } from "@/theme";
import {
	setChatEffort,
	setChatEffortLocal,
	setChatMode,
	setChatModeLocal,
	setChatModel,
	setChatModelLocal,
	setChatSpeed,
	setChatSpeedLocal,
	setChatVerbosity,
	setChatVerbosityLocal,
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
	optionGridColumns,
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

type Pane = "models" | "options";

/** The sheet's share of the screen in keys mode; a sliver of chat stays visible. */
const SHEET_HEIGHT_RATIO = 0.86;

/**
 * Model + run-options picker, mirroring the web chat's picker.
 *
 * Two shapes, decided by the server: an account with no provider key of its
 * own gets "house mode" - the one included model, everything pinned, nothing
 * to choose - while an account with keys gets its unlocked providers and every
 * model each key lists live. Locked providers are never rendered; the way in
 * is the "Add an API key" row, not a dead row with a padlock.
 *
 * Keys mode is a fixed-height sheet split into two panes. MODELS holds the
 * search box and the grouped list, and gets the whole height, so seven models
 * or seventy scan the same way. OPTIONS holds the run options the selected
 * model actually offers - reasoning effort, speed, answer length, reasoning
 * mode - each as a wrapping grid of equal chips, so no chip is ever clipped or
 * hidden behind a horizontal scroll. A section a model cannot vary is not
 * drawn at all, and every chip is filtered through the model's own capability
 * arrays, so the picker can never send a value the server would throw away.
 * Picks persist locally and ride every chat request; the server stores the
 * last pick as the account default and enforces house mode regardless.
 */
export function ModelPickerSheet({ visible, onClose, getToken }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const { chatModelId, chatEffort, chatSpeed, chatVerbosity, chatMode } = useSettings();
	const [data, setData] = useState<AiModelsResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [pane, setPane] = useState<Pane>("models");

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
	//
	// Local-only: this is the client agreeing with the server, not a choice.
	// PATCHing it would overwrite the model this account picked while it still
	// had a key, and lose it the moment the key comes back.
	useEffect(() => {
		if (!house) return;
		if (chatModelId !== house.modelId) setChatModelLocal(house.modelId);
		if (chatEffort !== house.effort) setChatEffortLocal(house.effort);
		if (chatSpeed !== null) setChatSpeedLocal(null);
		if (chatVerbosity !== null) setChatVerbosityLocal(null);
		if (chatMode !== null) setChatModeLocal(null);
	}, [house, chatModelId, chatEffort, chatSpeed, chatVerbosity, chatMode]);

	// Keys mode: adopt the account defaults the server sent for anything this
	// device has never chosen. The server applies them to the request either
	// way, so without this the chips can say Standard while the answer runs Fast.
	// Local-only for the same reason: these values came from the account row.
	useEffect(() => {
		if (!data || house) return;
		const seed = seedRunOptions(
			{ effort: chatEffort, speed: chatSpeed, verbosity: chatVerbosity, mode: chatMode },
			data.defaults,
		);
		if (seed.effort) setChatEffortLocal(seed.effort);
		if (seed.speed) setChatSpeedLocal(seed.speed);
		if (seed.verbosity) setChatVerbosityLocal(seed.verbosity);
		if (seed.mode) setChatModeLocal(seed.mode);
	}, [data, house, chatEffort, chatSpeed, chatVerbosity, chatMode]);

	const openProviderSettings = useCallback(() => {
		onClose();
		// Straight to the AI page: this is the "add a key" escape hatch, and the
		// hub would leave the user one tap short of the provider list.
		router.push("/settings/ai");
	}, [onClose, router]);

	// Each open lands on the MODELS pane, on the provider of the current model,
	// with a clean search.
	const selectedProvider = data?.models.find((entry) => entry.id === selectedId)?.provider ?? null;
	useEffect(() => {
		if (!visible) return;
		setExpanded(selectedProvider ?? providers[0]?.id ?? null);
		setQuery("");
		setPane("models");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible, data]);

	// A model with nothing to tune has no OPTIONS pane; if it was open when the
	// selection changed under it, fall back rather than show an empty pane.
	useEffect(() => {
		if (sections.length === 0 && pane === "options") setPane("models");
	}, [sections.length, pane]);

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

	const keysMode = Boolean(data) && !loadFailed && !house;
	const tabs = useMemo(
		() =>
			sections.length > 0
				? [
						{ key: "models", label: "Models" },
						{ key: "options", label: "Options" },
					]
				: [],
		[sections.length],
	);

	return (
		<BottomSheet
			visible={visible}
			onClose={onClose}
			heightRatio={keysMode ? SHEET_HEIGHT_RATIO : undefined}
		>
			<View style={styles.header}>
				<View style={styles.headerCopy}>
					<Text style={styles.title}>{house ? "Your model" : "Choose a model"}</Text>
					{summary ? (
						<Text style={styles.summary} numberOfLines={1}>
							{`Using ${summary}`}
						</Text>
					) : null}
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
					<AddKeyRow onPress={openProviderSettings} />
				</View>
			) : (
				<View style={styles.body}>
					{tabs.length > 0 ? (
						<StudyTabs
							tabs={tabs}
							value={pane}
							onChange={(key) => setPane(key === "options" ? "options" : "models")}
							style={styles.tabs}
						/>
					) : null}

					{pane === "options" ? (
						<ScrollView
							style={styles.pane}
							contentContainerStyle={styles.paneContent}
							keyboardShouldPersistTaps="handled"
							showsVerticalScrollIndicator={false}
						>
							{model ? (
								<Text style={styles.optionsIntro} numberOfLines={2}>
									{`How ${model.label} answers. Changes apply to your next message.`}
								</Text>
							) : null}
							{sections.map((section) => (
								<OptionCard
									key={section.kind}
									section={section}
									stored={storedFor(section.kind)}
									onSelect={(id) => applyOption(section.kind, id)}
								/>
							))}
						</ScrollView>
					) : (
						<>
							{searchable ? (
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

							<ScrollView
								style={styles.pane}
								contentContainerStyle={styles.paneContent}
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
										// One provider needs no accordion: the header is a label
										// and every model is on screen. Several providers fold,
										// since one key can list hundreds of models.
										const foldable = providers.length > 1;
										const isExpanded = !foldable || expanded === provider.id;
										const count = `${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`;
										return (
											<View key={provider.id} style={styles.group}>
												<Pressable
													accessibilityRole={foldable ? "button" : "header"}
													accessibilityState={foldable ? { expanded: isExpanded } : undefined}
													accessibilityLabel={`${provider.label}, ${count}`}
													disabled={!foldable}
													onPress={() =>
														setExpanded((current) =>
															current === provider.id ? null : provider.id,
														)
													}
													style={styles.groupHeader}
												>
													<Text style={styles.groupTitle}>{provider.label}</Text>
													<Text style={styles.groupCount}>{count}</Text>
													{foldable ? (
														<Ionicons
															name={isExpanded ? "chevron-up" : "chevron-down"}
															size={16}
															color={colors.textFaint}
														/>
													) : null}
												</Pressable>
												{isExpanded &&
													providerModels.map((entry) => (
														<ModelRow
															key={entry.id}
															model={entry}
															active={entry.id === selectedId}
															onPress={() => pickModel(entry.id)}
														/>
													))}
											</View>
										);
									})
								)}
								{!searching ? <AddKeyRow onPress={openProviderSettings} /> : null}
							</ScrollView>
						</>
					)}
				</View>
			)}
		</BottomSheet>
	);
}

/**
 * The way to more models. In keys mode it closes the list; in house mode it is
 * the only action there is.
 */
function AddKeyRow({ onPress }: { onPress: () => void }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Add an API key in Settings"
			onPress={onPress}
			style={({ pressed }) => [
				styles.row,
				styles.addKeyRow,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			<Ionicons name="key-outline" size={16} color={colors.textMuted} />
			<View style={styles.rowCopy}>
				<Text style={styles.rowLabel}>Add an API key</Text>
				<Text style={styles.rowDetail}>Unlock more models in Settings</Text>
			</View>
			<Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
		</Pressable>
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
	providerName,
	onPress,
}: {
	model: AiModel;
	active: boolean;
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
				</View>
				{meta ? (
					<Text style={styles.modelMeta} numberOfLines={1}>
						{meta}
					</Text>
				) : null}
				{pills.length > 0 ? (
					<View style={styles.pillRow}>
						{pills.map((pill) => (
							<View key={pill} style={styles.pill}>
								<Text style={styles.pillLabel}>{pill}</Text>
							</View>
						))}
					</View>
				) : null}
			</View>
			<View style={styles.modelCheck}>
				{active ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : null}
			</View>
		</Pressable>
	);
}

/**
 * One run-option section as a card: the title with the current pick beside it,
 * then every chip in a wrapping grid of equal cells (reasoning can offer eight,
 * so it takes two rows of four). Every chip stores its own id verbatim, and
 * outside reasoning that includes the default: only reasoning's Auto stores
 * null, since the server reads a null speed, length or mode as "apply the
 * account default" rather than as a choice.
 */
function OptionCard({
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
	const selectedLabel = section.choices.find((choice) => choice.id === selected)?.label ?? "";
	const columns = optionGridColumns(section.choices.length);
	const cellWidth = `${100 / columns}%` as const;
	return (
		<View style={styles.optionCard}>
			<View style={styles.optionHeader}>
				<Text accessibilityRole="header" style={styles.optionTitle}>
					{section.title}
				</Text>
				<Text style={styles.optionValue} numberOfLines={1}>
					{selectedLabel}
				</Text>
			</View>
			<View style={styles.optionGrid}>
				{section.choices.map((choice) => {
					const active = selected === choice.id;
					return (
						<View key={choice.id} style={[styles.optionCell, { width: cellWidth }]}>
							<Pressable
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
								<Text
									numberOfLines={1}
									adjustsFontSizeToFit
									minimumFontScale={0.85}
									style={[styles.optionChipLabel, active && { color: colors.accent }]}
								>
									{choice.label}
								</Text>
							</Pressable>
						</View>
					);
				})}
			</View>
			{section.note ? <Text style={styles.optionNote}>{section.note}</Text> : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginBottom: spacing.md,
		},
		headerCopy: { flex: 1, minWidth: 0 },
		title: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: "700" },
		summary: { ...typography.meta, color: c.textMuted, marginTop: 2 },
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
		// The fixed-height sheet hands its remaining height to the body, which
		// hands it to whichever pane is open; the header and tabs stay pinned.
		body: { flex: 1, minHeight: 0 },
		tabs: { marginHorizontal: 0, marginBottom: spacing.md },
		pane: { flex: 1, minHeight: 0 },
		paneContent: { paddingBottom: spacing.lg },
		search: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 44,
			paddingHorizontal: spacing.md,
			marginBottom: spacing.md,
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
		addKeyRow: { marginTop: spacing.xs, marginBottom: 0 },
		rowLabel: { color: c.textSecondary, fontSize: 14.5, fontWeight: "600" },
		rowDetail: { ...typography.meta, color: c.textFaint, marginTop: 2 },
		group: { marginBottom: spacing.md },
		groupHeader: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 36,
			paddingHorizontal: spacing.xs,
			marginBottom: spacing.xs,
		},
		groupTitle: {
			...typography.meta,
			color: c.textFaint,
			fontWeight: "700",
			letterSpacing: 1.2,
			textTransform: "uppercase",
		},
		groupCount: { ...typography.meta, color: c.textGhost, flex: 1, minWidth: 0 },
		modelRow: {
			minHeight: 64,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			marginBottom: spacing.sm,
		},
		modelCopy: { flex: 1, minWidth: 0, gap: 3 },
		modelTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
		modelProvider: { ...typography.micro, color: c.textFaint, flexShrink: 0 },
		modelLabel: { flexShrink: 1, color: c.text, ...typography.control, fontWeight: "600" },
		modelMeta: { ...typography.meta, color: c.textFaint },
		pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 2 },
		pill: {
			paddingHorizontal: 7,
			paddingVertical: 2,
			borderRadius: radius.sm,
			backgroundColor: c.surfaceStrong,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		pillLabel: { ...typography.micro, fontSize: 11, lineHeight: 14, color: c.textMuted },
		// Reserved whether or not the row is active, so labels align down the list.
		modelCheck: { width: 22, alignItems: "flex-end" },
		optionsIntro: { ...typography.support, color: c.textFaint, marginBottom: spacing.md },
		optionCard: {
			padding: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			marginBottom: spacing.md,
			gap: spacing.sm,
		},
		optionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		optionTitle: {
			...typography.meta,
			color: c.textFaint,
			fontWeight: "700",
			letterSpacing: 1.2,
			flex: 1,
			minWidth: 0,
		},
		optionValue: { ...typography.meta, color: c.accent, fontWeight: "700" },
		// Percent-width cells with inner padding instead of `gap`, so the grid
		// always fills the card edge to edge with no measuring pass.
		optionGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs / 2 },
		optionCell: { padding: spacing.xs / 2 },
		optionChip: {
			minHeight: 42,
			paddingHorizontal: spacing.sm,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surfaceStrong,
		},
		optionChipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		optionChipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "700" },
		optionNote: { ...typography.micro, color: c.textFaint },
	});

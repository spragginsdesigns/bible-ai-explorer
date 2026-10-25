import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
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
import type { AiModel, AiModelsResponse } from "@/features/settings/aiApi";
import { PremiumMark } from "./PremiumMark";
import {
	activeOptionId,
	filterModels,
	houseEffortSection,
	houseEffortToPin,
	houseMode,
	houseRowAccessibilityLabel,
	isPremium,
	modelMeta,
	modelPills,
	modelRowAccessibilityLabel,
	modelsForProvider,
	optionGridColumns,
	optionSections,
	ownerPlansOnly,
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

interface ModelPickerSheetProps {
	visible: boolean;
	onClose: () => void;
	/** `/api/ai/models`, owned by the chat screen (`useAiModels`) so the composer chip shares it. */
	data: AiModelsResponse | null;
	loadFailed: boolean;
	onReload: () => void | Promise<void>;
}

type Pane = "models" | "options";

/** The sheet's share of the screen in keys mode; a sliver of chat stays visible. */
const SHEET_HEIGHT_RATIO = 0.86;

/**
 * Model + run-options picker, mirroring the web chat's picker.
 *
 * Since 2026-10-25 every account runs on SureWord AI, Free or Pro, with no
 * bring-your-own keys. Two shapes, decided by the server: an ordinary account
 * gets "house mode" - its one "SureWord AI" row (with Pro's premium mark),
 * everything pinned, nothing else - while the owner account gets a list of
 * SureWord's two plan rows (`ownerPlansOnly`) in a short sheet with no
 * search. The general list below is what the owner list renders through.
 *
 * A longer list is a fixed-height sheet split into two panes. MODELS holds the
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
export function ModelPickerSheet({ visible, onClose, data, loadFailed, onReload }: ModelPickerSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { chatModelId, chatEffort, chatSpeed, chatVerbosity, chatMode } = useSettings();
	const [expanded, setExpanded] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [pane, setPane] = useState<Pane>("models");
	const load = useCallback(() => void onReload(), [onReload]);

	// Each open revalidates in place, so a plan bought since launch (or a load
	// that failed offline) catches up; the chip reads the same data. A failure
	// with nothing cached waits for Retry.
	useEffect(() => {
		if (visible) load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible]);

	const house = houseMode(data);
	const selectedId = selectModelId(chatModelId, data);
	const model = useMemo(() => selectedModel(data, chatModelId), [data, chatModelId]);
	const providers = useMemo(() => visibleProviders(data), [data]);
	const sections = useMemo(() => (house ? [] : optionSections(model)), [house, model]);
	// Pro's included model takes a reasoning choice; Free gets none.
	const houseSection = useMemo(() => houseEffortSection(house), [house]);

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
	// A Pro reasoning pick the server offers is a choice, so it stays.
	useEffect(() => {
		if (!house) return;
		if (chatModelId !== house.modelId) setChatModelLocal(house.modelId);
		const pinnedEffort = houseEffortToPin(house, chatEffort);
		if (chatEffort !== pinnedEffort) setChatEffortLocal(pinnedEffort);
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
	// The owner's Free / Pro plan rows: a short, content-sized sheet with no search.
	const ownerPlans = ownerPlansOnly(data);
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
			// The owner's two plan rows need no full-height list.
			heightRatio={keysMode && !ownerPlans ? SHEET_HEIGHT_RATIO : undefined}
		>
			<View style={styles.header}>
				<View style={styles.headerCopy}>
					<Text style={styles.title}>{house ? "Your model" : "Choose a model"}</Text>
					{summary ? (
						<View style={styles.summaryRow}>
							<Text style={styles.summary} numberOfLines={1}>
								{`Using ${summary}`}
							</Text>
							{isPremium(model) ? <PremiumMark size={15} /> : null}
						</View>
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
					<Pressable accessibilityRole="button" onPress={load} hitSlop={8}>
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
						accessibilityLabel={houseRowAccessibilityLabel(house)}
						style={[styles.row, styles.rowActive, styles.houseRow]}
					>
						<View style={styles.houseTitle}>
							<Text style={[styles.rowLabel, styles.houseLabel]} numberOfLines={1}>
								{house.label}
							</Text>
							{isPremium(house) ? <PremiumMark /> : null}
						</View>
						<Ionicons name="checkmark" size={16} color={colors.accent} />
					</View>
					{houseSection ? (
						<OptionCard
							section={houseSection}
							stored={chatEffort}
							onSelect={(id) => setChatEffort(id)}
						/>
					) : null}
					{/* One row and nothing else (Austin, 2026-10-25: "no more
					    complicated model picker"). */}
				</View>
			) : (
				<View style={ownerPlans ? undefined : styles.body}>
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
							{searchable && !ownerPlans ? (
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
								// Content-sized for the owner's two rows: a flex:1 pane
								// inside a content-sized sheet would measure zero.
								style={ownerPlans ? styles.paneNatural : styles.pane}
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
							</ScrollView>
						</>
					)}
				</View>
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
			accessibilityLabel={modelRowAccessibilityLabel(model, providerName)}
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
					{isPremium(model) ? <PremiumMark /> : null}
					{/* Pills sit on the label line after the mark, as on web. */}
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
		summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
		summary: { ...typography.meta, color: c.textMuted, flexShrink: 1 },
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
		paneNatural: { flexGrow: 0 },
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
		houseBlock: { paddingBottom: spacing.lg },
		// The house row is a status, not a choice, so it carries no chevron and
		// the label takes the space a provider row gives its disclosure icon.
		houseRow: { marginBottom: 0 },
		houseTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
		houseLabel: { flexShrink: 1, color: c.accent, fontWeight: "700" },
		rowLabel: { color: c.textSecondary, fontSize: 14.5, fontWeight: "600" },
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
		pill: {
			flexShrink: 0,
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

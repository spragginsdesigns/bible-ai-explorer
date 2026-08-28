import React, { useCallback, useMemo } from "react";
import {
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassCard, Screen } from "@/components/ui";
import { TimelineStop } from "@/features/cross/TimelineStop";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder } from "@/features/bible/books";
import {
	ATLAS_ERAS,
	getTimeline,
	listAtlasEntities,
	searchAtlasGlobal,
	whoIsIn,
	type AtlasEntitySummary,
	type AtlasChapterView,
	type AtlasEra,
	type AtlasEventView,
	type AtlasMode,
	type AtlasSearchHit,
} from "@/features/atlas/atlas";
import {
	USSHER_NOTE,
	eraChipLabel,
	emptyTimelineMessage,
	eventDateLabel,
	eventDateProvenanceLabel,
	hitKindLabel,
	searchHitDateLabel,
} from "@/features/atlas/atlasView";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

type Params = {
	q?: string;
	mode?: string;
	era?: string;
	detail?: string;
	personId?: string;
	book?: string;
	chapter?: string;
};

function scalar(value: string | string[] | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function modeParam(value: string | undefined): AtlasMode {
	return value === "people" || value === "places" ? value : "timeline";
}

function strictInteger(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function carry(
	params: Params,
	changes: Partial<Params>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries({ ...params, ...changes }).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" && entry[1].length > 0,
		),
	);
}

export default function BibleTimelineScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const raw = useLocalSearchParams<Params>();
	const params: Params = {
		q: scalar(raw.q),
		mode: scalar(raw.mode),
		era: scalar(raw.era),
		detail: scalar(raw.detail),
		personId: scalar(raw.personId),
		book: scalar(raw.book),
		chapter: scalar(raw.chapter),
	};
	const mode = modeParam(params.mode);
	const query = params.q ?? "";
	const trimmed = query.trim();
	const era =
		mode === "places"
			? null
			: (ATLAS_ERAS as readonly string[]).includes(params.era ?? "")
				? (params.era as AtlasEra)
				: null;
	const order = strictInteger(params.book);
	const chapter = strictInteger(params.chapter);
	const book = order === null ? null : bookByOrder(order);
	const hasScopeParam =
		params.book !== undefined || params.chapter !== undefined;
	const scopeError =
		hasScopeParam &&
		(!book ||
			chapter === null ||
			chapter < 1 ||
			chapter > book.chapters);
	const chapterScope =
		!scopeError && book && order !== null && chapter !== null
			? { order, chapter, name: book.name }
			: null;

	const setParams = useCallback(
		(changes: Partial<Params>) => {
			const next = { ...changes };
			if (changes.mode === "places") next.era = "";
			router.setParams(carry(params, next));
		},
		[
			router,
			params.q,
			params.mode,
			params.era,
			params.detail,
			params.personId,
			params.book,
			params.chapter,
		],
	);

	const chapterView = useMemo(
		() =>
			chapterScope ? whoIsIn(chapterScope.order, chapterScope.chapter) : null,
		[chapterScope?.order, chapterScope?.chapter],
	);
	const groups = useMemo(
		() =>
			getTimeline({
				...(era ? { era } : {}),
				...(chapterScope
					? { book: chapterScope.order, chapter: chapterScope.chapter }
					: {}),
				...(params.personId ? { personId: params.personId } : {}),
			}),
		[era, chapterScope?.order, chapterScope?.chapter, params.personId],
	);
	const directory = useMemo(
		() =>
			mode === "timeline"
				? []
				: listAtlasEntities({
						kind: mode === "people" ? "person" : "place",
						...(mode === "people" && era ? { era } : {}),
						limit: 100,
					}).items,
		[mode, era],
	);
	const search = useMemo(() => {
		if (!trimmed) return null;
		const base = searchAtlasGlobal(trimmed, null, Number.MAX_SAFE_INTEGER);
		return { ...base, results: base.results.slice(0, 12) };
	}, [trimmed]);

	const openEntity = useCallback(
		(id: string, kind: "person" | "place") =>
			router.push({
				pathname: "/bible/atlas/[id]",
				params: { ...carry(params, { detail: `${kind}:${id}` }), id },
			}),
		[
			router,
			params.q,
			params.mode,
			params.era,
			params.detail,
			params.personId,
			params.book,
			params.chapter,
		],
	);
	const openEvent = useCallback(
		(id: string) =>
			router.push({
				pathname: "/bible/atlas/event/[id]",
				params: { ...carry(params, { detail: `event:${id}` }), id },
			}),
		[
			router,
			params.q,
			params.mode,
			params.era,
			params.detail,
			params.personId,
			params.book,
			params.chapter,
		],
	);

	if (scopeError) {
		return (
			<Screen>
				<Header
					title="Timeline, People & Places"
					onBack={() => router.back()}
					styles={styles}
				/>
				<View style={styles.center}>
					<GlassCard style={styles.emptyCard}>
						<Text style={styles.emptyText}>
							That is not a chapter of the Bible. Choose a book and chapter from
							the reader.
						</Text>
					</GlassCard>
				</View>
			</Screen>
		);
	}

	return (
		<Screen>
			<Header
				title={
					chapterScope
						? `${chapterScope.name} ${chapterScope.chapter}`
						: mode === "people"
							? "People"
							: mode === "places"
								? "Places"
							: "Timeline, People & Places"
				}
				onBack={() => router.back()}
				styles={styles}
			/>
			<SearchBox
				value={query}
				onChangeText={(value) => setParams({ q: value })}
				onClear={() => setParams({ q: "" })}
				styles={styles}
				colors={colors}
			/>
			<View style={styles.modeRow}>
				{(["timeline", "people", "places"] as AtlasMode[]).map((value) => (
					<ModeChip
						key={value}
						label={value[0].toUpperCase() + value.slice(1)}
						active={mode === value}
						onPress={() => setParams({ mode: value })}
						styles={styles}
					/>
				))}
			</View>
			{!chapterScope && mode !== "places" ? (
				<EraNavigator
					era={era}
					onSelect={(value) => setParams({ era: value ?? "" })}
					styles={styles}
				/>
			) : null}
			{trimmed && search ? (
				<SearchResults
					search={search}
					onEntity={(id, kind) => openEntity(id, kind)}
					onEvent={openEvent}
					styles={styles}
				/>
			) : (
				<BrowseResults
					mode={mode}
					groups={groups}
					directory={directory}
					chapterView={chapterView}
					chapterScope={chapterScope}
					onEntity={openEntity}
					onEvent={openEvent}
					styles={styles}
					tabBarSpace={tabBarSpace}
				/>
			)}
		</Screen>
	);
}

function Header({
	title,
	onBack,
	styles,
}: {
	title: string;
	onBack: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.topBar}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Back to Bible"
				onPress={onBack}
				hitSlop={8}
				style={styles.headerControl}
			>
				<Text style={styles.back}>‹ Back</Text>
			</Pressable>
			<Text numberOfLines={1} style={styles.title}>
				{title}
			</Text>
			<View style={styles.topBarSpacer} />
		</View>
	);
}

function SearchBox({
	value,
	onChangeText,
	onClear,
	styles,
	colors,
}: {
	value: string;
	onChangeText: (value: string) => void;
	onClear: () => void;
	styles: ReturnType<typeof createStyles>;
	colors: Colors;
}) {
	return (
		<View style={styles.searchWrap}>
			<Ionicons name="search" size={15} color={colors.textFaint} />
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder="Search people, places and events"
				placeholderTextColor={colors.textFaint}
				accessibilityLabel="Search the Bible atlas"
				autoCorrect={false}
				returnKeyType="search"
				style={styles.searchInput}
			/>
			{value.length > 0 ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Clear search"
					onPress={onClear}
					style={styles.clearButton}
				>
					<Ionicons name="close-circle" size={17} color={colors.textFaint} />
				</Pressable>
			) : null}
		</View>
	);
}

function ModeChip({
	label,
	active,
	onPress,
	styles,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={[styles.modeChip, active && styles.modeChipActive]}
		>
			<Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
				{label}
			</Text>
		</Pressable>
	);
}

function EraNavigator({
	era,
	onSelect,
	styles,
}: {
	era: AtlasEra | null;
	onSelect: (era: AtlasEra | null) => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			style={styles.eraScroll}
			contentContainerStyle={styles.eraRow}
		>
			<EraChip
				label="All"
				active={!era}
				onPress={() => onSelect(null)}
				styles={styles}
			/>
			{ATLAS_ERAS.map((value) => (
				<EraChip
					key={value}
					label={eraChipLabel(value)}
					active={era === value}
					onPress={() => onSelect(era === value ? null : value)}
					styles={styles}
				/>
			))}
		</ScrollView>
	);
}

function EraChip({
	label,
	active,
	onPress,
	styles,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={[styles.eraChip, active && styles.eraChipActive]}
		>
			<Text style={[styles.eraChipLabel, active && styles.eraChipLabelActive]}>
				{label}
			</Text>
		</Pressable>
	);
}

function SearchResults({
	search,
	onEntity,
	onEvent,
	styles,
}: {
	search: ReturnType<typeof searchAtlasGlobal>;
	onEntity: (id: string, kind: "person" | "place") => void;
	onEvent: (id: string) => void;
	styles: ReturnType<typeof createStyles>;
}) {
	const sections: Array<{ kind: AtlasSearchHit["kind"]; label: string }> = [
		{ kind: "person", label: "People" },
		{ kind: "place", label: "Places" },
		{ kind: "event", label: "Events" },
	];
	return (
		<ScrollView
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
		>
			<Text style={styles.searchCounts}>
				{search.results.length} results shown · capped at 12 ·{" "}
				{search.counts.person} people · {search.counts.place} places ·{" "}
				{search.counts.event} events
			</Text>
			{sections.map((section) => {
				const hits = search.results.filter((hit) => hit.kind === section.kind);
				if (!hits.length) return null;
				return (
					<View key={section.kind}>
						<Text style={styles.sectionLabel}>
							{section.label} ({search.counts[section.kind]})
						</Text>
						{hits.map((hit) => (
							<SearchRow
								key={`${hit.kind}-${hit.id}`}
								hit={hit}
								onPress={() =>
									hit.kind === "event"
										? onEvent(hit.id)
										: onEntity(hit.id, hit.kind)
								}
								styles={styles}
							/>
						))}
					</View>
				);
			})}
		</ScrollView>
	);
}

function SearchRow({
	hit,
	onPress,
	styles,
}: {
	hit: AtlasSearchHit;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${hit.name}${hit.disambiguator ? `, ${hit.disambiguator}` : ""}, ${hitKindLabel(hit.kind)}`}
			onPress={onPress}
			style={({ pressed }) => [styles.hitRow, pressed && styles.pressed]}
		>
			<View style={styles.hitCopy}>
				<Text style={styles.hitName}>{hit.name}</Text>
				{hit.disambiguator ? (
					<Text style={styles.disambiguator}>{hit.disambiguator}</Text>
				) : null}
				<Text numberOfLines={2} style={styles.hitDescription}>
					{hit.description}
				</Text>
				<Text style={styles.hitMeta}>
					{hitKindLabel(hit.kind)}
					{hit.yearLabel
						? ` · ${searchHitDateLabel(hit)}`
						: hit.era
							? ` · ${hit.era}`
							: ""}
					{hit.refs[0] ? ` · ${hit.refs[0]}` : ""}
				</Text>
			</View>
			<Text style={styles.chevron}>›</Text>
		</Pressable>
	);
}

function BrowseResults({
	mode,
	groups,
	directory,
	chapterView,
	chapterScope,
	onEntity,
	onEvent,
	styles,
	tabBarSpace,
}: {
	mode: AtlasMode;
	groups: ReturnType<typeof getTimeline>;
	directory: AtlasEntitySummary[];
	chapterView: AtlasChapterView | null;
	chapterScope: { name: string; chapter: number } | null;
	onEntity: (id: string, kind: "person" | "place") => void;
	onEvent: (id: string) => void;
	styles: ReturnType<typeof createStyles>;
	tabBarSpace: number;
}) {
	if (mode !== "timeline")
		return (
			<FlatList
				data={directory}
				keyExtractor={(item) => `${item.kind}-${item.id}`}
				contentContainerStyle={[
					styles.content,
					{ paddingBottom: tabBarSpace + spacing.xl },
				]}
				ListEmptyComponent={
					<EmptyCard
						text={`No ${mode} entries match this filter.`}
						styles={styles}
					/>
				}
				renderItem={({ item }) => (
					<EntityRow
						entity={item}
						onPress={() => onEntity(item.id, item.kind)}
						styles={styles}
					/>
				)}
			/>
		);
	const events = groups.flatMap((group) =>
		group.events.map((event, index) => ({
			event,
			label: index === 0 ? group.era : undefined,
		})),
	);
	return (
		<FlatList
			data={events}
			keyExtractor={(item) => item.event.id}
			contentContainerStyle={[
				styles.content,
				{ paddingBottom: tabBarSpace + spacing.xl },
			]}
			ListHeaderComponent={
				chapterScope && chapterView ? (
					<ChapterHeader
						view={chapterView}
						scope={chapterScope}
						onEntity={onEntity}
						styles={styles}
					/>
				) : null
			}
			ListEmptyComponent={
				<EmptyCard
					text={emptyTimelineMessage({
						...(chapterScope
							? { book: chapterScope.name, chapter: chapterScope.chapter }
							: {}),
					})}
					styles={styles}
				/>
			}
			renderItem={({ item, index }) => (
				<TimelineStop
					glyph="✦"
					label={item.label}
					last={index === events.length - 1}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`${item.event.title}, ${eventDateLabel(item.event)}`}
						onPress={() => onEvent(item.event.id)}
						style={({ pressed }) => [
							styles.eventCard,
							pressed && styles.pressed,
						]}
					>
						<Text style={styles.eventYear}>{eventDateLabel(item.event)}</Text>
						<Text style={styles.eventProvenance}>
							{eventDateProvenanceLabel(item.event)}
						</Text>
						<Text style={styles.eventTitle}>{item.event.title}</Text>
						<Text numberOfLines={3} style={styles.eventSummary}>
							{item.event.summary}
						</Text>
						<Text style={styles.eventRefs}>{item.event.refs.join(" · ")}</Text>
					</Pressable>
				</TimelineStop>
			)}
			ListFooterComponent={
				<View>
					<Text style={styles.sectionLabel}>CHRONOLOGY</Text>
					<Text style={styles.footnote}>{USSHER_NOTE}</Text>
				</View>
			}
		/>
	);
}

function ChapterHeader({
	view,
	scope,
	onEntity,
	styles,
}: {
	view: AtlasChapterView;
	scope: { name: string; chapter: number };
	onEntity: (id: string, kind: "person" | "place") => void;
	styles: ReturnType<typeof createStyles>;
}) {
	const entities = view ? [...view.people, ...view.places] : [];
	return (
		<View style={styles.chapterHeader}>
			<Text style={styles.sectionLabel}>WHO&apos;S IN THIS CHAPTER</Text>
			{entities.length === 0 ? (
				<Text style={styles.hint}>
					The atlas records no one and nowhere by name in {scope.name}{" "}
					{scope.chapter}.
				</Text>
			) : (
				<View style={styles.chips}>
					{entities.map((entity) => (
						<Pressable
							key={`${entity.kind}-${entity.id}`}
							accessibilityRole="button"
							accessibilityLabel={`${entity.name}${entity.disambiguator ? `, ${entity.disambiguator}` : ""}`}
							onPress={() => onEntity(entity.id, entity.kind)}
							style={styles.entityChip}
						>
							<Text style={styles.entityChipLabel}>{entity.name}</Text>
							{entity.disambiguator ? (
								<Text style={styles.chipDisambiguator}>{entity.disambiguator}</Text>
							) : null}
						</Pressable>
					))}
				</View>
			)}
		</View>
	);
}

function EntityRow({
	entity,
	onPress,
	styles,
}: {
	entity: AtlasEntitySummary;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${entity.name}${entity.disambiguator ? `, ${entity.disambiguator}` : ""}, ${entity.kind}`}
			onPress={onPress}
			style={({ pressed }) => [styles.hitRow, pressed && styles.pressed]}
		>
			<View style={styles.hitCopy}>
				<Text style={styles.hitName}>{entity.name}</Text>
				{entity.disambiguator ? (
					<Text style={styles.disambiguator}>{entity.disambiguator}</Text>
				) : null}
				<Text numberOfLines={2} style={styles.hitDescription}>
					{entity.description}
				</Text>
				<Text style={styles.hitMeta}>
					{entity.kind === "person" ? "Person" : "Place"}
					{entity.era
						? ` · ${entity.era}`
						: entity.modernRegion
							? ` · ${entity.modernRegion}`
							: ""}
				</Text>
			</View>
			<Text style={styles.chevron}>›</Text>
		</Pressable>
	);
}

function EmptyCard({
	text,
	styles,
}: {
	text: string;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<GlassCard style={styles.emptyCard}>
			<Text style={styles.emptyText}>{text}</Text>
		</GlassCard>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		topBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		headerControl: { minHeight: 48, justifyContent: "center" },
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		topBarSpacer: { width: 52 },
		searchWrap: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginHorizontal: spacing.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.full,
			paddingHorizontal: spacing.lg,
		},
		searchInput: { flex: 1, minHeight: 48, color: c.text, fontSize: 14 },
		clearButton: {
			minWidth: 48,
			minHeight: 48,
			alignItems: "center",
			justifyContent: "center",
		},
		modeRow: {
			flexDirection: "row",
			gap: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.md,
		},
		modeChip: {
			minHeight: 48,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
		},
		modeChipActive: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		modeLabel: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
		modeLabelActive: { color: c.accent },
		eraScroll: { flexGrow: 0, flexShrink: 0 },
		eraRow: {
			gap: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		eraChip: {
			minHeight: 48,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			alignItems: "center",
			justifyContent: "center",
		},
		eraChipActive: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		eraChipLabel: { color: c.textMuted, fontSize: 12.5, fontWeight: "600" },
		eraChipLabelActive: { color: c.accent },
		content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
		searchCounts: {
			color: c.textFaint,
			fontSize: 12,
			paddingVertical: spacing.sm,
		},
		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: spacing.sm,
			paddingBottom: spacing.sm,
		},
		chapterHeader: { gap: spacing.sm, paddingBottom: spacing.lg },
		hint: { color: c.textFaint, fontSize: 13, lineHeight: 19 },
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		entityChip: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
		},
		entityChipLabel: {
			color: c.textSecondary,
			fontSize: 13,
			fontWeight: "600",
		},
		eventCard: {
			gap: 4,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		eventYear: {
			color: c.accent,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 0.6,
			fontVariant: ["tabular-nums"],
		},
		eventProvenance: { color: c.textGhost, fontSize: 11 },
		eventTitle: {
			color: c.text,
			fontSize: 15.5,
			fontWeight: "700",
			lineHeight: 21,
		},
		eventSummary: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
		eventRefs: { color: c.textGhost, fontSize: 11.5, paddingTop: 2 },
		pressed: { opacity: 0.72 },
		hitRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			marginBottom: spacing.sm,
			minHeight: 64,
		},
		hitCopy: { flex: 1, gap: 3 },
		hitName: { color: c.text, fontSize: 15, fontWeight: "700" },
		disambiguator: { color: c.textFaint, fontSize: 11.5 },
		chipDisambiguator: { color: c.textFaint, fontSize: 10.5 },
		hitDescription: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
		hitMeta: { color: c.textGhost, fontSize: 11.5 },
		chevron: { color: c.textFaint, fontSize: 18, fontWeight: "600" },
		emptyCard: { padding: spacing.lg, marginTop: spacing.md },
		emptyText: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
		footnote: {
			color: c.textGhost,
			fontSize: 11.5,
			lineHeight: 17,
			paddingTop: spacing.md,
			paddingBottom: spacing.lg,
		},
		center: { flex: 1, justifyContent: "center", padding: spacing.lg },
	});

import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassCard, Screen } from "@/components/ui";
import { BottomSheet } from "@/features/notes/components/primitives";
import { TimelineStop } from "@/features/cross/TimelineStop";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder } from "@/features/bible/books";
import {
	getTimeline,
	openLocationFor,
	searchAtlas,
	whoIsIn,
	type AtlasEntityRef,
	type AtlasEra,
	type AtlasEventView,
	type AtlasSearchHit,
} from "@/features/atlas/atlas";
import {
	askPromptForEvent,
	emptyTimelineMessage,
	eraChips,
	eventCaption,
	hitKindLabel,
} from "@/features/atlas/atlasView";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

type Row =
	| { key: string; kind: "event"; event: AtlasEventView; label?: string; last: boolean }
	| { key: string; kind: "hit"; hit: AtlasSearchHit }
	| { key: string; kind: "empty"; message: string };

/**
 * Timeline, People & Places: the events of Bible history on one gold rail,
 * divided into the nine eras, with every person and place searchable by name.
 *
 * Everything here reads the bundled atlas, so it works offline like the Bible
 * reader. Opened plain from the Bible tab, or with ?book=&chapter= from the
 * chapter reader's "Who's in this chapter", which narrows the whole screen to
 * what the user is reading. Mirrors src/app/bible/timeline/page.tsx on web.
 */
export default function BibleTimelineScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{ book?: string; chapter?: string }>();

	const order = Number.parseInt(typeof params.book === "string" ? params.book : "", 10);
	const chapter = Number.parseInt(typeof params.chapter === "string" ? params.chapter : "", 10);
	const chapterScope =
		Number.isInteger(order) && Number.isInteger(chapter) && bookByOrder(order)
			? { order, chapter, name: bookByOrder(order)!.name }
			: null;

	const [query, setQuery] = useState("");
	const [era, setEra] = useState<AtlasEra | null>(null);
	const [openEvent, setOpenEvent] = useState<AtlasEventView | null>(null);

	const trimmed = query.trim();

	const chapterView = useMemo(
		() => (chapterScope ? whoIsIn(chapterScope.order, chapterScope.chapter) : null),
		[chapterScope?.order, chapterScope?.chapter]
	);

	const groups = useMemo(
		() =>
			getTimeline({
				...(era ? { era } : {}),
				...(chapterScope ? { book: chapterScope.order, chapter: chapterScope.chapter } : {}),
			}),
		[era, chapterScope?.order, chapterScope?.chapter]
	);

	const hits = useMemo(() => (trimmed ? searchAtlas(trimmed) : []), [trimmed]);

	const rows: Row[] = useMemo(() => {
		if (trimmed) {
			if (hits.length === 0) {
				return [
					{
						key: "empty",
						kind: "empty",
						message: `Nothing in the atlas is called “${trimmed}”. Try another spelling, or the name the KJV uses.`,
					},
				];
			}
			return hits.map((hit) => ({ key: `hit-${hit.kind}-${hit.id}`, kind: "hit" as const, hit }));
		}

		const total = groups.reduce((sum, group) => sum + group.events.length, 0);
		if (total === 0) {
			return [
				{
					key: "empty",
					kind: "empty",
					message: emptyTimelineMessage({
						...(chapterScope ? { book: chapterScope.name, chapter: chapterScope.chapter } : {}),
						...(era ? { era } : {}),
					}),
				},
			];
		}

		const built: Row[] = [];
		groups.forEach((group, groupIndex) => {
			// The rail carries the era label on its first stop, so an era needs
			// no heading row of its own.
			group.events.forEach((event, index) => {
				built.push({
					key: `event-${event.id}`,
					kind: "event",
					event,
					...(index === 0 ? { label: group.era } : {}),
					last: groupIndex === groups.length - 1 && index === group.events.length - 1,
				});
			});
		});
		return built;
	}, [trimmed, hits, groups, era, chapterScope?.name, chapterScope?.chapter]);

	const openEntity = useCallback(
		(id: string) => {
			setOpenEvent(null);
			router.push({ pathname: "/bible/atlas/[id]", params: { id } });
		},
		[router]
	);

	const openReference = useCallback(
		(reference: string) => {
			const location = openLocationFor(reference);
			if (!location) return;
			setOpenEvent(null);
			router.push({
				pathname: "/bible/chapter",
				params: {
					book: String(location.book.order),
					chapter: String(location.chapter),
					verse: location.verse ? String(location.verse) : "",
				},
			});
		},
		[router]
	);

	const askAboutEvent = useCallback(
		(event: AtlasEventView) => {
			setOpenEvent(null);
			router.push({ pathname: "/", params: { prompt: askPromptForEvent(event) } });
		},
		[router]
	);

	const openHit = useCallback(
		(hit: AtlasSearchHit) => {
			if (hit.kind === "event") {
				const found = getTimeline().flatMap((group) => group.events).find((e) => e.id === hit.id);
				if (found) setOpenEvent(found);
				return;
			}
			openEntity(hit.id);
		},
		[openEntity]
	);

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					{chapterScope ? `${chapterScope.name} ${chapterScope.chapter}` : "Timeline & People"}
				</Text>
				<View style={styles.topBarSpacer} />
			</View>

			<View style={styles.searchWrap}>
				<Ionicons name="search" size={15} color={colors.textFaint} />
				<TextInput
					value={query}
					onChangeText={setQuery}
					placeholder="Search people, places and events"
					placeholderTextColor={colors.textFaint}
					accessibilityLabel="Search the Bible atlas"
					autoCorrect={false}
					returnKeyType="search"
					style={styles.searchInput}
				/>
				{query.length > 0 ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Clear search"
						onPress={() => setQuery("")}
						hitSlop={8}
					>
						<Ionicons name="close-circle" size={17} color={colors.textFaint} />
					</Pressable>
				) : null}
			</View>

			{!trimmed && !chapterScope ? (
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.eraScroll}
					contentContainerStyle={styles.eraRow}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ selected: era === null }}
						onPress={() => setEra(null)}
						style={[styles.eraChip, era === null && styles.eraChipActive]}
					>
						<Text style={[styles.eraChipLabel, era === null && styles.eraChipLabelActive]}>
							All
						</Text>
					</Pressable>
					{eraChips().map((chip) => (
						<Pressable
							key={chip.era}
							accessibilityRole="button"
							accessibilityLabel={chip.era}
							accessibilityState={{ selected: era === chip.era }}
							onPress={() => setEra(era === chip.era ? null : chip.era)}
							style={[styles.eraChip, era === chip.era && styles.eraChipActive]}
						>
							<Text style={[styles.eraChipLabel, era === chip.era && styles.eraChipLabelActive]}>
								{chip.label}
							</Text>
						</Pressable>
					))}
				</ScrollView>
			) : null}

			<FlatList
				data={rows}
				keyExtractor={(row) => row.key}
				contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.xl }]}
				keyboardShouldPersistTaps="handled"
				ListHeaderComponent={
					chapterScope && chapterView && !trimmed ? (
						<View style={styles.chapterHeader}>
							<Text style={styles.sectionLabel}>WHO&apos;S IN THIS CHAPTER</Text>
							{chapterView.people.length === 0 && chapterView.places.length === 0 ? (
								<Text style={styles.hint}>
									The atlas records no one and nowhere by name in {chapterScope.name}{" "}
									{chapterScope.chapter}.
								</Text>
							) : (
								<View style={styles.chips}>
									{[...chapterView.people, ...chapterView.places].map((entity) => (
										<EntityChip key={`${entity.kind}-${entity.id}`} entity={entity} onPress={openEntity} />
									))}
								</View>
							)}
						</View>
					) : null
				}
				renderItem={({ item }) => {
					if (item.kind === "empty") {
						return (
							<GlassCard style={styles.emptyCard}>
								<Text style={styles.emptyText}>{item.message}</Text>
							</GlassCard>
						);
					}

					if (item.kind === "hit") {
						const hit = item.hit;
						return (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`${hit.name}, ${hitKindLabel(hit.kind)}`}
								onPress={() => openHit(hit)}
								style={({ pressed }) => [styles.hitRow, pressed && styles.pressed]}
							>
								<View style={styles.hitCopy}>
									<Text style={styles.hitName}>{hit.name}</Text>
									<Text numberOfLines={2} style={styles.hitDescription}>
										{hit.description}
									</Text>
									<Text style={styles.hitMeta}>
										{hitKindLabel(hit.kind)}
										{hit.yearLabel ? ` · ${hit.yearLabel}` : hit.era ? ` · ${hit.era}` : ""}
										{` · ${hit.refs[0]}`}
									</Text>
								</View>
								<Text style={styles.chevron}>›</Text>
							</Pressable>
						);
					}

					const event = item.event;
					return (
						<TimelineStop glyph="✦" label={item.label} last={item.last}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`${event.title}, ${event.yearLabel}`}
								onPress={() => setOpenEvent(event)}
								style={({ pressed }) => [styles.eventCard, pressed && styles.pressed]}
							>
								<Text style={styles.eventYear}>{event.yearLabel}</Text>
								<Text style={styles.eventTitle}>{event.title}</Text>
								<Text numberOfLines={3} style={styles.eventSummary}>
									{event.summary}
								</Text>
								<Text style={styles.eventRefs}>{event.refs.join(" · ")}</Text>
							</Pressable>
						</TimelineStop>
					);
				}}
				ListFooterComponent={
					trimmed ? null : (
						<Text style={styles.footnote}>
							Dates follow the traditional Ussher chronology carried in the margins of the King
							James Bible. They are a reckoning from the genealogies of Scripture, not part of the
							text itself.
						</Text>
					)
				}
			/>

			<BottomSheet
				visible={openEvent !== null}
				onClose={() => setOpenEvent(null)}
				title={openEvent?.title}
			>
				{openEvent ? (
					<ScrollView contentContainerStyle={styles.sheetBody}>
						<Text style={styles.sheetCaption}>{eventCaption(openEvent)}</Text>
						<Text style={styles.sheetSummary}>{openEvent.summary}</Text>

						<Text style={styles.sectionLabel}>IN SCRIPTURE</Text>
						<View style={styles.chips}>
							{openEvent.refs.map((reference) => (
								<Pressable
									key={reference}
									accessibilityRole="button"
									accessibilityLabel={`Read ${reference}`}
									onPress={() => openReference(reference)}
									style={({ pressed }) => [styles.refChip, pressed && styles.pressed]}
								>
									<Text style={styles.refChipLabel}>{reference} ›</Text>
								</Pressable>
							))}
						</View>

						{openEvent.people.length > 0 || openEvent.places.length > 0 ? (
							<>
								<Text style={styles.sectionLabel}>WHO AND WHERE</Text>
								<View style={styles.chips}>
									{[...openEvent.people, ...openEvent.places].map((entity) => (
										<EntityChip
											key={`${entity.kind}-${entity.id}`}
											entity={entity}
											onPress={openEntity}
										/>
									))}
								</View>
							</>
						) : null}

						<Pressable
							accessibilityRole="button"
							onPress={() => askAboutEvent(openEvent)}
							style={({ pressed }) => [
								styles.askButton,
								pressed && { backgroundColor: colors.accentPressed },
							]}
						>
							<Text style={styles.askLabel}>✦ Ask about this</Text>
						</Pressable>
					</ScrollView>
				) : null}
			</BottomSheet>
		</Screen>
	);
}

/** A person/place pill that opens their entry. */
function EntityChip({
	entity,
	onPress,
}: {
	entity: AtlasEntityRef;
	onPress: (id: string) => void;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={entity.name}
			onPress={() => onPress(entity.id)}
			style={({ pressed }) => [styles.entityChip, pressed && styles.pressed]}
		>
			<Ionicons
				name={entity.kind === "person" ? "person-outline" : "location-outline"}
				size={12}
				color={colors.textMuted}
			/>
			<Text style={styles.entityChipLabel}>{entity.name}</Text>
		</Pressable>
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
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: { flex: 1, color: c.text, fontSize: 15, fontWeight: "600", textAlign: "center" },
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
			paddingVertical: 6,
		},
		searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 6 },

		// A horizontal ScrollView carries RN's baseHorizontal style
		// (flexGrow/flexShrink: 1) and Yoga measures its full content, so the
		// long event list below squeezes the chip row down to a sliver. Pin the
		// row to its own height and let the list take what is left.
		eraScroll: { flexGrow: 0, flexShrink: 0 },
		eraRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
		eraChip: {
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			paddingVertical: 7,
		},
		eraChipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		eraChipLabel: { color: c.textMuted, fontSize: 12.5, fontWeight: "600" },
		eraChipLabelActive: { color: c.accent },

		content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
		chapterHeader: { gap: spacing.sm, paddingBottom: spacing.lg },
		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: spacing.sm,
		},
		hint: { color: c.textFaint, fontSize: 13, lineHeight: 19 },
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

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
		eventTitle: { color: c.text, fontSize: 15.5, fontWeight: "700", lineHeight: 21 },
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
		},
		hitCopy: { flex: 1, gap: 3 },
		hitName: { color: c.text, fontSize: 15, fontWeight: "700" },
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

		entityChip: {
			flexDirection: "row",
			alignItems: "center",
			gap: 5,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
			paddingVertical: 7,
		},
		entityChipLabel: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },

		refChip: {
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.md,
			paddingVertical: 7,
		},
		refChipLabel: { color: c.accent, fontSize: 13, fontWeight: "700" },

		sheetBody: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
		sheetCaption: { color: c.textFaint, fontSize: 12.5, fontWeight: "600" },
		sheetSummary: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22 },
		askButton: {
			marginTop: spacing.lg,
			minHeight: 48,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		askLabel: { color: c.accent, fontSize: 15, fontWeight: "700" },
	});

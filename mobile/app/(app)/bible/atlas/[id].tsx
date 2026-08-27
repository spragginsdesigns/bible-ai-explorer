import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlassCard, Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import {
	atlasNeighborhood,
	getAtlasEntity,
	openLocationFor,
	type AtlasEntityRef,
	type AtlasNeighborhoodEntry,
} from "@/features/atlas/atlas";
import {
	alsoCalledLine,
	askPromptForEntity,
	entityCounts,
	entitySubtitle,
	relationCertaintyLabel,
} from "@/features/atlas/atlasView";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

/**
 * One person or place of Scripture: what the Bible says about them, the names
 * it also calls them by, their key verses as chips that open the reader, who
 * and where they are connected to, the events they appear in, and a button
 * that carries them into chat.
 *
 * Mirrors the entity panel in src/components/atlas/AtlasScreen.tsx on web.
 */
export default function AtlasEntityScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{
		id?: string;
		q?: string;
		mode?: string;
		era?: string;
		personId?: string;
		book?: string;
		chapter?: string;
	}>();
	const id = typeof params.id === "string" ? params.id : "";

	const entity = useMemo(() => (id ? getAtlasEntity(id) : null), [id]);
	const neighborhood = useMemo(
		() => entity?.relationDetails ?? (id ? atlasNeighborhood(id) : []),
		[entity, id],
	);

	const openReference = useCallback(
		(reference: string) => {
			const location = openLocationFor(reference);
			if (!location) return;
			router.push({
				pathname: "/bible/chapter",
				params: {
					book: String(location.book.order),
					chapter: String(location.chapter),
					verse: location.verse ? String(location.verse) : "",
				},
			});
		},
		[router],
	);

	const openRelated = useCallback(
		(related: AtlasEntityRef) => {
			router.push({
				pathname: "/bible/atlas/[id]",
				params: { id: related.id },
			});
		},
		[router],
	);

	const ask = useCallback(() => {
		if (!entity) return;
		router.push({
			pathname: "/",
			params: { prompt: askPromptForEntity(entity) },
		});
	}, [router, entity]);

	const openEvent = useCallback(
		(eventId: string) => {
			router.push({
				pathname: "/bible/atlas/event/[id]",
				params: {
					id: eventId,
					detail: `event:${eventId}`,
					q: params.q,
					mode: params.mode,
					era: params.era,
					personId: params.personId,
					book: params.book,
					chapter: params.chapter,
				},
			});
		},
		[router],
	);

	const openJourney = useCallback(() => {
		if (!entity || entity.kind !== "person") return;
		router.push({
			pathname: "/bible/timeline",
			params: {
				mode: "timeline",
				personId: entity.id,
				q: "",
				era: "",
				detail: "",
			},
		});
	}, [router, entity]);

	const openFamily = useCallback(() => {
		if (!entity || entity.kind !== "person") return;
		router.push({
			pathname: "/bible/atlas/family/[id]",
			params: { id: entity.id, detail: `person:${entity.id}` },
		});
	}, [router, entity]);

	const openTrace = useCallback(() => {
		if (!entity || entity.kind !== "person") return;
		router.push({
			pathname: "/bible/atlas/trace/[id]",
			params: { id: entity.id, detail: `person:${entity.id}` },
		});
	}, [router, entity]);

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable
					accessibilityRole="button"
					onPress={() => router.back()}
					hitSlop={8}
					style={styles.headerButton}
				>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					{entity?.name ?? "Not found"}
				</Text>
				<View style={styles.topBarSpacer} />
			</View>

			{!entity ? (
				<View style={styles.center}>
					<GlassCard style={styles.emptyCard}>
						<Text style={styles.emptyText}>
							That entry is not in the Bible atlas. Search for the name the King
							James Bible uses for them.
						</Text>
					</GlassCard>
				</View>
			) : (
				<ScrollView
					contentContainerStyle={[
						styles.content,
						{ paddingBottom: tabBarSpace + spacing.xl },
					]}
				>
					<Text style={styles.name}>{entity.name}</Text>
					{entity.disambiguator ? (
						<Text style={styles.disambiguator}>{entity.disambiguator}</Text>
					) : null}
					<Text style={styles.subtitle}>{entitySubtitle(entity)}</Text>
					{alsoCalledLine(entity) ? (
						<Text style={styles.alsoCalled}>{alsoCalledLine(entity)}</Text>
					) : null}

					<GlassCard style={styles.descriptionCard}>
						<Text style={styles.description}>{entity.description}</Text>
						<Text style={styles.counts}>{entityCounts(entity)}</Text>
					</GlassCard>

					<Text style={styles.sectionLabel}>IN SCRIPTURE</Text>
					<View style={styles.chips}>
						{entity.refs.map((reference) => (
							<Pressable
								key={reference}
								accessibilityRole="button"
								accessibilityLabel={`Read ${reference}`}
								onPress={() => openReference(reference)}
								style={({ pressed }) => [
									styles.refChip,
									pressed && styles.pressed,
								]}
							>
								<Text style={styles.refChipLabel}>{reference} ›</Text>
							</Pressable>
						))}
					</View>

					{entity.related.length > 0 || neighborhood.length > 0 ? (
						<>
							<Text style={styles.sectionLabel}>CONNECTED TO</Text>
							<View style={styles.chips}>
								{neighborhood.length > 0
									? neighborhood.map((entry) => (
											<RelationRow
												key={entry.relation.id}
												entry={entry}
												onPress={openRelated}
												onReference={openReference}
												styles={styles}
											/>
										))
									: entity.related.map((related) => (
											<Pressable
												key={`${related.kind}-${related.id}`}
												accessibilityRole="button"
												accessibilityLabel={related.name}
												onPress={() => openRelated(related)}
												style={({ pressed }) => [
													styles.entityChip,
													pressed && styles.pressed,
												]}
											>
												<Ionicons
													name={
														related.kind === "person"
															? "person-outline"
															: "location-outline"
													}
													size={12}
													color={colors.textMuted}
												/>
												<Text style={styles.entityChipLabel}>
													{related.name}
												</Text>
											</Pressable>
										))}
							</View>
						</>
					) : null}

					{entity.events.length > 0 ? (
						<>
							<Text style={styles.sectionLabel}>ON THE TIMELINE</Text>
							{entity.events.slice(0, 5).map((event) => (
								<Pressable
									key={event.id}
									accessibilityRole="button"
									accessibilityLabel={`Open event ${event.title}`}
									onPress={() => openEvent(event.id)}
									style={({ pressed }) => [
										styles.eventRow,
										pressed && styles.pressed,
									]}
								>
									<Text style={styles.eventYear}>{event.yearLabel}</Text>
									<View style={styles.eventCopy}>
										<Text style={styles.eventTitle}>{event.title}</Text>
										<Text style={styles.eventEra}>{event.era}</Text>
									</View>
									<Text style={styles.chevron}>›</Text>
								</Pressable>
							))}
							{entity.events.length > 5 ? (
								<Pressable
									accessibilityRole="button"
									onPress={openJourney}
									style={styles.viewAll}
								>
									<Text style={styles.viewAllLabel}>
										View all {entity.events.length} events ›
									</Text>
								</Pressable>
							) : null}
						</>
					) : null}

					{entity.kind === "person" ? (
						<View style={styles.actionRow}>
							<Pressable
								accessibilityRole="button"
								onPress={openJourney}
								style={styles.actionChip}
							>
								<Text style={styles.actionLabel}>View journey</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								onPress={openFamily}
								style={styles.actionChip}
							>
								<Text style={styles.actionLabel}>Immediate family</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								onPress={openTrace}
								style={styles.actionChip}
							>
								<Text style={styles.actionLabel}>Trace connection</Text>
							</Pressable>
						</View>
					) : null}

					<Pressable
						accessibilityRole="button"
						onPress={ask}
						style={({ pressed }) => [
							styles.askButton,
							pressed && { backgroundColor: colors.accentPressed },
						]}
					>
						<Text style={styles.askLabel}>✦ Ask about this</Text>
					</Pressable>
				</ScrollView>
			)}
		</Screen>
	);
}

function RelationRow({
	entry,
	onPress,
	onReference,
	styles,
}: {
	entry: AtlasNeighborhoodEntry;
	onPress: (related: AtlasEntityRef) => void;
	onReference: (reference: string) => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.relationRow}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${entry.label} ${entry.entity.name}${entry.entity.disambiguator ? `, ${entry.entity.disambiguator}` : ""}`}
				onPress={() =>
					onPress({
						id: entry.entity.id,
						kind: entry.entity.kind,
						name: entry.entity.name,
						...(entry.entity.disambiguator
							? { disambiguator: entry.entity.disambiguator }
							: {}),
					})
				}
				style={({ pressed }) => [
					styles.relationTarget,
					pressed && styles.pressed,
				]}
			>
				<View style={styles.eventCopy}>
					<Text style={styles.relationType}>
						{entry.label} {entry.entity.name}
					</Text>
					{entry.entity.disambiguator ? (
						<Text style={styles.disambiguator}>{entry.entity.disambiguator}</Text>
					) : null}
					<Text style={styles.relationMeta}>
						{relationCertaintyLabel(entry.relation.certainty)}
					</Text>
				</View>
				<Text style={styles.chevron}>›</Text>
			</Pressable>
			{entry.relation.refs.length > 0 ? (
				<View style={styles.relationRefs}>
					{entry.relation.refs.map((reference) => (
						<Pressable
							key={reference}
							accessibilityRole="button"
							accessibilityLabel={`Read ${reference}`}
							onPress={() => onReference(reference)}
							style={styles.refChip}
						>
							<Text style={styles.refChipLabel}>{reference} ›</Text>
						</Pressable>
					))}
				</View>
			) : null}
		</View>
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
		headerButton: { minHeight: 48, justifyContent: "center" },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		topBarSpacer: { width: 52 },

		center: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			padding: spacing.lg,
		},
		emptyCard: { padding: spacing.lg },
		emptyText: {
			color: c.textSecondary,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
		},

		content: { paddingHorizontal: spacing.lg, gap: spacing.xs },
		name: { fontFamily: fonts.brand, fontSize: 30, color: c.text },
		disambiguator: { color: c.textFaint, fontSize: 12, marginTop: 2 },
		subtitle: { color: c.textMuted, fontSize: 13 },
		alsoCalled: { color: c.textFaint, fontSize: 12.5, fontStyle: "italic" },

		descriptionCard: {
			padding: spacing.lg,
			gap: spacing.sm,
			marginTop: spacing.md,
		},
		description: { color: c.textSecondary, fontSize: 15, lineHeight: 23 },
		counts: { color: c.textGhost, fontSize: 11.5 },

		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: spacing.lg,
			paddingBottom: spacing.xs,
		},
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		pressed: { opacity: 0.72 },

		refChip: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.md,
			paddingVertical: 7,
		},
		refChipLabel: { color: c.accent, fontSize: 13, fontWeight: "700" },

		entityChip: {
			minHeight: 48,
			justifyContent: "center",
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
		entityChipLabel: {
			color: c.textSecondary,
			fontSize: 13,
			fontWeight: "600",
		},

		eventRow: {
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
		eventYear: {
			width: 88,
			color: c.accent,
			fontSize: 11.5,
			fontWeight: "700",
			fontVariant: ["tabular-nums"],
		},
		eventCopy: { flex: 1, gap: 2 },
		eventTitle: { color: c.textSecondary, fontSize: 14, fontWeight: "600" },
		eventEra: { color: c.textGhost, fontSize: 11.5 },
		relationRow: {
			width: "100%",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			marginBottom: spacing.sm,
		},
		relationTarget: {
			minHeight: 48,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
		},
		relationRefs: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.md,
		},
		relationType: { color: c.textSecondary, fontSize: 13.5, fontWeight: "600" },
		relationMeta: { color: c.textGhost, fontSize: 11.5, marginTop: 3 },
		chevron: { color: c.textFaint, fontSize: 18, fontWeight: "600" },
		viewAll: { minHeight: 48, alignItems: "center", justifyContent: "center" },
		viewAllLabel: { color: c.accent, fontSize: 13.5, fontWeight: "700" },
		actionRow: { gap: spacing.sm, marginTop: spacing.lg },
		actionChip: {
			minHeight: 48,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		actionLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },

		askButton: {
			marginTop: spacing.xl,
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

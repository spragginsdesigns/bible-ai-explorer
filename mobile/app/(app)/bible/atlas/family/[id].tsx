import React, { useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import {
	atlasNeighborhood,
	getAtlasEntity,
	openLocationFor,
	type AtlasEntityRef,
	type AtlasNeighborhoodEntry,
} from "@/features/atlas/atlas";
import { relationCertaintyLabel } from "@/features/atlas/atlasView";
import { useTabBarSpace } from "@/features/chat/layout";
import { radius, spacing, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";

const FAMILY_TYPES = new Set(["parent", "spouse", "sibling"]);

/** Immediate family stays linear and accessible: one person/branch per route. */
export default function AtlasFamilyScreen() {
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{
		id?: string;
		q?: string;
		mode?: string;
		era?: string;
		personId?: string;
	}>();
	const id = typeof params.id === "string" ? params.id : "";
	const entity = useMemo(() => (id ? getAtlasEntity(id) : null), [id]);
	const family = useMemo(
		() =>
			id
				? atlasNeighborhood(id).filter((entry) =>
						FAMILY_TYPES.has(entry.relation.type),
					)
				: [],
		[id],
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
	const openEntity = useCallback(
		(target: AtlasEntityRef) =>
			router.push({
				pathname: "/bible/atlas/[id]",
				params: {
					id: target.id,
					detail: `${target.kind}:${target.id}`,
					q: params.q,
					mode: params.mode,
					era: params.era,
					personId: params.personId,
				},
			}),
		[router, params.q, params.mode, params.era, params.personId],
	);

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Back"
					onPress={() => router.back()}
					hitSlop={8}
					style={styles.backButton}
				>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					Immediate family
				</Text>
				<View style={styles.spacer} />
			</View>
			{!entity || entity.kind !== "person" ? (
				<View style={styles.center}>
					<GlassCard style={styles.card}>
						<Text style={styles.empty}>
							Immediate family is available for people in the atlas.
						</Text>
					</GlassCard>
				</View>
			) : (
				<FlatList
					data={family}
					keyExtractor={(item) => item.relation.id}
					contentContainerStyle={[
						styles.content,
						{ paddingBottom: tabBarSpace + spacing.xl },
					]}
					ListHeaderComponent={
						<View style={styles.intro}>
							<Text style={styles.name}>{entity.name}</Text>
							{entity.disambiguator ? (
								<Text style={styles.disambiguator}>{entity.disambiguator}</Text>
							) : null}
							<Text style={styles.subtitle}>
								One branch at a time · immediate family only
							</Text>
						</View>
					}
					ListEmptyComponent={
						<GlassCard style={styles.card}>
							<Text style={styles.empty}>
								No immediate-family connections are recorded for {entity.name}.
							</Text>
						</GlassCard>
					}
					renderItem={({ item }) => (
						<FamilyRow
							entry={item}
							onEntity={openEntity}
							onReference={openReference}
							styles={styles}
						/>
					)}
				/>
			)}
		</Screen>
	);
}

function FamilyRow({
	entry,
	onEntity,
	onReference,
	styles,
}: {
	entry: AtlasNeighborhoodEntry;
	onEntity: (entity: AtlasEntityRef) => void;
	onReference: (reference: string) => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.row}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${entry.label} ${entry.entity.name}${entry.entity.disambiguator ? `, ${entry.entity.disambiguator}` : ""}`}
				onPress={() => onEntity(entry.entity)}
				style={({ pressed }) => [styles.target, pressed && styles.pressed]}
			>
				<View style={styles.copy}>
					<Text style={styles.rowName}>
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
			<View style={styles.refs}>
				{entry.relation.refs.map((reference) => (
					<Pressable
						key={reference}
						accessibilityRole="button"
						accessibilityLabel={`Read ${reference}`}
						onPress={() => onReference(reference)}
						style={styles.refChip}
					>
						<Text style={styles.refLabel}>{reference} ›</Text>
					</Pressable>
				))}
			</View>
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
		backButton: { minHeight: 48, justifyContent: "center" },
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		spacer: { width: 52 },
		center: { flex: 1, justifyContent: "center", padding: spacing.lg },
		content: { paddingHorizontal: spacing.lg },
		intro: { paddingBottom: spacing.lg },
		name: { color: c.text, fontSize: 28, fontWeight: "700" },
		disambiguator: { color: c.textFaint, fontSize: 11.5, marginTop: 2 },
		subtitle: { color: c.textMuted, fontSize: 13, marginTop: spacing.xs },
		row: {
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			backgroundColor: c.surface,
			marginBottom: spacing.sm,
		},
		target: {
			minHeight: 64,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		copy: { flex: 1, gap: 3 },
		rowName: { color: c.text, fontSize: 15, fontWeight: "700" },
		relationMeta: { color: c.textGhost, fontSize: 11.5 },
		chevron: { color: c.textFaint, fontSize: 18 },
		refs: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.md,
		},
		refChip: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.md,
		},
		refLabel: { color: c.accent, fontSize: 12.5, fontWeight: "700" },
		pressed: { opacity: 0.72 },
		card: { padding: spacing.lg },
		empty: {
			color: c.textSecondary,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
		},
	});

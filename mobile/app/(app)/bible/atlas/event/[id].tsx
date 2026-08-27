import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import {
	getAtlasEvent,
	openLocationFor,
	type AtlasEntityRef,
} from "@/features/atlas/atlas";
import {
	askPromptForEvent,
	eventCaption,
	eventDateProvenanceLabel,
} from "@/features/atlas/atlasView";
import { useTabBarSpace } from "@/features/chat/layout";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

type Params = {
	id?: string;
	q?: string;
	mode?: string;
	era?: string;
	detail?: string;
	personId?: string;
	book?: string;
	chapter?: string;
};
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

export default function AtlasEventScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<Params>();
	const event = useMemo(
		() => (typeof params.id === "string" ? getAtlasEvent(params.id) : null),
		[params.id],
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
		(entity: AtlasEntityRef) =>
			router.push({
				pathname: "/bible/atlas/[id]",
				params: {
					...carry(params, {
						id: entity.id,
						detail: `${entity.kind}:${entity.id}`,
					}),
					id: entity.id,
				},
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
	if (!event)
		return (
			<Screen>
				<Header title="Event" onBack={() => router.back()} styles={styles} />
				<View style={styles.center}>
					<GlassCard style={styles.emptyCard}>
						<Text style={styles.emptyText}>
							That event is not in the Bible atlas.
						</Text>
					</GlassCard>
				</View>
			</Screen>
		);
	return (
		<Screen>
			<Header
				title={event.title}
				onBack={() => router.back()}
				styles={styles}
			/>
			<ScrollView
				contentContainerStyle={[
					styles.content,
					{ paddingBottom: tabBarSpace + spacing.xl },
				]}
			>
				<Text style={styles.name}>{event.title}</Text>
				<Text style={styles.caption}>{eventCaption(event)}</Text>
				<Text style={styles.provenance}>{eventDateProvenanceLabel(event)}</Text>
				<GlassCard style={styles.summaryCard}>
					<Text style={styles.summary}>{event.summary}</Text>
				</GlassCard>
				<Text style={styles.sectionLabel}>IN SCRIPTURE</Text>
				<View style={styles.chips}>
					{event.refs.map((reference) => (
						<Pressable
							key={reference}
							accessibilityRole="button"
							accessibilityLabel={`Read ${reference}`}
							onPress={() => openReference(reference)}
							style={styles.refChip}
						>
							<Text style={styles.refLabel}>{reference} ›</Text>
						</Pressable>
					))}
				</View>
				{event.people.length + event.places.length > 0 ? (
					<>
						<Text style={styles.sectionLabel}>WHO AND WHERE</Text>
						<View style={styles.chips}>
							{[...event.people, ...event.places].map((entity) => (
								<EntityChip
									key={`${entity.kind}-${entity.id}`}
									entity={entity}
									onPress={() => openEntity(entity)}
									styles={styles}
								/>
							))}
						</View>
					</>
				) : null}
				<Pressable
					accessibilityRole="button"
					onPress={() =>
						router.push({
							pathname: "/",
							params: { prompt: askPromptForEvent(event) },
						})
					}
					style={({ pressed }) => [
						styles.askButton,
						pressed && { backgroundColor: colors.accentPressed },
					]}
				>
					<Text style={styles.askLabel}>✦ Ask about this</Text>
				</Pressable>
			</ScrollView>
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
				accessibilityLabel="Back"
				onPress={onBack}
				hitSlop={8}
				style={styles.backButton}
			>
				<Text style={styles.back}>‹ Back</Text>
			</Pressable>
			<Text numberOfLines={1} style={styles.title}>
				{title}
			</Text>
			<View style={styles.spacer} />
		</View>
	);
}
function EntityChip({
	entity,
	onPress,
	styles,
}: {
	entity: AtlasEntityRef;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${entity.name}${entity.disambiguator ? `, ${entity.disambiguator}` : ""}, ${entity.kind}`}
			onPress={onPress}
			style={styles.entityChip}
		>
			<View>
				<Text style={styles.entityLabel}>{entity.name}</Text>
				{entity.disambiguator ? (
					<Text style={styles.disambiguator}>{entity.disambiguator}</Text>
				) : null}
			</View>
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
		backButton: { minHeight: 48, justifyContent: "center" },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		spacer: { width: 52 },
		center: { flex: 1, justifyContent: "center", padding: spacing.lg },
		emptyCard: { padding: spacing.lg },
		emptyText: {
			color: c.textSecondary,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
		},
		content: { paddingHorizontal: spacing.lg },
		name: { color: c.text, fontSize: 30, fontWeight: "700" },
		caption: { color: c.textMuted, fontSize: 13, marginTop: spacing.xs },
		provenance: { color: c.textGhost, fontSize: 11.5, marginTop: spacing.xs },
		summaryCard: { padding: spacing.lg, marginTop: spacing.lg },
		summary: { color: c.textSecondary, fontSize: 15, lineHeight: 23 },
		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: spacing.xl,
			paddingBottom: spacing.sm,
		},
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		refChip: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.md,
		},
		refLabel: { color: c.accent, fontSize: 13, fontWeight: "700" },
		entityChip: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
		},
		entityLabel: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
		disambiguator: { color: c.textFaint, fontSize: 10.5, marginTop: 2 },
		askButton: {
			minHeight: 48,
			marginTop: spacing.xl,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		askLabel: { color: c.accent, fontSize: 15, fontWeight: "700" },
	});

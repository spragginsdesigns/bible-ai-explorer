import React, { useMemo, useState } from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import {
	getAtlasEntity,
	openLocationFor,
	relationLabelFor,
	searchAtlasScoped,
	traceAtlasPeople,
	type AtlasPersonConnectionPath,
} from "@/features/atlas/atlas";
import { relationCertaintyLabel } from "@/features/atlas/atlasView";
import { useTabBarSpace } from "@/features/chat/layout";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

export default function AtlasTraceScreen() {
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const { colors } = useTheme();
	const params = useLocalSearchParams<{ id?: string }>();
	const fromId = typeof params.id === "string" ? params.id : "";
	const from = useMemo(
		() => (fromId ? getAtlasEntity(fromId) : null),
		[fromId],
	);
	const [query, setQuery] = useState("");
	const hits = useMemo(
		() =>
			query.trim()
				? searchAtlasScoped(query, "people", null, 12).results.filter(
						(hit) => hit.id !== fromId,
					)
				: [],
		[query, fromId],
	);
	const [targetId, setTargetId] = useState<string | null>(null);
	const path = useMemo(
		() => (targetId ? traceAtlasPeople(fromId, targetId) : null),
		[fromId, targetId],
	);
	if (!from || from.kind !== "person")
		return (
			<Screen>
				<Header onBack={() => router.back()} styles={styles} />
				<View style={styles.center}>
					<GlassCard style={styles.card}>
						<Text style={styles.empty}>
							Trace is available between people in the atlas.
						</Text>
					</GlassCard>
				</View>
			</Screen>
		);
	return (
		<Screen>
			<Header onBack={() => router.back()} styles={styles} />
			<ScrollView
				contentContainerStyle={[
					styles.content,
					{ paddingBottom: tabBarSpace + spacing.xl },
				]}
			>
				<Text style={styles.name}>Trace from {from.name}</Text>
				{from.disambiguator ? (
					<Text style={styles.disambiguator}>{from.disambiguator}</Text>
				) : null}
				<Text style={styles.subtitle}>
					Search for another person to find the shortest cited connection.
				</Text>
				<View style={styles.searchWrap}>
					<TextInput
						value={query}
						onChangeText={(value) => {
							setQuery(value);
							setTargetId(null);
						}}
						placeholder="Search a person"
						placeholderTextColor={colors.textFaint}
						accessibilityLabel="Search a person to trace"
						autoCorrect={false}
						style={styles.input}
					/>
				</View>
				{query.trim() && !targetId ? (
					<View style={styles.results}>
						{hits.map((hit) => (
							<Pressable
								key={hit.id}
								accessibilityRole="button"
								accessibilityLabel={`Trace to ${hit.name}${hit.disambiguator ? `, ${hit.disambiguator}` : ""}`}
								onPress={() => setTargetId(hit.id)}
								style={styles.result}
							>
								<Text style={styles.resultName}>{hit.name}</Text>
								{hit.disambiguator ? (
									<Text style={styles.disambiguator}>{hit.disambiguator}</Text>
								) : null}
								<Text numberOfLines={1} style={styles.resultMeta}>
									{hit.era ?? "Person"}
								</Text>
							</Pressable>
						))}
					</View>
				) : null}
				{targetId && path ? (
					<PathView
						path={path}
						onOpen={(id) =>
							router.push({
								pathname: "/bible/atlas/[id]",
								params: { id, detail: `person:${id}` },
							})
						}
						onReference={(reference) => {
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
						}}
						styles={styles}
					/>
				) : targetId ? (
					<GlassCard style={styles.card}>
						<Text style={styles.empty}>
							No reviewed connection was found between these people.
						</Text>
					</GlassCard>
				) : null}
			</ScrollView>
		</Screen>
	);
}
function Header({
	onBack,
	styles,
}: {
	onBack: () => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.topBar}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Back"
				onPress={onBack}
				style={styles.backButton}
			>
				<Text style={styles.back}>‹ Back</Text>
			</Pressable>
			<Text style={styles.title}>Trace connection</Text>
			<View style={styles.spacer} />
		</View>
	);
}
function PathView({
	path,
	onOpen,
	onReference,
	styles,
}: {
	path: AtlasPersonConnectionPath;
	onOpen: (id: string) => void;
	onReference: (reference: string) => void;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.path}>
			<Text style={styles.sectionLabel}>SHORTEST CITED PATH</Text>
			{path.entities.map((entity, index) => (
				<React.Fragment key={entity.id}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Open ${entity.name}${entity.disambiguator ? `, ${entity.disambiguator}` : ""}`}
						onPress={() => onOpen(entity.id)}
						style={styles.node}
					>
						<Text style={styles.nodeName}>{entity.name}</Text>
						{entity.disambiguator ? (
							<Text style={styles.disambiguator}>{entity.disambiguator}</Text>
						) : null}
					</Pressable>
					{path.relations[index] ? (
						<View style={styles.edge}>
							<Text style={styles.edgeType}>
								{relationLabelFor(
									path.relations[index],
									path.entities[index].id,
								)}
							</Text>
							<Text style={styles.edgeRefs}>
								{relationCertaintyLabel(path.relations[index].certainty)}
							</Text>
							<View style={styles.refs}>
								{path.relations[index].refs.map((reference) => (
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
					) : null}
				</React.Fragment>
			))}
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
		content: { paddingHorizontal: spacing.lg },
		name: { color: c.text, fontSize: 28, fontWeight: "700" },
		disambiguator: { color: c.textFaint, fontSize: 11.5, marginTop: 2 },
		subtitle: {
			color: c.textMuted,
			fontSize: 13,
			lineHeight: 19,
			marginTop: spacing.xs,
		},
		searchWrap: {
			marginTop: spacing.lg,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.lg,
		},
		input: { minHeight: 48, color: c.text, fontSize: 14 },
		results: { gap: spacing.sm, marginTop: spacing.md },
		result: {
			minHeight: 52,
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.lg,
		},
		resultName: { color: c.text, fontSize: 14.5, fontWeight: "700" },
		resultMeta: { color: c.textGhost, fontSize: 11.5, marginTop: 2 },
		path: { marginTop: spacing.lg },
		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginBottom: spacing.sm,
		},
		node: {
			minHeight: 48,
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.lg,
		},
		nodeName: { color: c.accent, fontSize: 15, fontWeight: "700" },
		edge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
		edgeType: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
		edgeRefs: { color: c.textGhost, fontSize: 11.5, marginTop: 2 },
		refs: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			marginTop: spacing.sm,
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
		center: { flex: 1, justifyContent: "center", padding: spacing.lg },
		card: { padding: spacing.lg },
		empty: {
			color: c.textSecondary,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
		},
	});

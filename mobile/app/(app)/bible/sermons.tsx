import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTabBarSpace } from "@/features/chat/layout";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	fetchSermonStudies,
	formatServiceDate,
	type SermonStudySummary,
} from "@/features/sermons/sermonApi";
import { radius, spacing, typography, type Colors } from "@/theme";

/**
 * Guided studies of this reader's own church services. An account whose church
 * has no ingest wired up gets an empty list, and the empty state says why
 * rather than reading like a failure.
 */
export default function SermonStudiesScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const bottom = useTabBarSpace();
	const [studies, setStudies] = useState<SermonStudySummary[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			setStudies(await fetchSermonStudies(getToken));
		} catch {
			setError("Could not load your sermon studies.");
		} finally {
			setBusy(false);
		}
	}, [getToken]);

	useFocusEffect(
		useCallback(() => {
			void load();
		}, [load])
	);

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()}>
					<Text style={styles.link}>‹ Bible</Text>
				</Pressable>
				<Text style={styles.screenTitle}>Sermon studies</Text>
			</View>
			<FlatList
				data={studies ?? []}
				keyExtractor={(study) => study.id}
				contentContainerStyle={{
					padding: spacing.lg,
					paddingBottom: bottom + spacing.xxl,
					gap: spacing.md,
				}}
				ListHeaderComponent={
					<Text style={styles.body}>
						A guided walk through each recorded service, so you can follow the message
						even when you could not be there.
					</Text>
				}
				ListEmptyComponent={
					busy ? (
						<ActivityIndicator color={colors.accent} />
					) : error ? (
						<View style={styles.card}>
							<Text accessibilityRole="alert" style={styles.body}>
								{error}
							</Text>
							<Pressable accessibilityRole="button" onPress={() => void load()}>
								<Text style={styles.link}>Try again</Text>
							</Pressable>
						</View>
					) : (
						<View style={styles.card}>
							<Text style={styles.title}>No studies yet</Text>
							<Text style={styles.body}>
								Studies appear here after a service is recorded and processed. Set your
								church in Settings to follow along.
							</Text>
						</View>
					)
				}
				renderItem={({ item }) => {
					const when = formatServiceDate(item.serviceDate);
					return (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Open ${item.title}`}
							onPress={() =>
								router.push({ pathname: "/bible/sermon", params: { id: item.id } })
							}
							style={styles.card}
						>
							{item.imageUrl ? (
								<Image
									source={{ uri: item.imageUrl }}
									style={styles.thumb}
									accessibilityIgnoresInvertColors
								/>
							) : null}
							<View style={styles.meta}>
								{when ? <Text style={styles.session}>{when}</Text> : null}
								{item.preachingText ? (
									<Text style={styles.reference}>{item.preachingText}</Text>
								) : null}
							</View>
							<Text style={styles.title}>{item.title}</Text>
							<Text numberOfLines={2} style={styles.body}>
								{item.bigIdea}
							</Text>
						</Pressable>
					);
				}}
			/>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: { padding: spacing.lg, gap: spacing.sm },
		screenTitle: { color: c.text, ...typography.screenTitle, fontWeight: "600" },
		title: { color: c.text, ...typography.control, fontWeight: "600" },
		link: { color: c.accent, ...typography.support, paddingVertical: spacing.sm },
		body: { color: c.textSecondary, ...typography.support },
		meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
		session: { color: c.textMuted, ...typography.meta },
		reference: { color: c.accent, ...typography.meta, fontWeight: "600" },
		thumb: {
			width: "100%",
			aspectRatio: 3 / 2,
			borderRadius: radius.lg,
			marginBottom: spacing.xs,
		},
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.sm,
		},
	});

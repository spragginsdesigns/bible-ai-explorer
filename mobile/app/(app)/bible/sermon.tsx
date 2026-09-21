import React, { useCallback, useState } from "react";
import {
	ActivityIndicator,
	Image,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTabBarSpace } from "@/features/chat/layout";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	fetchSermonStudy,
	formatTimestamp,
	watchUrl,
	type SermonStudyDetail,
} from "@/features/sermons/sermonApi";
import { radius, spacing, typography, type Colors } from "@/theme";

/**
 * One guided study. Two rules are visual as well as editorial: a quote is
 * marked as the preacher's own words, and SureWord's teaching carries its own
 * label so nothing written here can be mistaken for something said from the
 * pulpit.
 *
 * The dock at the foot is the Bible reader's dock (`bible/chapter.tsx`) in the
 * same shape: the recording on the left, chat on the right. Ask AI sends the
 * study's title as an ordinary question rather than a canned one - the
 * assistant reads the study itself with its own getSermonStudy tool, so there
 * is no hidden payload to keep in step with the server.
 */
export default function SermonStudyScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const bottom = useTabBarSpace();
	const [study, setStudy] = useState<SermonStudyDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!id) return;
		setError(null);
		try {
			setStudy(await fetchSermonStudy(getToken, id));
		} catch {
			setError("Could not load this study.");
		}
	}, [getToken, id]);

	useFocusEffect(
		useCallback(() => {
			void load();
		}, [load])
	);

	const credits = study
		? [study.serviceTitle, study.preacher, study.serviceDate].filter(Boolean).join(" · ")
		: "";

	const askAI = useCallback(() => {
		if (!study) return;
		router.push({
			pathname: "/",
			params: { prompt: `Let's talk about the sermon study "${study.title}".` },
		});
	}, [router, study]);

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()}>
					<Text style={styles.link}>‹ Sermon studies</Text>
				</Pressable>
			</View>
			<ScrollView
				contentContainerStyle={{
					padding: spacing.lg,
					paddingBottom: bottom + spacing.xxl,
					gap: spacing.md,
				}}
			>
				{error ? (
					<View style={styles.card}>
						<Text accessibilityRole="alert" style={styles.body}>
							{error}
						</Text>
						<Pressable accessibilityRole="button" onPress={() => void load()}>
							<Text style={styles.link}>Try again</Text>
						</Pressable>
					</View>
				) : !study ? (
					<ActivityIndicator color={colors.accent} />
				) : (
					<>
						{study.imageUrl ? (
							<Image
								source={{ uri: study.imageUrl }}
								style={styles.hero}
								accessibilityIgnoresInvertColors
							/>
						) : null}
						<Text style={styles.screenTitle}>{study.title}</Text>
						<Text style={styles.bigIdea}>{study.bigIdea}</Text>
						{credits ? <Text style={styles.session}>{credits}</Text> : null}
						<Pressable
							accessibilityRole="link"
							onPress={() =>
								void Linking.openURL(watchUrl(study.videoId, study.sermonStartMs))
							}
						>
							<Text style={styles.link}>Watch the service →</Text>
						</Pressable>
						<Text style={styles.body}>{study.summary}</Text>

						{study.sections.map((section, index) => (
							<View key={`${section.heading}-${index}`} style={styles.section}>
								<Text style={styles.sectionTitle}>
									{index + 1}. {section.heading}
								</Text>
								<Pressable
									accessibilityRole="link"
									onPress={() =>
										void Linking.openURL(watchUrl(study.videoId, section.startMs))
									}
								>
									<Text style={styles.link}>
										Watch from {formatTimestamp(section.startMs)} →
									</Text>
								</Pressable>

								{section.imageUrl && index > 0 ? (
									<Image
										source={{ uri: section.imageUrl }}
										style={styles.hero}
										accessibilityIgnoresInvertColors
									/>
								) : null}

								{section.pastorQuote ? (
									<View style={styles.quote}>
										<Text style={styles.quoteText}>{section.pastorQuote}</Text>
										<Text style={styles.label}>WHAT WAS PREACHED</Text>
									</View>
								) : null}

								{section.passage && section.passageText ? (
									<View style={styles.card}>
										<Text style={styles.reference}>{section.passage}</Text>
										{section.passageText.map((verse) => (
											<Text key={verse.verse} style={styles.verse}>
												<Text style={styles.verseNumber}>{verse.verse} </Text>
												{verse.text}
											</Text>
										))}
									</View>
								) : null}

								<Text style={styles.label}>SUREWORD&rsquo;S TEACHING</Text>
								<Text style={styles.body}>{section.explanation}</Text>

								<View style={styles.card}>
									<Text style={styles.body}>
										<Text style={styles.title}>Consider: </Text>
										{section.reflection}
									</Text>
								</View>
							</View>
						))}

						<View style={styles.section}>
							<Text style={styles.reference}>THIS WEEK</Text>
							<Text style={styles.body}>{study.application}</Text>
						</View>
						<View style={styles.section}>
							<Text style={styles.reference}>PRAYER</Text>
							<Text style={styles.body}>{study.prayer}</Text>
						</View>
					</>
				)}
			</ScrollView>
			{study ? (
				<View style={[styles.dock, { marginBottom: bottom }]}>
					<Pressable
						accessibilityRole="link"
						accessibilityLabel="Watch the service"
						onPress={() => void Linking.openURL(watchUrl(study.videoId, study.sermonStartMs))}
						style={styles.dockWatch}
					>
						<Ionicons name="play-circle-outline" size={20} color={colors.text} />
						<Text numberOfLines={1} style={styles.dockWatchLabel}>
							Watch the service
						</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Ask AI about ${study.title}`}
						onPress={askAI}
						style={styles.dockAI}
					>
						<Ionicons name="sparkles-outline" size={21} color={colors.text} />
						<Text style={styles.dockAILabel}>Ask AI</Text>
					</Pressable>
				</View>
			) : null}
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
		screenTitle: { color: c.text, ...typography.screenTitle, fontWeight: "600" },
		sectionTitle: { color: c.text, ...typography.sectionTitle, fontWeight: "600" },
		title: { color: c.text, ...typography.support, fontWeight: "600" },
		bigIdea: { color: c.textSecondary, ...typography.body, fontStyle: "italic" },
		link: { color: c.accent, ...typography.support, paddingVertical: spacing.xs },
		body: { color: c.textSecondary, ...typography.body },
		session: { color: c.textMuted, ...typography.meta },
		label: { color: c.textMuted, ...typography.micro, fontWeight: "700", letterSpacing: 1 },
		reference: { color: c.accent, ...typography.meta, fontWeight: "700", letterSpacing: 1 },
		section: { gap: spacing.sm, marginTop: spacing.lg },
		hero: { width: "100%", aspectRatio: 3 / 2, borderRadius: radius.lg },
		quote: {
			borderLeftWidth: 2,
			borderLeftColor: c.accent,
			paddingLeft: spacing.md,
			gap: spacing.xs,
		},
		quoteText: { color: c.text, ...typography.body },
		verse: { color: c.textSecondary, ...typography.body },
		verseNumber: { color: c.accent, ...typography.micro, fontWeight: "700" },
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.xs,
		},
		// Deliberately the Bible reader's dock metrics (bible/chapter.tsx): the
		// two screens sit next to each other on the Bible tab and a study should
		// feel like one more thing you read, not a different app.
		dock: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingHorizontal: 20,
			paddingVertical: 12,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.borderStrong,
		},
		dockWatch: {
			flex: 1,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			minHeight: 52,
			borderRadius: radius.full,
			backgroundColor: c.surfacePressed,
			paddingHorizontal: spacing.md,
		},
		dockWatchLabel: { flexShrink: 1, color: c.text, ...typography.control, fontWeight: "700" },
		dockAI: {
			minWidth: 52,
			minHeight: 52,
			alignItems: "center",
			justifyContent: "center",
			gap: 2,
		},
		dockAILabel: { color: c.textMuted, ...typography.micro },
	});

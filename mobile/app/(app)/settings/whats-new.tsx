import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AccentButton, GhostButton, GlassCard } from "@/components/ui";
import { apiJson } from "@/lib/api";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { OptionChip, SettingsSubScreen, useSettingsStyles } from "@/features/settings/SettingsChrome";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	KIND_LABELS,
	WHATS_NEW_ROUTES,
	filterEntries,
	formatReleaseDate,
	groupByMonth,
	primaryKind,
	type WhatsNewDocument,
	type WhatsNewEntry,
	type WhatsNewKind,
} from "@/features/whatsNew/whatsNew";

const contentStyle = { paddingTop: spacing.lg };

/** Browsing pages through the list; searching or filtering shows every match. */
const PAGE_SIZE = 12;
const KINDS: WhatsNewKind[] = ["new", "improved", "fixed"];

/**
 * Settings -> What's new: every release, newest first, from the same public
 * `GET /api/whats-new` the web journal at sureword.app/whats-new reads. The
 * catch-up sheet's "Read more" opens it on one release (`?version=`).
 */
export default function WhatsNewScreen() {
	const getToken = useStableGetToken();
	const router = useRouter();
	const params = useLocalSearchParams<{ version?: string }>();
	const { colors } = useTheme();
	const settingsStyles = useSettingsStyles();
	const styles = useThemedStyles(createStyles);
	const [document, setDocument] = useState<WhatsNewDocument | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<WhatsNewKind | null>(null);
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [focus, setFocus] = useState<string | null>(typeof params.version === "string" ? params.version : null);

	const load = useCallback(() => {
		setFailed(false);
		apiJson<WhatsNewDocument>(getToken, "/api/whats-new")
			.then(setDocument)
			.catch(() => setFailed(true));
	}, [getToken]);

	useEffect(load, [load]);
	useEffect(() => {
		if (typeof params.version === "string") setFocus(params.version);
	}, [params.version]);

	const matching = useMemo(() => {
		if (!document) return [];
		if (focus) return document.entries.filter((entry) => entry.version === focus);
		return filterEntries(document.entries, query, kind);
	}, [document, focus, query, kind]);
	const browsing = !focus && !query.trim() && kind === null;
	const shown = browsing ? matching.slice(0, limit) : matching;
	const remaining = matching.length - shown.length;

	if (!document) {
		return (
			<SettingsSubScreen title="What's new" contentStyle={contentStyle}>
				<GlassCard style={settingsStyles.card}>
					{failed ? (
						<>
							<Text style={settingsStyles.hint}>Couldn't load the release notes. Check your connection and try again.</Text>
							<GhostButton label="Try again" onPress={load} />
						</>
					) : (
						<ActivityIndicator color={colors.accent} accessibilityLabel="Loading release notes" />
					)}
				</GlassCard>
			</SettingsSubScreen>
		);
	}

	return (
		<SettingsSubScreen title="What's new" contentStyle={contentStyle}>
			<Text style={styles.intro}>Every update, newest first. Version numbers are this app's.</Text>
			{focus ? (
				<GhostButton label="Show every release" onPress={() => setFocus(null)} style={styles.control} />
			) : (
				<>
					<TextInput
						value={query}
						onChangeText={setQuery}
						placeholder="Search release notes"
						placeholderTextColor={colors.textFaint}
						accessibilityLabel="Search release notes"
						returnKeyType="search"
						style={styles.search}
					/>
					<View style={styles.chips}>
						<OptionChip label="All" selected={kind === null} onPress={() => setKind(null)} />
						{KINDS.map((option) => (
							<OptionChip
								key={option}
								label={KIND_LABELS[option]}
								selected={kind === option}
								onPress={() => setKind(kind === option ? null : option)}
							/>
						))}
					</View>
					<Text style={styles.count}>
						{browsing
							? `${document.entries.length} releases`
							: `${matching.length} ${matching.length === 1 ? "release" : "releases"} found`}
					</Text>
				</>
			)}

			{shown.length === 0 ? (
				<Text style={settingsStyles.hint}>No release notes match. Try another word or change type.</Text>
			) : null}

			{groupByMonth(shown).map((group) => (
				<View key={group.month} style={styles.group}>
					<Text style={styles.month}>{group.month.toUpperCase()}</Text>
					{group.entries.map((entry) => {
						const target = entry.target;
						return (
							<ReleaseCard
								key={entry.version}
								entry={entry}
								onTry={target ? () => router.navigate(WHATS_NEW_ROUTES[target]) : undefined}
							/>
						);
					})}
				</View>
			))}

			{browsing && remaining > 0 ? (
				<GhostButton
					label={`Show older releases (${remaining} more)`}
					onPress={() => setLimit((current) => current + PAGE_SIZE * 2)}
					style={styles.control}
				/>
			) : null}

			{browsing && remaining === 0 ? (
				<View style={styles.group}>
					<Text style={styles.month}>{document.beginning.dateRange.toUpperCase()}</Text>
					<GlassCard style={styles.card}>
						<Text style={styles.title}>{document.beginning.title}</Text>
						<Text style={styles.headline}>{document.beginning.summary}</Text>
						{document.beginning.items.map((item) => (
							<Text key={item} style={styles.item}>{`•  ${item}`}</Text>
						))}
					</GlassCard>
				</View>
			) : null}
		</SettingsSubScreen>
	);
}

function ReleaseCard({ entry, onTry }: { entry: WhatsNewEntry; onTry?: () => void }) {
	const styles = useThemedStyles(createStyles);
	return (
		<GlassCard style={styles.card}>
			<View style={styles.metaRow}>
				<Text style={styles.kind}>{KIND_LABELS[primaryKind(entry)].toUpperCase()}</Text>
				<Text style={styles.meta}>{`${entry.version} · ${formatReleaseDate(entry.date)}`}</Text>
			</View>
			<Text accessibilityRole="header" style={styles.title}>
				{entry.title}
			</Text>
			{entry.headline ? <Text style={styles.headline}>{entry.headline}</Text> : null}
			{entry.why ? <Text style={styles.why}>{entry.why}</Text> : null}
			{entry.sections.map((section) => (
				<View key={section.kind} style={styles.section}>
					<Text style={styles.sectionLabel}>{KIND_LABELS[section.kind]}</Text>
					{section.items.map((item) => (
						<Text key={item} style={styles.item}>{`•  ${item}`}</Text>
					))}
				</View>
			))}
			{entry.verse ? (
				<View style={styles.verse}>
					<Text style={styles.verseText}>{`“${entry.verse.text}”`}</Text>
					<Text style={styles.verseRef}>{entry.verse.reference}</Text>
				</View>
			) : null}
			{onTry ? <AccentButton label="Try it" accessibilityLabel={`Try ${entry.title}`} onPress={onTry} /> : null}
		</GlassCard>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		intro: { color: c.textMuted, ...typography.support, marginBottom: spacing.md },
		control: { marginTop: spacing.sm },
		search: {
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			color: c.text,
			paddingHorizontal: spacing.md,
			fontFamily: fonts.body,
			...typography.control,
		},
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
		count: { color: c.textFaint, ...typography.meta, marginTop: spacing.md },
		group: { marginTop: spacing.xl, gap: spacing.md },
		month: { color: c.accentDim, fontFamily: fonts.bodyBold, letterSpacing: 2, ...typography.micro },
		card: { padding: spacing.lg, gap: spacing.sm },
		metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
		kind: {
			overflow: "hidden",
			color: c.accent,
			backgroundColor: c.accentSoft,
			borderRadius: radius.full,
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
			fontFamily: fonts.bodyBold,
			letterSpacing: 1,
			...typography.micro,
		},
		meta: { color: c.textFaint, ...typography.meta },
		title: { color: c.text, fontFamily: fonts.verse, fontSize: 24, lineHeight: 30 },
		headline: { color: c.textSecondary, ...typography.body },
		why: { color: c.textMuted, ...typography.support },
		section: { gap: spacing.xs, marginTop: spacing.xs },
		sectionLabel: { color: c.accent, fontFamily: fonts.bodyBold, ...typography.meta },
		item: { color: c.textSecondary, ...typography.support },
		verse: {
			marginTop: spacing.sm,
			paddingLeft: spacing.md,
			borderLeftWidth: 2,
			borderLeftColor: c.accentBorder,
			gap: spacing.xs,
		},
		verseText: { color: c.text, fontFamily: fonts.verseItalic, fontSize: 18, lineHeight: 26 },
		verseRef: { color: c.accentDim, ...typography.meta },
	});

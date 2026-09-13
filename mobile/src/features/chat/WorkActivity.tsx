import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { formatWorkDuration, type ChatProgress, type ProgressEntry } from "@/lib/chatProgress";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

function ActivityEntry({ entry, current }: { entry: ProgressEntry; current: boolean }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [expanded, setExpanded] = useState(false);
	const hasDetails = Boolean(entry.detail || entry.sources?.length);
	return <View style={[styles.entry, entry.kind === "summary" && styles.summaryEntry]}>
		<Pressable disabled={!hasDetails} onPress={() => setExpanded(v => !v)} accessibilityRole="button"
			accessibilityLabel={entry.label} accessibilityState={{ expanded }} style={styles.entryHeading}>
			<Ionicons name={entry.state === "error" ? "alert-circle-outline" : entry.kind === "summary" ? "sparkles-outline" : entry.kind === "status" ? "ellipse-outline" : entry.state === "running" ? "ellipsis-horizontal" : entry.state === "interrupted" ? "remove-outline" : "checkmark"} size={16} color={colors.textMuted} />
			<Text style={styles.entryLabel}>{entry.label}</Text>
			{hasDetails && <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color={colors.textMuted} />}
		</Pressable>
		{entry.detail && (expanded || current) && <Text style={styles.detail} numberOfLines={expanded ? undefined : 3}>{entry.detail.replace(/\*\*/g, "")}</Text>}
		{expanded && entry.sources?.map(source => <Pressable key={source.url} accessibilityRole="link"
			onPress={() => { void Linking.openURL(source.url).catch(() => {}); }} style={styles.source}>
			<Text style={styles.sourceText}>{source.title}</Text>
		</Pressable>)}
	</View>;
}

export function WorkActivity({ progress, isStreaming }: { progress: ChatProgress; isStreaming: boolean }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [expanded, setExpanded] = useState(false);
	const [extraMs, setExtraMs] = useState(0);
	const live = isStreaming && progress.state === "running";
	useEffect(() => {
		setExtraMs(0);
		if (!live) return;
		const receivedAt = Date.now();
		const timer = setInterval(() => setExtraMs(Date.now() - receivedAt), 1000);
		return () => clearInterval(timer);
	}, [live, progress.sequence, progress.runId]);
	const elapsed = progress.elapsedMs + (live ? extraMs : 0);
	const duration = formatWorkDuration(elapsed);
	const title = live ? `Working for ${duration}` : progress.state === "error" ? `Interrupted after ${duration}` : progress.state === "running" ? `Updates stopped after ${duration}` : `Worked for ${duration}`;
	const quiet = live && progress.phase !== "answering" && elapsed - progress.lastActivityMs >= 20_000;
	const latest = progress.entries.at(-1);
	return <View style={styles.wrap}>
		<Pressable onPress={() => setExpanded(v => !v)} accessibilityRole="button" accessibilityLabel={title}
			accessibilityState={{ expanded }} style={styles.heading}>
			{live && <ActivityIndicator size="small" color={colors.accentDim} />}
			<Text style={styles.title}>{title}</Text>
			<Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
		</Pressable>
		{live && progress.phase !== "answering" && <View accessibilityLiveRegion="polite" style={styles.activityCard}>
			<View style={styles.cardHeading}>
				<Ionicons name="sparkles-outline" size={14} color={colors.accentDim} />
				<Text style={styles.cardTitle}>Activity</Text>
			</View>
			<Text style={styles.current}>{progress.label}</Text>
			{quiet && <Text style={styles.preview}>Still waiting for the response. No new update yet.</Text>}
		</View>}
		{expanded && <View style={styles.history}>
			{progress.entries.length === 0 && <Text style={styles.preview}>No additional activity to show yet.</Text>}
			{progress.entries.map(entry => <ActivityEntry key={entry.id} entry={entry} current={live && latest?.id === entry.id} />)}
		</View>}
	</View>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	wrap: { marginBottom: 12, gap: 6 },
	heading: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, alignSelf: "flex-start" },
	title: { color: c.textMuted, fontSize: 14, flexShrink: 1 },
	current: { color: c.text, fontSize: 15, lineHeight: 22 },
	activityCard: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.accentBorder, borderRadius: 16, padding: 16, gap: 9 },
	cardHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
	cardTitle: { flex: 1, color: c.accentDim, fontSize: 13, lineHeight: 20 },
	preview: { color: c.textMuted, fontSize: 14, lineHeight: 21, marginTop: 4 },
	history: { borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 12, gap: 10, marginTop: 6 },
	entry: { gap: 3 },
	summaryEntry: { backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
	entryHeading: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44 },
	entryLabel: { flex: 1, color: c.textMuted, fontSize: 14, lineHeight: 20 },
	detail: { color: c.textMuted, fontSize: 13, lineHeight: 20, paddingLeft: 23 },
	source: { minHeight: 44, justifyContent: "center", paddingLeft: 23 },
	sourceText: { color: c.accent, fontSize: 13, lineHeight: 20 },
});

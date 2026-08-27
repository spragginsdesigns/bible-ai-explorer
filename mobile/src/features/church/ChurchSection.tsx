import React, { useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Image,
	Linking,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
	type NativeSyntheticEvent,
	type TextLayoutEventData,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassCard } from "@/components/ui";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	hostnameOf,
	MISSION_CLAMP_LINES,
	needsMissionToggle,
	type ChurchProfile,
} from "./church";
import { useChurchSection } from "./churchStore";
import type { GetToken } from "@/lib/api";

const DESCRIPTION =
	"Pick your home church so SureWord knows the congregation you belong to. " +
	"Its mission statement is read from the church's public website.";

/**
 * Settings -> MY CHURCH (parity with the web settings page): search Google
 * Places for a church, save it, and see its logo, address, contact details and
 * mission statement.
 *
 * The section renders its own heading rather than taking one from the settings
 * screen, because an unconfigured server (`status: "unavailable"`) must leave
 * no trace at all - a bare "MY CHURCH" label above nothing would be worse than
 * the feature being absent.
 */
export function ChurchSection({ getToken }: { getToken: GetToken }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const church = useChurchSection(getToken);

	if (church.load === "unavailable") return null;

	return (
		<>
			<Text style={styles.sectionLabel}>MY CHURCH</Text>
			{church.load === "loading" ? (
				<GlassCard style={[styles.card, styles.loadingCard]}>
					<ActivityIndicator color={colors.accent} />
				</GlassCard>
			) : church.load === "failed" ? (
				<GlassCard style={styles.card}>
					<View style={styles.retryRow}>
						<Text style={styles.hint}>Couldn&apos;t load your church.</Text>
						<Pressable accessibilityRole="button" onPress={church.reload} hitSlop={8}>
							<Text style={styles.retry}>Retry</Text>
						</Pressable>
					</View>
				</GlassCard>
			) : church.picking ? (
				<ChurchPicker section={church} />
			) : church.church ? (
				<SavedChurchCard profile={church.church} section={church} />
			) : null}
		</>
	);
}

type Section = ReturnType<typeof useChurchSection>;

/** Search box plus results, shown until a church is saved. */
function ChurchPicker({ section }: { section: Section }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const saving = section.savingPlaceId !== null;

	return (
		<GlassCard style={styles.card}>
			<Text style={styles.hint}>{DESCRIPTION}</Text>

			<View style={styles.searchWrap}>
				<Ionicons name="search" size={15} color={colors.textFaint} />
				<TextInput
					value={section.query}
					onChangeText={section.setQuery}
					placeholder="Search by name or city"
					placeholderTextColor={colors.textGhost}
					accessibilityLabel="Search for your church"
					autoCapitalize="words"
					autoCorrect={false}
					editable={!saving}
					returnKeyType="search"
					style={styles.searchInput}
				/>
				{section.searchPending ? (
					<ActivityIndicator size="small" color={colors.textFaint} />
				) : section.query.length > 0 ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Clear search"
						onPress={section.clearQuery}
						hitSlop={8}
					>
						<Ionicons name="close-circle" size={17} color={colors.textFaint} />
					</Pressable>
				) : null}
			</View>

			{saving ? (
				<View style={styles.savingRow}>
					<ActivityIndicator size="small" color={colors.accent} />
					<Text style={styles.savingLabel}>
						Looking up your church and reading its website&hellip;
					</Text>
				</View>
			) : null}

			{/* Save and remove failures raise an Alert (the app's convention for
			    one-shot actions); only the per-keystroke search reports inline. */}
			{section.searchError ? <Text style={styles.error}>{section.searchError}</Text> : null}

			{section.results.map((result) => (
				<Pressable
					key={result.placeId}
					accessibilityRole="button"
					accessibilityLabel={`Choose ${result.name}`}
					disabled={saving}
					onPress={() => section.pick(result.placeId)}
					style={({ pressed }) => [
						styles.resultRow,
						pressed && { backgroundColor: colors.surfacePressed },
						saving && section.savingPlaceId !== result.placeId && { opacity: 0.4 },
					]}
				>
					<View style={styles.resultIcon}>
						<Ionicons name="business-outline" size={16} color={colors.accent} />
					</View>
					<View style={styles.resultCopy}>
						<Text style={styles.resultName} numberOfLines={2}>
							{result.name}
						</Text>
						<Text style={styles.resultAddress} numberOfLines={2}>
							{result.address}
						</Text>
					</View>
					{section.savingPlaceId === result.placeId ? (
						<ActivityIndicator size="small" color={colors.accent} />
					) : (
						<Text style={styles.chevron}>›</Text>
					)}
				</Pressable>
			))}

			{!saving &&
			!section.searchPending &&
			!section.searchError &&
			section.results.length === 0 &&
			section.query.trim().length > 0 ? (
				<Text style={styles.hint}>No churches found. Try the city as well as the name.</Text>
			) : null}

			{section.church ? (
				<Pressable
					accessibilityRole="button"
					disabled={saving}
					onPress={section.cancelChange}
					hitSlop={8}
				>
					<Text style={styles.cancelLabel}>Cancel</Text>
				</Pressable>
			) : null}
		</GlassCard>
	);
}

/** The saved church: logo, name, address, links and mission statement. */
function SavedChurchCard({ profile, section }: { profile: ChurchProfile; section: Section }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [photoFailed, setPhotoFailed] = useState(false);
	const [missionExpanded, setMissionExpanded] = useState(false);
	const [missionClamped, setMissionClamped] = useState(false);
	const missionHost = hostnameOf(profile.missionSource);

	const onMissionLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
		if (missionExpanded) return;
		setMissionClamped(needsMissionToggle(event.nativeEvent.lines.length));
	};

	const confirmRemove = () => {
		Alert.alert("Remove your church?", `SureWord will forget ${profile.name}.`, [
			{ text: "Cancel", style: "cancel" },
			{ text: "Remove", style: "destructive", onPress: section.remove },
		]);
	};

	return (
		<GlassCard style={styles.card}>
			<View style={styles.headerRow}>
				{profile.photoUrl && !photoFailed ? (
					<Image
						source={{ uri: profile.photoUrl }}
						onError={() => setPhotoFailed(true)}
						resizeMode="cover"
						accessibilityIgnoresInvertColors
						style={styles.photo}
					/>
				) : (
					<View style={[styles.photo, styles.photoFallback]}>
						<Ionicons name="business-outline" size={26} color={colors.accent} />
					</View>
				)}
				<View style={styles.headerCopy}>
					<Text style={styles.churchName}>{profile.name}</Text>
					<Text style={styles.churchAddress}>{profile.address}</Text>
				</View>
			</View>

			{profile.phone ? (
				<LinkRow
					icon="call-outline"
					label={profile.phone}
					accessibilityLabel={`Call ${profile.name}`}
					url={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}
				/>
			) : null}
			{profile.website ? (
				<LinkRow
					icon="globe-outline"
					label={hostnameOf(profile.website) ?? profile.website}
					accessibilityLabel={`Open ${profile.name}'s website`}
					url={profile.website}
					external
				/>
			) : null}
			{profile.mapsUrl ? (
				<LinkRow
					icon="map-outline"
					label="Open in Google Maps"
					accessibilityLabel="Open in Google Maps"
					url={profile.mapsUrl}
					external
				/>
			) : null}

			{profile.mission ? (
				<View style={styles.missionBox}>
					<Text style={styles.blockLabel}>MISSION</Text>
					<Text
						style={styles.body}
						numberOfLines={missionExpanded ? undefined : MISSION_CLAMP_LINES}
						onTextLayout={onMissionLayout}
					>
						{profile.mission}
					</Text>
					{missionClamped ? (
						<Pressable
							accessibilityRole="button"
							onPress={() => setMissionExpanded((value) => !value)}
							hitSlop={8}
						>
							<Text style={styles.showMore}>
								{missionExpanded ? "Show less" : "Show more"}
							</Text>
						</Pressable>
					) : null}
					{missionHost ? (
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={`Open the source of this mission statement on ${missionHost}`}
							disabled={!profile.missionSource}
							onPress={() => {
								if (profile.missionSource) void Linking.openURL(profile.missionSource);
							}}
							hitSlop={8}
						>
							<Text style={styles.sourceLabel}>From {missionHost}</Text>
						</Pressable>
					) : null}
				</View>
			) : null}

			{profile.about ? (
				<View style={styles.missionBox}>
					<Text style={styles.blockLabel}>ABOUT</Text>
					<Text style={styles.body}>{profile.about}</Text>
				</View>
			) : null}

			<View style={styles.actionsRow}>
				<Pressable
					accessibilityRole="button"
					disabled={section.removing}
					onPress={section.startChange}
					style={({ pressed }) => [
						styles.actionButton,
						pressed && { backgroundColor: colors.surfacePressed },
						section.removing && { opacity: 0.4 },
					]}
				>
					<Text style={styles.actionLabel}>Change church</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={section.removing}
					onPress={confirmRemove}
					style={({ pressed }) => [
						styles.removeButton,
						pressed && { backgroundColor: colors.dangerSoft },
						section.removing && { opacity: 0.4 },
					]}
				>
					{section.removing ? (
						<ActivityIndicator size="small" color={colors.danger} />
					) : (
						<Text style={styles.removeLabel}>Remove</Text>
					)}
				</Pressable>
			</View>
		</GlassCard>
	);
}

function LinkRow({
	icon,
	label,
	accessibilityLabel,
	url,
	external = false,
}: {
	icon: React.ComponentProps<typeof Ionicons>["name"];
	label: string;
	accessibilityLabel: string;
	url: string;
	external?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="link"
			accessibilityLabel={accessibilityLabel}
			onPress={() => void Linking.openURL(url)}
			style={({ pressed }) => [
				styles.linkRow,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			<Ionicons name={icon} size={16} color={colors.textFaint} />
			<Text style={styles.linkLabel} numberOfLines={1}>
				{label}
			</Text>
			{external ? <Ionicons name="open-outline" size={13} color={colors.textFaint} /> : null}
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		sectionLabel: {
			color: c.textFaint,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
			marginLeft: spacing.xs,
		},
		card: { padding: spacing.lg, gap: spacing.md },
		loadingCard: { minHeight: 80, alignItems: "center", justifyContent: "center" },
		hint: { color: c.textFaint, fontSize: 12, lineHeight: 17 },
		retryRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
		},
		retry: { color: c.accent, fontSize: 13, fontWeight: "700" },
		searchWrap: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 44,
			backgroundColor: c.bgElevated,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
		},
		searchInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 14, paddingVertical: spacing.sm },
		savingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		savingLabel: { flex: 1, minWidth: 0, color: c.accent, fontSize: 12, lineHeight: 17 },
		resultRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			padding: spacing.md,
		},
		resultIcon: {
			width: 32,
			height: 32,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		resultCopy: { flex: 1, minWidth: 0, gap: 2 },
		resultName: { color: c.text, fontSize: 14.5, fontWeight: "600" },
		resultAddress: { color: c.textFaint, fontSize: 12, lineHeight: 16 },
		chevron: { color: c.textFaint, fontSize: 22, marginTop: -2 },
		headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		photo: {
			width: 64,
			height: 64,
			borderRadius: radius.md,
			backgroundColor: c.surface,
		},
		photoFallback: {
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		headerCopy: { flex: 1, minWidth: 0, gap: 2 },
		churchName: { color: c.text, fontSize: 16, fontWeight: "700" },
		churchAddress: { color: c.textFaint, fontSize: 12.5, lineHeight: 17 },
		linkRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 40,
			marginHorizontal: -spacing.sm,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		linkLabel: { flex: 1, minWidth: 0, color: c.textSecondary, fontSize: 13.5 },
		missionBox: { gap: spacing.xs },
		blockLabel: { color: c.textGhost, fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
		body: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },
		showMore: { color: c.accent, fontSize: 12, fontWeight: "700" },
		sourceLabel: { color: c.textFaint, fontSize: 11.5, textDecorationLine: "underline" },
		actionsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		actionButton: {
			flex: 1,
			minHeight: 40,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		actionLabel: { color: c.textSecondary, fontSize: 12.5, fontWeight: "700" },
		removeButton: {
			minHeight: 40,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.dangerBorder,
		},
		removeLabel: { color: c.danger, fontSize: 12.5, fontWeight: "700" },
		cancelLabel: { color: c.textMuted, fontSize: 12, fontWeight: "700", textAlign: "center" },
		error: { color: c.danger, fontSize: 12, lineHeight: 17 },
	});

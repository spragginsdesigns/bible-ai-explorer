import React, { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { GetToken } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";
import { shareEventFile } from "./calendarFile";
import { GoogleCalendarLogo } from "./CalendarLogos";
import type { ChurchApp, ChurchEvent } from "./sermonApi";

/**
 * Gatherings announced from the pulpit, each with Add to Google Calendar and
 * Other calendar (the .ics, for Samsung Calendar, Outlook and the rest).
 * Renders nothing when there are none.
 *
 * A time the recording left unclear is never shown as certain: it says so and
 * sends the reader to the church's own app on Google Play, which has the real
 * time. Web mirror: `src/components/sermons/ChurchEventsCard.tsx`.
 */
export function ChurchEventsCard({
	events,
	churchApp,
	title,
	eyebrow,
	getToken,
}: {
	events: ChurchEvent[];
	churchApp: ChurchApp | null;
	title: string;
	eyebrow: string;
	getToken: GetToken;
}) {
	const styles = useThemedStyles(createStyles);
	if (events.length === 0) return null;
	return (
		<View style={styles.card} accessibilityLabel={title}>
			<Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
			<Text style={styles.heading}>{title}</Text>
			{events.map((event, index) => (
				<View key={event.id} style={[styles.row, index > 0 && styles.divider]}>
					<EventRow event={event} churchApp={churchApp} getToken={getToken} />
				</View>
			))}
		</View>
	);
}

function EventRow({
	event,
	churchApp,
	getToken,
}: {
	event: ChurchEvent;
	churchApp: ChurchApp | null;
	getToken: GetToken;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [sharing, setSharing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const meta = [event.location, event.audience ? `For ${event.audience}` : null].filter(Boolean);

	const addElsewhere = useCallback(async () => {
		setError(null);
		setSharing(true);
		try {
			await shareEventFile(getToken, event);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not open the calendar file.");
		} finally {
			setSharing(false);
		}
	}, [event, getToken]);

	return (
		<View style={styles.event}>
			<Text style={styles.title}>{event.title}</Text>
			<Text style={styles.when}>{event.when}</Text>
			{!event.certain ? (
				<View style={styles.pill}>
					<Text style={styles.pillText}>TIME NOT CONFIRMED</Text>
				</View>
			) : null}
			{meta.length > 0 ? <Text style={styles.meta}>{meta.join(" · ")}</Text> : null}
			{event.details ? <Text style={styles.body}>{event.details}</Text> : null}

			<View style={styles.quote}>
				<Text style={styles.quoteText}>&ldquo;{event.sourceQuote}&rdquo;</Text>
				<Pressable
					accessibilityRole="link"
					accessibilityLabel={`Hear the announcement for ${event.title}`}
					onPress={() => void Linking.openURL(event.sourceUrl)}
				>
					<Text style={styles.link}>Hear the announcement →</Text>
				</Pressable>
			</View>

			{!event.certain ? (
				<View style={styles.notice}>
					<Text style={styles.noticeText}>
						The time was not clear in the recording.{" "}
						{churchApp
							? `Check the ${churchApp.name} app for the exact time.`
							: "Check with the church for the exact time."}
					</Text>
					{churchApp ? (
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={`Open ${churchApp.name} on Google Play`}
							onPress={() => void Linking.openURL(churchApp.androidUrl)}
						>
							<Text style={styles.link}>Open {churchApp.name} on Google Play →</Text>
						</Pressable>
					) : null}
				</View>
			) : null}

			<View style={styles.buttons}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`Add ${event.title} to Google Calendar`}
					onPress={() => void Linking.openURL(event.googleCalendarUrl)}
					style={({ pressed }) => [styles.button, pressed && styles.pressed]}
				>
					<GoogleCalendarLogo size={18} />
					<Text style={styles.buttonText}>Google Calendar</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`Add ${event.title} to another calendar`}
					disabled={sharing}
					onPress={() => void addElsewhere()}
					style={({ pressed }) => [styles.button, (pressed || sharing) && styles.pressed]}
				>
					<Ionicons name="calendar-outline" size={18} color={colors.text} />
					<Text style={styles.buttonText}>Other calendar</Text>
				</Pressable>
			</View>
			{error ? (
				<Text accessibilityRole="alert" style={styles.meta}>
					{error}
				</Text>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.xs,
		},
		eyebrow: { color: c.accent, ...typography.micro, fontWeight: "700", letterSpacing: 1 },
		heading: { color: c.text, ...typography.sectionTitle, fontWeight: "600" },
		row: { paddingTop: spacing.md },
		divider: {
			marginTop: spacing.md,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.borderStrong,
		},
		event: { gap: spacing.xs },
		title: { color: c.text, ...typography.control, fontWeight: "600" },
		when: { color: c.accent, ...typography.support, fontWeight: "600" },
		pill: {
			alignSelf: "flex-start",
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accent,
			borderRadius: radius.full,
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
		},
		pillText: { color: c.accent, ...typography.micro, fontWeight: "700", letterSpacing: 0.5 },
		meta: { color: c.textMuted, ...typography.meta },
		body: { color: c.textSecondary, ...typography.support },
		quote: {
			borderLeftWidth: 2,
			borderLeftColor: c.accent,
			paddingLeft: spacing.md,
			marginTop: spacing.xs,
		},
		quoteText: { color: c.textSecondary, ...typography.support, fontStyle: "italic" },
		link: { color: c.accent, ...typography.support, fontWeight: "600", paddingVertical: spacing.xs },
		notice: {
			marginTop: spacing.xs,
			padding: spacing.md,
			borderRadius: radius.md,
			backgroundColor: c.surfacePressed,
		},
		noticeText: { color: c.text, ...typography.support },
		buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
		button: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 44,
			paddingHorizontal: spacing.md,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surfacePressed,
		},
		pressed: { opacity: 0.6 },
		buttonText: { color: c.text, ...typography.support, fontWeight: "600" },
	});

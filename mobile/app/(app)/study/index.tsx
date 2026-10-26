import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { HubHeader, HubRow } from "@/features/navigation/HubChrome";
import { SpotlightScrollView } from "@/features/onboarding/Spotlight";
import { chatColors } from "@/features/chat/chatAppearance";
import { useTabBarSpace } from "@/features/chat/layout";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { fetchSermonHome } from "@/features/sermons/sermonApi";
import { useTheme } from "@/features/settings/settingsStore";
import { spacing, typography } from "@/theme";

export default function StudyScreen() {
	const router = useRouter();
	const { colors: theme } = useTheme();
	const c = chatColors(theme);
	const bottom = useTabBarSpace();
	const getToken = useStableGetToken();
	const [church, setChurch] = useState({ studies: false, events: false });
	useFocusEffect(useCallback(() => {
		let active = true;
		void fetchSermonHome(getToken).then((home) => {
			if (active) setChurch({ studies: home.studies.length > 0, events: home.events.length > 0 });
		}).catch(() => { if (active) setChurch({ studies: false, events: false }); });
		return () => { active = false; };
	}, [getToken]));
	const atlas = (mode: "timeline" | "people" | "places") => router.push({ pathname: "/study/timeline", params: { mode } });
	return <Screen style={{ backgroundColor: c.bg }}>
		<HubHeader title="Study" help="study" />
		<SpotlightScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
			<View style={styles.intro}><Text accessibilityRole="header" style={[styles.heading, { color: c.text }]}>Go deeper in the Word.</Text>
				<Text style={[styles.body, { color: c.textMuted }]}>Keep what you learn. Explore the people, places, and words of Scripture.</Text></View>
			<HubRow spotlight="study.notes" prominent icon="document-text-outline" title="Notes" subtitle="Your notes, folders, and Scripture connections" onPress={() => router.push("/study/notes", { withAnchor: true })} />
			<Text style={[styles.section, { color: c.textMuted }]}>EXPLORE SCRIPTURE</Text>
			<HubRow icon="time-outline" title="Bible timeline" subtitle="Follow the events of Scripture through time" onPress={() => atlas("timeline")} />
			<HubRow icon="people-outline" title="People of the Bible" subtitle="Lives, families, and where their stories meet" onPress={() => atlas("people")} />
			<HubRow icon="map-outline" title="Places & atlas" subtitle="Explore the lands and journeys of the Bible" onPress={() => atlas("places")} />
			<HubRow icon="language-outline" title="Original languages" subtitle="Hebrew, Greek, and Strong's word studies" onPress={() => router.push("/study/words")} />
			{church.studies || church.events ? <>
				<Text style={[styles.section, { color: c.textMuted }]}>YOUR CHURCH</Text>
				<HubRow spotlight="study.sermons" icon="mic-outline" title="Sermon studies" subtitle="Walk through your church's recorded messages" onPress={() => router.push("/study/sermons")} />
				{church.events ? <HubRow icon="megaphone-outline" title="Church announcements" subtitle="Coming up at your church, with calendar links" onPress={() => router.push("/study/sermons")} /> : null}
			</> : null}
		</SpotlightScrollView>
	</Screen>;
}

const styles = StyleSheet.create({
	content: { paddingHorizontal: spacing.xl, gap: spacing.md },
	intro: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
	heading: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
	body: { ...typography.support },
	section: { ...typography.micro, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.xs },
});

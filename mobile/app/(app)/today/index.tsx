import React, { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { chatColors } from "@/features/chat/chatAppearance";
import { useTabBarSpace } from "@/features/chat/layout";
import { HubHeader, HubRow } from "@/features/navigation/HubChrome";
import { SpotlightAnchor, SpotlightScrollView } from "@/features/onboarding/Spotlight";
import { GettingStartedCard } from "@/features/onboarding/GettingStartedCard";
import { useLastReading } from "@/features/navigation/useLastReading";
import { useDailyPreview } from "@/features/navigation/useDailyPreview";
import { BOOKS } from "@/features/bible/books";
import { useReadingPlan } from "@/features/plan/useReadingPlan";
import { planCardSubtitle } from "@/features/plan/planView";
import { SendWordSheet } from "@/features/shareCards/SendWordSheet";
import { useTheme } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";

export default function TodayScreen() {
	const router = useRouter();
	const { colors: theme } = useTheme();
	const colors = chatColors(theme);
	const styles = createStyles(colors);
	const bottom = useTabBarSpace();
	const lastRead = useLastReading();
	const { plan, loading, error } = useReadingPlan();
	const [sendOpen, setSendOpen] = useState(false);
	const entry = useDailyPreview();
	const openReader = () => {
		const book = BOOKS.find((item) => item.name === lastRead?.book);
		if (!book || !lastRead) { router.navigate("/bible"); return; }
		router.push({ pathname: "/bible/chapter", params: { book: String(book.order), chapter: String(lastRead.chapter), translation: lastRead.translation } }, { withAnchor: true });
	};
	return <Screen style={{ backgroundColor: colors.bg }}>
		<HubHeader title="SureWord" brand help="today" />
		<SpotlightScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
			<GettingStartedCard />
			<View style={styles.intro}><Text style={styles.eyebrow}>YOUR DAILY WALK</Text><Text accessibilityRole="header" style={styles.heading}>Begin with the Word.</Text></View>
			<View style={styles.hero}>
				<Image source={require("../../../assets/daily-walk-dawn.jpg")} style={styles.art} resizeMode="cover" accessible={false} />
				<View style={styles.heroCopy}>
					<Text accessibilityRole="header" style={styles.heroTitle}>Pick Up Your Cross</Text>
					<Text numberOfLines={3} style={styles.verse}>{entry?.text ?? "Thy word is a lamp unto my feet, and a light unto my path."}</Text>
					<Text style={styles.reference}>{entry ? `${entry.reference} · KJV` : "PSALM 119:105 · KJV"}</Text>
					<SpotlightAnchor target="today.cross">
					<Pressable accessibilityRole="button" onPress={() => router.push("/today/cross", { withAnchor: true })}
						style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}>
						<Text style={styles.primaryText}>Read today&apos;s word</Text><Ionicons name="arrow-forward" size={21} color={colors.bg} />
					</Pressable>
					</SpotlightAnchor>
				</View>
			</View>
			<HubRow icon="book-outline" title={lastRead ? "Continue reading" : "Open your Bible"}
				subtitle={lastRead ? `${lastRead.book} ${lastRead.chapter} · ${lastRead.translation}` : "Choose a book and begin wherever you are"} onPress={openReader} />
			<HubRow spotlight="today.learn" icon="albums-outline" title="Learn a verse" subtitle="Keep Scripture close, at your own pace" onPress={() => router.push("/today/learn")} />
			<HubRow spotlight="today.plan" icon="calendar-outline" title={plan?.title ?? "Reading plan"}
				subtitle={loading ? "Loading your plan..." : error ? "Open your plan to reconnect" : planCardSubtitle(plan)} onPress={() => router.push("/today/plan")} />
			<View style={styles.section}><Text style={styles.sectionTitle}>Along the way</Text></View>
			<HubRow icon="footsteps-outline" title="Your walk" subtitle="Your reading history and time in the Word" onPress={() => router.push("/today/history")} />
			<HubRow icon="mail-outline" title="Send a word" subtitle="Share a verse for what someone is facing" onPress={() => setSendOpen(true)} />
			<Pressable accessibilityRole="button" onPress={() => router.navigate("/study/notes")} style={styles.notesLink}><Ionicons name="document-text-outline" size={17} color={colors.accent} /><Text style={styles.link}>Your notes in Study</Text><Ionicons name="arrow-forward" size={16} color={colors.accent} /></Pressable>
		</SpotlightScrollView>
		<SendWordSheet visible={sendOpen} onClose={() => setSendOpen(false)} />
	</Screen>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	content: { paddingHorizontal: spacing.xl, gap: spacing.md },
	intro: { gap: 5, paddingTop: spacing.sm, paddingBottom: spacing.xs },
	eyebrow: { ...typography.micro, letterSpacing: 3, color: c.textMuted, fontWeight: "700" },
	heading: { fontSize: 29, lineHeight: 37, fontWeight: "700", color: c.text },
	hero: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: c.bgElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentBorder },
	art: { width: "100%", height: 150 },
	heroCopy: { padding: spacing.lg, gap: spacing.sm },
	heroTitle: { color: c.accent, fontFamily: fonts.verse, fontSize: 31, lineHeight: 36 },
	verse: { color: c.text, fontFamily: fonts.verse, fontSize: 23, lineHeight: 29 },
	reference: { ...typography.micro, color: c.textMuted, letterSpacing: 1, paddingBottom: spacing.sm },
	primary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, backgroundColor: c.accent, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 52 },
	primaryText: { color: c.bg, ...typography.control, fontWeight: "700", flexShrink: 1 },
	section: { marginTop: spacing.md, marginBottom: spacing.xs },
	sectionTitle: { ...typography.sectionTitle, color: c.text, fontWeight: "700" },
	notesLink: { minHeight: 48, flexDirection: "row", gap: spacing.sm, alignItems: "center", alignSelf: "flex-start" },
	link: { ...typography.support, color: c.accent },
});

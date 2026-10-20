import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { WordStudySection } from "@/features/bible/WordStudySection";
import { BOOKS, resolveReference } from "@/features/bible/books";
import { wordStudyHandoff } from "@/features/navigation/wordStudyHandoff";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTabBarSpace } from "@/features/chat/layout";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

/** A front door to the same word study used by the reader's verse sheet. */
export default function OriginalLanguagesScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const bottom = useTabBarSpace();
	const [query, setQuery] = useState("");
	const [target, setTarget] = useState({ order: 43, chapter: 1, verse: 1 });
	const [error, setError] = useState(false);
	const label = `${BOOKS.find((book) => book.order === target.order)?.name} ${target.chapter}:${target.verse}`;
	const open = () => {
		const reference = resolveReference(query);
		if (!reference?.verse) { setError(true); return; }
		if (!wordStudyHandoff({ order: reference.order, chapter: reference.chapter, verse: reference.verse }, "", true, "validate")) { setError(true); return; }
		setTarget({ order: reference.order, chapter: reference.chapter, verse: reference.verse });
		setError(false);
	};
	return <Screen><ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
		<Pressable accessibilityRole="button" accessibilityLabel="Back to Study" onPress={() => router.back()} style={styles.back}><Text style={styles.link}>‹ Study</Text></Pressable>
		<Text accessibilityRole="header" style={styles.title}>Original languages</Text>
		<Text style={styles.body}>Explore the Hebrew and Greek behind a verse, with Strong&apos;s meanings. You can also tap any verse in the Bible and choose Words.</Text>
		<TextInput accessibilityLabel="Verse reference" value={query} onChangeText={(value) => { setQuery(value); setError(false); }} placeholder="For example, John 3:16" placeholderTextColor={colors.textMuted} style={styles.input} onSubmitEditing={open} returnKeyType="search" />
		<Pressable accessibilityRole="button" onPress={open} style={styles.open}><Text style={styles.openText}>Study this verse</Text></Pressable>
		{error ? <Text accessibilityRole="alert" style={styles.error}>Enter a book, chapter, and verse, such as John 3:16.</Text> : null}
		<Text style={styles.reference}>{label} · KJV</Text>
		<WordStudySection getToken={getToken} book={target.order} chapter={target.chapter} verse={target.verse}
			onAsk={(prompt, attach) => {
				const params = wordStudyHandoff(target, prompt, attach, String(Date.now()));
				if (params) router.push({ pathname: "/", params });
				else setError(true);
			}} />
	</ScrollView></Screen>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	content: { padding: spacing.xl, gap: spacing.lg },
	back: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
	link: { color: c.accent, ...typography.control },
	title: { color: c.text, ...typography.screenTitle, fontWeight: "700" },
	body: { color: c.textMuted, ...typography.support },
	input: { color: c.text, ...typography.body, backgroundColor: c.surface, borderColor: c.borderStrong, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 48 },
	open: { backgroundColor: c.accent, borderRadius: radius.md, padding: spacing.md, minHeight: 48, justifyContent: "center", alignItems: "center" },
	openText: { color: c.bg, ...typography.control, fontWeight: "700" },
	error: { color: c.danger, ...typography.support },
	reference: { color: c.text, ...typography.sectionTitle },
});

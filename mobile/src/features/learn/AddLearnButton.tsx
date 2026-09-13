import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { apiJson, type GetToken } from "@/lib/api";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, type Colors } from "@/theme";
import { parseCard } from "./learn";

export interface AddLearnProps {
	book: number; chapter: number; verse: number;
	translation: "KJV" | "NKJV" | "BSB";
	source: "sheet" | "highlight" | "suggestion";
	/** Set where the surrounding text alone does not name the verse being added. */
	accessibilityLabel?: string;
	onAdded?: () => void;
}
export function AddLearnButton(props: AddLearnProps) {
	const { userId } = useAuth();
	if (!userId) return null;
	return <LearnAction key={`${userId}:${props.book}:${props.chapter}:${props.verse}:${props.translation}`} {...props} />;
}
function LearnAction({ onAdded, accessibilityLabel, ...verse }: AddLearnProps) {
	const { getToken } = useAuth();
	const token = useCallback<GetToken>(options => getToken(options?.fresh ? { skipCache: true } : undefined), [getToken]);
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const busy = useRef(false);
	const mounted = useRef(true);
	const onAddedRef = useRef(onAdded);
	onAddedRef.current = onAdded;
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const add = async () => {
		if (busy.current || status === "saved") return;
		busy.current = true; setStatus("saving");
		try {
			const card = parseCard(await apiJson(token, "/api/learn", { method: "POST", body: verse }));
			if (card.book !== verse.book || card.chapter !== verse.chapter || card.verse !== verse.verse) throw new Error("Unexpected verse");
			if (mounted.current) setStatus("saved");
		} catch { if (mounted.current) setStatus("error"); }
		finally { busy.current = false; }
	};
	useEffect(() => { if (status === "saved") onAddedRef.current?.(); }, [status]);
	return <View style={styles.root}>
		{status === "saved" ? <View><Text accessibilityLiveRegion="polite" style={styles.message}>Added to Learn.</Text><Pressable accessibilityRole="button" onPress={() => router.push("/(app)/bible/learn")} style={styles.button}><Text style={styles.label}>Open Learn</Text></Pressable></View> :
			<Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: status === "saving" }} disabled={status === "saving"} onPress={() => void add()} style={[styles.button, status === "saving" && styles.disabled]}><Text style={styles.label}>{status === "saving" ? "Adding..." : "Learn this verse"}</Text></Pressable>}
		{status === "error" && <Text accessibilityRole="alert" style={styles.error}>Could not add this verse. Check your connection and try again.</Text>}
	</View>;
}
const createStyles = (c: Colors) => StyleSheet.create({
	root: { marginVertical: spacing.sm }, button: { minHeight: 44, borderWidth: 1, borderColor: c.accentBorder, borderRadius: radius.lg, padding: spacing.md, alignItems: "center", justifyContent: "center" },
	label: { color: c.accent, fontSize: 14, fontWeight: "600" }, message: { color: c.textMuted, fontSize: 14 }, error: { color: c.danger, fontSize: 13, marginTop: spacing.sm }, disabled: { opacity: .5 },
});

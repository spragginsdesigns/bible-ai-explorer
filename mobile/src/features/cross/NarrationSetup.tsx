import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Check, ChevronDown, ChevronUp, Headphones, Pause, Play } from "lucide-react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { AppText as Text } from "@/components/AppText";
import { useThemedStyles, useTheme } from "@/features/settings/settingsStore";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { fetchNarrationVoices } from "@/features/notifications/api";
import { radius, spacing, type Colors } from "@/theme";
import { NARRATION_STYLES, type NarrationOptions, type NarrationStyle, type NarrationVoices } from "./narrationOptions";

const PREF_KEY = "sureword.narrationOptions";
export function NarrationSetup({ onGenerate }: { onGenerate: (options: NarrationOptions) => void }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const getToken = useStableGetToken();
	const [catalog, setCatalog] = useState<NarrationVoices | null>(null);
	const [voiceId, setVoiceId] = useState("");
	const [delivery, setDelivery] = useState<NarrationStyle>("natural");
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const preview = useAudioPlayer(previewUrl, { updateInterval: 250 });
	const previewStatus = useAudioPlayerStatus(preview);
	const previewStarted = useRef(false);
	useEffect(() => {
		let cancelled = false;
		setError(null);
		void Promise.all([fetchNarrationVoices(getToken), AsyncStorage.getItem(PREF_KEY).catch(() => null)]).then(([next, value]) => {
			if (cancelled) return;
			let saved: NarrationOptions = {};
			try { saved = JSON.parse(value || "{}"); } catch { /* Defaults. */ }
			setCatalog(next);
			setVoiceId(next.voices.some((v) => v.id === saved?.voiceId) ? saved.voiceId! : next.defaultVoiceId);
			if (NARRATION_STYLES.some((s) => s.id === saved?.style)) setDelivery(saved.style!);
		}).catch(() => { if (!cancelled) setError("Voices couldn't load. You can use the default narrator or try again."); });
		return () => { cancelled = true; };
	}, [getToken, attempt]);
	useEffect(() => {
		if (previewStatus.isLoaded && previewId && !previewStarted.current) { previewStarted.current = true; preview.play(); }
		if (previewStatus.didJustFinish) { setPreviewId(null); setPreviewUrl(null); }
	}, [preview, previewStatus.isLoaded, previewStatus.didJustFinish, previewId]);
	useEffect(() => {
		if (!previewId || previewStatus.playing) return;
		const timer = setTimeout(() => { setPreviewId(null); setPreviewUrl(null); setError("This preview couldn't play. Try another voice."); }, 10_000);
		return () => clearTimeout(timer);
	}, [previewId, previewStatus.playing]);
	const stopPreview = () => { preview.pause(); setPreviewId(null); setPreviewUrl(null); };
	const selected = catalog?.voices.find((v) => v.id === voiceId);
	return <View style={styles.root}>
		<View style={styles.headingRow}><Headphones size={24} color={colors.accent} style={{ marginTop: 4 }} /><View style={styles.headingText}><Text style={styles.heading}>Let today&apos;s word meet you in audio</Text><Text style={styles.body}>Your verse, reflection, study path and prayer, narrated when you choose.</Text></View></View>
		<View>
			<Pressable accessibilityRole="button" accessibilityLabel={`Narrator: ${selected?.name || "Default narrator"}`} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={({ pressed }) => [styles.picker, pressed && { backgroundColor: colors.accentSoft }]}>
				<View style={styles.flex}><Text style={styles.caption}>Narrator</Text><Text style={styles.name}>{selected?.name || "Default narrator"}</Text></View>{expanded ? <ChevronUp size={20} color={colors.textSecondary} /> : <ChevronDown size={20} color={colors.textSecondary} />}
			</Pressable>
			{expanded && <ScrollView nestedScrollEnabled style={styles.voiceList}>
				{!catalog && !error && <Text style={styles.body}>Loading voices…</Text>}
				{catalog?.voices.map((voice) => <View key={voice.id} style={styles.voiceRow}>
					<Pressable accessibilityRole="button" accessibilityState={{ selected: voiceId === voice.id }} accessibilityLabel={`${voice.name}, ${voice.description}`} onPress={() => { stopPreview(); setVoiceId(voice.id); }} style={({ pressed }) => [styles.voiceChoice, pressed && { backgroundColor: colors.accentSoft }]}><View style={styles.flex}><Text style={styles.name}>{voice.name}</Text><Text style={styles.caption}>{voice.description}</Text></View>{voiceId === voice.id && <Check size={20} color={colors.accent} />}</Pressable>
					{voice.previewUrl && <Pressable accessibilityRole="button" accessibilityLabel={`${previewId === voice.id ? "Stop" : "Preview"} ${voice.name}`} onPress={() => { stopPreview(); if (previewId !== voice.id) { previewStarted.current = false; setPreviewId(voice.id); setPreviewUrl(voice.previewUrl); } }} style={styles.sample}>{previewId === voice.id ? <Pause size={18} color={colors.accent} /> : <Play size={18} color={colors.accent} />}</Pressable>}
				</View>)}
			</ScrollView>}
		</View>
		<View><Text style={styles.label}>Delivery</Text><View style={styles.deliveryRow}>{NARRATION_STYLES.map((choice) => <Pressable key={choice.id} accessibilityRole="button" accessibilityState={{ selected: delivery === choice.id }} onPress={() => setDelivery(choice.id)} style={[styles.delivery, delivery === choice.id && styles.selected]}><Text style={[styles.deliveryLabel, delivery === choice.id && { color: colors.accent }]}>{choice.label}</Text></Pressable>)}</View><Text style={styles.caption}>{NARRATION_STYLES.find((s) => s.id === delivery)?.description}</Text></View>
		{error && <View><Text accessibilityLiveRegion="polite" style={styles.body}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(attempt + 1)} style={styles.reload}><Text style={styles.link}>Reload voices</Text></Pressable></View>}
		<Pressable accessibilityRole="button" onPress={() => { stopPreview(); const options = { ...(voiceId ? { voiceId } : {}), style: delivery }; void AsyncStorage.setItem(PREF_KEY, JSON.stringify(options)).catch(() => undefined); onGenerate(options); }} style={({ pressed }) => [styles.generate, pressed && { opacity: 0.8 }]}><Text style={styles.generateLabel}>Generate audio narrative</Text></Pressable>
		<Text style={styles.caption}>Made only on your request. Today&apos;s audio is saved, so you can return and listen again.</Text>
	</View>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	root: { gap: spacing.lg }, flex: { flex: 1 }, headingRow: { flexDirection: "row", gap: spacing.md }, headingText: { flex: 1, gap: spacing.xs },
	heading: { fontSize: 19, lineHeight: 25, fontWeight: "600", color: c.text }, body: { fontSize: 14, lineHeight: 22, color: c.textSecondary },
	caption: { fontSize: 12, lineHeight: 19, color: c.textSecondary }, label: { color: c.text, fontSize: 14, fontWeight: "600", marginBottom: spacing.sm },
	picker: { minHeight: 64, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
	name: { color: c.text, fontSize: 14, fontWeight: "600", lineHeight: 21 }, voiceList: { maxHeight: 280, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.lg, marginTop: spacing.sm },
	voiceRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
	voiceChoice: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, minHeight: 64 }, sample: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
	deliveryRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }, delivery: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", padding: spacing.xs, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.lg },
	selected: { borderColor: c.accent, backgroundColor: c.accentSoft }, deliveryLabel: { fontSize: 13, fontWeight: "600", color: c.text },
	generate: { minHeight: 52, borderRadius: radius.lg, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", padding: spacing.md }, generateLabel: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
	reload: { minHeight: 48, justifyContent: "center" }, link: { color: c.accent, fontSize: 14, fontWeight: "600" },
});

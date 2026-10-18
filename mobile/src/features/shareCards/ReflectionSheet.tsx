import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import { useUser } from "@clerk/expo";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AccentButton, GhostButton } from "@/components/ui";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { apiJson } from "@/lib/api";
import { spacing, radius, typography, type Colors } from "@/theme";
import { downloadCard, shareCardImage } from "./shareCardFiles";
import { SHARE_CARD_STYLES, SHARE_CARD_FORMATS, personalPreviewPath, type ShareCardStyle, type ShareCardFormat } from "./shareCards";
import { MAX_REFLECTION_LENGTH, REFLECTION_FONTS, REFLECTION_PLACEMENTS, DEFAULT_REFLECTION_PRESENTATION, type ReflectionPresentation } from "./reflection-contract";

type Draft = { id: string; reference: string; translation: string; text: string };

/** A draft is private. Sharing is enabled only for the exact words and appearance already previewed. */
export function ReflectionSheet({ reference, translation, onClose, initialStyle, initialFormat }: { reference: string; translation: string; onClose: () => void; initialStyle: ShareCardStyle; initialFormat: ShareCardFormat }) {
	const getToken = useStableGetToken();
	const { user } = useUser();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { height } = useWindowDimensions();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [text, setText] = useState("");
	const [signature, setSignature] = useState(user?.firstName ?? "");
	const [presentation, setPresentation] = useState<ReflectionPresentation>(DEFAULT_REFLECTION_PRESENTATION);
	const [style, setStyle] = useState<ShareCardStyle>(initialStyle);
	const [format, setFormat] = useState<ShareCardFormat>(initialFormat);
	const [busy, setBusy] = useState<string | null>("opening");
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<{ key: string; uri: string } | null>(null);
	const [publishedURL, setPublishedURL] = useState<string | null>(null);
	const active = useRef(true);
	const key = JSON.stringify({ text: text.trim(), signature: signature.trim(), presentation, style, format });
	const currentKey = useRef(key);
	currentKey.current = key;
	const ready = preview?.key === key;
	const locked = busy !== null || publishedURL !== null;

	useEffect(() => {
		active.current = true;
		apiJson<Draft>(getToken, "/api/cards/reflection", { method: "POST", body: { reference, translation } })
			.then(value => { if (active.current) setDraft(value); })
			.catch(() => { if (active.current) setError("The reflection couldn't be opened. Close it and try again."); })
			.finally(() => { if (active.current) setBusy(null); });
		return () => { active.current = false; };
	}, [getToken, reference, translation]);

	const fail = (reason: unknown) => { if (active.current) setError(reason instanceof Error ? reason.message : "That didn't work. Try again."); };
	const suggest = async () => {
		if (!draft || locked) return;
		setBusy("writing"); setError(null);
		try {
			const result = await apiJson<{ text: string }>(getToken, `/api/cards/reflection/${draft.id}/suggest`, { method: "POST" }, { timeoutMs: 90_000 });
			if (active.current) { setText(result.text); setPreview(null); }
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const updatePreview = async () => {
		if (!draft || locked || !text.trim()) return;
		const requestedKey = key;
		setBusy("preview"); setError(null); setPreview(null);
		try {
			const saved = await apiJson<{ fits: boolean }>(getToken, `/api/cards/personal/${draft.id}`, {
				method: "PATCH", body: { personalLine: text.trim(), signature: signature.trim(), presentation },
			});
			if (!saved.fits) throw new Error("Shorten your reflection or choose fewer verses so every word fits.");
			const file = await downloadCard(personalPreviewPath(draft.id, { style, format, size: "preview" }, Date.now()), { getToken });
			if (active.current && currentKey.current === requestedKey) setPreview({ key: requestedKey, uri: file.uri });
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const share = async (method: "image" | "link") => {
		if (!draft || busy || !ready) return;
		setBusy(method); setError(null);
		try {
			let url = publishedURL;
			if (!url) {
				const published = await apiJson<{ url: string }>(getToken, "/api/cards/personal", {
					method: "POST", body: { draftId: draft.id, personalLine: text.trim(), signature: signature.trim(), presentation },
				});
				url = published.url;
				if (active.current) setPublishedURL(url);
			}
			if (!active.current) return;
			if (method === "link") await Share.share({ message: `${text.trim()}\n\n${url}` });
			else {
				const file = await downloadCard(personalPreviewPath(draft.id, { style, format, size: "full" }, Date.now()), { getToken, fileName: `SureWord reflection ${draft.id}.jpg` });
				await shareCardImage(file, "Share my reflection");
			}
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const chips = <T extends string>(items: readonly { id: T; label: string }[], selected: T, label: string, choose: (id: T) => void) =>
		<View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
			{items.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: selected === item.id, disabled: locked }}
				disabled={locked} onPress={() => choose(item.id)} style={[styles.chip, selected === item.id && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
				<Text style={styles.chipText}>{item.label}</Text>
			</Pressable>)}
		</View>;

	return <BottomSheet visible onClose={onClose} title="My reflection" heightRatio={0.92}>
		<ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
			<Text style={styles.reference}>{draft?.reference ?? reference} · {translation}</Text>
			<Text style={styles.hint}>Share how this verse speaks to your walk with God. Only the words you approve are shared.</Text>
			<TextInput accessibilityLabel="My reflection" value={text} onChangeText={setText} maxLength={MAX_REFLECTION_LENGTH} multiline
				editable={!locked} placeholder="What does this verse mean in your walk?" placeholderTextColor={colors.textFaint} style={styles.input} />
			<Text style={styles.hint}>{text.length}/{MAX_REFLECTION_LENGTH}</Text>
			<GhostButton label={busy === "writing" ? "Considering your walk…" : "Draft from my walk"} onPress={() => void suggest()} disabled={!draft || locked} />
			<Text style={styles.hint}>Uses your study to suggest a reflection without private details. Review and edit every word before sharing.</Text>
			<TextInput accessibilityLabel="Name on reflection, optional" value={signature} onChangeText={setSignature} maxLength={30} editable={!locked}
				placeholder="Your name (optional)" placeholderTextColor={colors.textFaint} style={styles.name} />
			<Text style={styles.label}>Reflection font</Text>
			{chips(REFLECTION_FONTS, presentation.font, "Reflection font", font => setPresentation({ ...presentation, font }))}
			{chips(REFLECTION_PLACEMENTS, presentation.placement, "Reflection placement", placement => setPresentation({ ...presentation, placement }))}
			{chips(SHARE_CARD_STYLES, style, "Card style", setStyle)}
			{chips(SHARE_CARD_FORMATS, format, "Card size", setFormat)}
			{preview && ready ? <Image accessibilityLabel={`Your reflection: ${text}`} source={{ uri: preview.uri }} resizeMode="contain"
				style={{ height: Math.min(height * 0.35, 320), width: "100%" }} /> : null}
			{publishedURL ? <Text style={styles.hint}>This shared version is fixed. Close and reopen to write a new reflection.</Text> : null}
		</ScrollView>
		<View style={styles.footer}>
			{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
			{ready ? <>
				<AccentButton label={busy === "image" ? "Preparing…" : "Share image"} onPress={() => void share("image")} disabled={busy !== null} />
				<GhostButton label={busy === "link" ? "Preparing…" : "Share link"} onPress={() => void share("link")} disabled={busy !== null} />
			</> : <AccentButton label={busy === "preview" ? "Preparing preview…" : "Preview my card"} onPress={() => void updatePreview()} disabled={!draft || !text.trim() || locked} />}
		</View>
	</BottomSheet>;
}

const createStyles = (c: Colors) => StyleSheet.create({
	body: { padding: spacing.xl, gap: spacing.md },
	footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderStrong },
	reference: { ...typography.control, color: c.accent, fontWeight: "600" },
	hint: { ...typography.meta, color: c.textMuted },
	label: { ...typography.support, color: c.text, fontWeight: "600" },
	input: { ...typography.body, color: c.text, minHeight: 120, textAlignVertical: "top", padding: spacing.md, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md },
	name: { ...typography.support, color: c.text, minHeight: 48, padding: spacing.md, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md },
	chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
	chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: c.borderStrong },
	chipText: { ...typography.support, color: c.text },
	error: { ...typography.support, color: c.danger },
});

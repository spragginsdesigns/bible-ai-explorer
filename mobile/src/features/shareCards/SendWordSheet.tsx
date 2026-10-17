import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Share, StyleSheet, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useUser } from "@clerk/expo";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AccentButton, GhostButton } from "@/components/ui";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { apiJson } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";
import { downloadCard, shareCardImage } from "./shareCardFiles";
import {
	SHARE_CARD_FORMATS,
	SHARE_CARD_STYLES,
	parseStoredShareCardPrefs,
	personalCardPath,
	personalPreviewPath,
	type ShareCardPrefs,
} from "./shareCards";

/**
 * Send a word to someone (docs/FEATURES.md, "Share cards" -> "Send a word").
 * Mirrors src/components/share/SendWordDialog.tsx on web and the Apple sheet.
 *
 * The sender names who it is for and what they face. SureWord picks a KJV
 * passage (or uses the one the sender chose) and writes a word for them by
 * name, saved as a private draft. The sender adds their own line and name,
 * sees the card exactly as it will be shared, can ask for another word, then
 * shares the image or the link. Sharing sends the card and freezes it, so the
 * sender's fields lock from then on. What they typed about the situation is
 * held only in this sheet: the server uses it to choose and write, and never
 * stores it.
 */

const PREFS_KEY = "sureword.shareCard.v1";
const EDIT_SAVE_DELAY_MS = 700;

interface Draft {
	id: string;
	reference: string;
	word: string;
	/** The name the card was written for; the field may change after. */
	recipient: string;
}

export interface SendWordVerse {
	reference: string;
	translation: string;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function SendWordSheet({
	visible,
	verse,
	onClose,
}: {
	visible: boolean;
	/** A passage the sender already chose; otherwise SureWord finds one. Drafts are KJV. */
	verse?: SendWordVerse | null;
	onClose: () => void;
}) {
	const getToken = useStableGetToken();
	const { user } = useUser();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { height: windowHeight, width: windowWidth } = useWindowDimensions();

	const [recipient, setRecipient] = useState("");
	const [situation, setSituation] = useState("");
	const [personalLine, setPersonalLine] = useState("");
	const [signature, setSignature] = useState("");
	const [{ style, format, encourage }, setPrefs] = useState<ShareCardPrefs>({ style: "dawn", format: "story", encourage: true });
	const [draft, setDraft] = useState<Draft | null>(null);
	const [fits, setFits] = useState(true);
	const [sentId, setSentId] = useState<string | null>(null);
	const [writing, setWriting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [edit, setEdit] = useState(0);
	const [preview, setPreview] = useState<{ status: "loading" } | { status: "ready"; uri: string } | { status: "error"; message: string }>({ status: "loading" });
	const [busy, setBusy] = useState<"image" | "link" | null>(null);
	// What the draft on the server already holds, so typing saves only changes.
	const saved = useRef({ personalLine: "", signature: "" });
	const sent = draft !== null && sentId === draft.id;

	// Each open starts clean, with the sender's usual look.
	useEffect(() => {
		if (!visible) return;
		setRecipient("");
		setSituation("");
		setPersonalLine("");
		setSignature("");
		setDraft(null);
		setSentId(null);
		setFits(true);
		setError(null);
		setEdit(0);
		AsyncStorage.getItem(PREFS_KEY)
			.then((raw) => setPrefs(parseStoredShareCardPrefs(raw)))
			.catch(() => {});
	}, [visible]);

	// The sender's first name, once Clerk has it, without touching anything else.
	useEffect(() => {
		if (visible && user?.firstName) setSignature((current) => current || user.firstName || "");
	}, [visible, user?.firstName]);

	const write = useCallback(async () => {
		if (writing) return;
		setWriting(true);
		setError(null);
		try {
			const result = await apiJson<Omit<Draft, "recipient"> & { text: string; fits: boolean }>(getToken, "/api/cards/word", {
				method: "POST",
				body: {
					recipient,
					situation,
					...(verse ? { reference: verse.reference } : {}),
					// "Write another word" deletes the draft it replaces.
					...(draft && !sent ? { replaces: draft.id } : {}),
				},
			});
			let fitsNow = result.fits;
			// Carry the sender's own words onto the new draft before it is drawn.
			if (personalLine.trim() || signature.trim()) {
				const patched = await apiJson<{ fits: boolean }>(getToken, `/api/cards/personal/${result.id}`, {
					method: "PATCH",
					body: { personalLine, signature },
				});
				fitsNow = patched.fits;
			}
			saved.current = { personalLine, signature };
			setSentId(null);
			setFits(fitsNow);
			setDraft({ id: result.id, reference: result.reference, word: result.word, recipient: recipient.trim() });
			setEdit((value) => value + 1);
		} catch (err) {
			setError(errorMessage(err, "SureWord couldn't write that word just now. Try again."));
		} finally {
			setWriting(false);
		}
	}, [draft, getToken, personalLine, recipient, sent, signature, situation, verse, writing]);

	// The sender's own line and name, saved to the draft as they type, then
	// drawn into a fresh preview. A sent card is frozen, so saving stops there.
	const draftId = draft?.id ?? null;
	useEffect(() => {
		if (!draftId || sent) return;
		if (saved.current.personalLine === personalLine && saved.current.signature === signature) return;
		const timer = setTimeout(() => {
			const next = { personalLine, signature };
			apiJson<{ fits: boolean }>(getToken, `/api/cards/personal/${draftId}`, { method: "PATCH", body: next })
				.then((result) => {
					saved.current = next;
					setFits(result.fits);
					setError(null);
					setEdit((value) => value + 1);
				})
				.catch((err: unknown) => setError(errorMessage(err, "Your words couldn't be saved.")));
		}, EDIT_SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [draftId, getToken, personalLine, sent, signature]);

	useEffect(() => {
		if (!draftId) return;
		const controller = new AbortController();
		setPreview({ status: "loading" });
		downloadCard(personalPreviewPath(draftId, { style, format, size: "preview" }, edit), {
			getToken,
			signal: controller.signal,
		})
			.then((file) => {
				if (!controller.signal.aborted) setPreview({ status: "ready", uri: file.uri });
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) setPreview({ status: "error", message: errorMessage(err, "The card didn't load.") });
			});
		return () => controller.abort();
	}, [draftId, edit, format, getToken, style]);

	const choose = useCallback(
		(next: Partial<ShareCardPrefs>) => {
			// The encourage switch belongs to the Share sheet; keep whatever it holds.
			const prefs = { style, format, encourage, ...next };
			setPrefs(prefs);
			AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
		},
		[encourage, format, style]
	);

	// Sending freezes the card (the recipient must never see it change), so it
	// happens once, at the first share; the server answers a repeat with the
	// same link and changes nothing.
	const publish = useCallback(async (): Promise<string> => {
		if (!draft) throw new Error("Write the card first.");
		const result = await apiJson<{ id: string; url: string }>(getToken, "/api/cards/personal", {
			method: "POST",
			body: { draftId: draft.id, personalLine, signature },
		});
		setSentId(result.id);
		return result.url;
	}, [draft, getToken, personalLine, signature]);

	const shareImage = useCallback(async () => {
		if (!draft || busy) return;
		setBusy("image");
		setError(null);
		try {
			await publish();
			const file = await downloadCard(personalCardPath(draft.id, { style, format, size: "full" }), {
				fileName: `SureWord for ${draft.recipient.replace(/[^A-Za-z0-9 ]+/g, "").trim() || "you"} ${style} ${format}.jpg`,
			});
			await shareCardImage(file, `A word for ${draft.recipient}`);
			track(ANALYTICS_EVENTS.shareCardShared, { kind: "word", style, format, method: "image" });
			onClose();
		} catch (err) {
			setError(errorMessage(err, "That card couldn't be shared. Try again."));
		} finally {
			setBusy(null);
		}
	}, [busy, draft, format, onClose, publish, style]);

	const shareLink = useCallback(async () => {
		if (!draft || busy) return;
		setBusy("link");
		setError(null);
		try {
			const url = await publish();
			await Share.share({ message: `A word for ${draft.recipient}: ${url}` });
			track(ANALYTICS_EVENTS.shareCardShared, { kind: "word", method: "link" });
			onClose();
		} catch (err) {
			setError(errorMessage(err, "That link couldn't be shared. Try again."));
		} finally {
			setBusy(null);
		}
	}, [busy, draft, onClose, publish]);

	const aspectRatio = SHARE_CARD_FORMATS.find((option) => option.id === format)?.aspectRatio ?? 1;
	const previewHeight = Math.min(windowHeight * 0.4, (windowWidth - spacing.xl * 2) / aspectRatio);
	const canWrite = recipient.trim().length > 0 && situation.trim().length > 0 && !writing;
	const otherTranslation = verse && verse.translation.toUpperCase() !== "KJV";
	const intro = verse
		? `SureWord will write a word for them under ${verse.reference}${otherTranslation ? ", in the KJV" : ""}.`
		: "SureWord will find a verse for them and write a word to go with it.";
	// A line needs the sender's name under it; the server refuses one without.
	const needsName = personalLine.trim().length > 0 && signature.trim().length === 0;
	const canShare = draft !== null && busy === null && !writing && fits && !needsName;
	// From the moment a share starts, what is on the card is what was there.
	const wordsLocked = sent || busy !== null;

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Send a word" scroll>
			<View style={styles.body}>
				{draft ? (
					<>
						<View style={[styles.preview, { width: previewHeight * aspectRatio, height: previewHeight }]}>
							{preview.status === "ready" ? (
								<Image
									source={{ uri: preview.uri }}
									style={styles.previewImage}
									accessibilityLabel={`Card for ${draft.recipient}: ${draft.reference}. ${draft.word}`}
								/>
							) : preview.status === "error" ? (
								<Text style={styles.hint}>{preview.message}</Text>
							) : (
								<ActivityIndicator color={colors.accent} />
							)}
						</View>
						<View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Card style">
							{SHARE_CARD_STYLES.map((option) => (
								<Pressable
									key={option.id}
									accessibilityRole="radio"
									accessibilityState={{ selected: option.id === style }}
									onPress={() => choose({ style: option.id })}
									style={[styles.chip, option.id === style && styles.chipSelected]}
								>
									<Text style={[styles.chipLabel, option.id === style && styles.chipLabelSelected]}>{option.label}</Text>
								</Pressable>
							))}
						</View>
						<View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Card size">
							{SHARE_CARD_FORMATS.map((option) => (
								<Pressable
									key={option.id}
									accessibilityRole="radio"
									accessibilityState={{ selected: option.id === format }}
									onPress={() => choose({ format: option.id })}
									style={[styles.chip, option.id === format && styles.chipSelected]}
								>
									<Text style={[styles.chipLabel, option.id === format && styles.chipLabelSelected]}>{option.label}</Text>
								</Pressable>
							))}
						</View>
					</>
				) : (
					<Text style={styles.intro}>{intro}</Text>
				)}

				<Text style={styles.label}>Who is it for?</Text>
				<TextInput
					value={recipient}
					onChangeText={setRecipient}
					maxLength={40}
					placeholder="Their first name"
					placeholderTextColor={colors.textFaint}
					autoCapitalize="words"
					accessibilityLabel="Who is it for?"
					style={styles.input}
				/>
				<Text style={styles.label}>What are they facing?</Text>
				<TextInput
					value={situation}
					onChangeText={setSituation}
					maxLength={300}
					multiline
					placeholder="Surgery tomorrow, a hard week, a new job..."
					placeholderTextColor={colors.textFaint}
					accessibilityLabel="What are they facing?"
					style={[styles.input, styles.multiline]}
				/>
				<Text style={styles.hint}>Only used to choose the verse and the words. Never saved or shown.</Text>
				{draft ? (
					<GhostButton
						label={writing ? "Writing…" : "Write another word"}
						onPress={write}
						disabled={!canWrite || busy !== null}
					/>
				) : null}

				<Text style={styles.label}>Your own words (optional)</Text>
				<TextInput
					value={personalLine}
					onChangeText={setPersonalLine}
					maxLength={120}
					multiline
					editable={!wordsLocked}
					placeholder="Praying for you today."
					placeholderTextColor={colors.textFaint}
					accessibilityLabel="Your own words, optional"
					style={[styles.input, styles.multilineShort, wordsLocked && styles.locked]}
				/>
				<Text style={styles.label}>From</Text>
				<TextInput
					value={signature}
					onChangeText={setSignature}
					maxLength={30}
					editable={!wordsLocked}
					placeholder="Your first name"
					placeholderTextColor={colors.textFaint}
					autoCapitalize="words"
					accessibilityLabel="From, your first name"
					style={[styles.input, wordsLocked && styles.locked]}
				/>
				{sent ? <Text style={styles.hint}>Sent. Write another word to change it.</Text> : null}
				{draft && needsName ? <Text style={styles.hint}>Add your name under your words.</Text> : null}
				{draft && !fits ? <Text style={styles.hint}>That&apos;s a little long for the card. Shorten your words.</Text> : null}

				{!draft ? (
					<AccentButton
						label={writing ? `Finding a word for ${recipient.trim() || "them"}…` : "Write their card"}
						onPress={write}
						disabled={!canWrite}
					/>
				) : (
					<>
						<AccentButton
							label={busy === "image" ? "Preparing…" : "Share image"}
							onPress={shareImage}
							disabled={!canShare || preview.status !== "ready"}
						/>
						<GhostButton label={busy === "link" ? "Opening…" : "Share link"} onPress={shareLink} disabled={!canShare} />
					</>
				)}
				{error ? <Text style={styles.error}>{error}</Text> : null}
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		body: { paddingHorizontal: spacing.xl, gap: spacing.sm },
		intro: { color: c.textSecondary, ...typography.support, marginBottom: spacing.xs },
		label: { color: c.textSecondary, ...typography.support, fontWeight: "700", marginTop: spacing.xs },
		hint: { color: c.textFaint, ...typography.meta, textAlign: "center" },
		input: {
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			color: c.text,
			...typography.support,
		},
		locked: { opacity: 0.55 },
		multiline: { minHeight: 88, textAlignVertical: "top" },
		multilineShort: { minHeight: 64, textAlignVertical: "top" },
		preview: {
			alignSelf: "center",
			borderRadius: radius.lg,
			overflow: "hidden",
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		previewImage: { width: "100%", height: "100%" },
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
		chip: {
			minHeight: 40,
			paddingHorizontal: spacing.md,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		chipSelected: { borderColor: c.accent, borderWidth: 1.5, backgroundColor: c.accentSoft },
		chipLabel: { color: c.textMuted, ...typography.support, fontWeight: "600" },
		chipLabelSelected: { color: c.accent },
		error: { color: c.danger, ...typography.support, textAlign: "center" },
	});

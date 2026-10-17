import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Image,
	Pressable,
	Share,
	StyleSheet,
	Switch,
	useWindowDimensions,
	View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppText as Text } from "@/components/AppText";
import { AccentButton, GhostButton } from "@/components/ui";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { presentShareSheet, shareAnswer, type SharedAnswerLink } from "@/features/chat/shareApi";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { apiJson } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";
import { downloadCard, shareCardImage } from "./shareCardFiles";
import {
	SHARE_CARD_FORMATS,
	SHARE_CARD_STYLES,
	MAX_CARD_VERSES,
	canDrawCard,
	cardTranslation,
	cardNeedsSession,
	parseStoredShareCardPrefs,
	shareCardFileName,
	shareCardPath,
	verseDoorUrl,
	type ShareCardPrefs,
	type ShareCardStyle,
	type ShareCardTarget,
} from "./shareCards";

/**
 * The Share sheet for verses, Pick Up Your Cross and answers (docs/FEATURES.md,
 * "Share cards"). Mirrors src/components/share/ShareCardDialog.tsx on web and
 * macos/Shared/Share/ShareCardSheet.swift on Apple.
 *
 * The preview is the server's own card at half size, so what the reader sees
 * is exactly what gets shared, and switching style or size costs about 60 KB.
 * Share image downloads the full card and opens the system sheet. Text (or,
 * for an answer, its link) stays one tap away and is the path that works
 * offline.
 */

const PREFS_KEY = "sureword.shareCard.v1";

type PreviewState =
	| { status: "loading"; message?: string }
	| { status: "ready"; uri: string }
	| { status: "error"; message: string };

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function deviceTimeZone(): string | undefined {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
}

export function ShareCardSheet({
	target: targetProp,
	shareText,
	onClose,
}: {
	/** null keeps the sheet closed. */
	target: ShareCardTarget | null;
	/** The plain-text form for Share as text. Unused for answers, which share a link. */
	shareText?: string;
	onClose: () => void;
}) {
	// Keyed by value: callers may build the target inline on every render, and
	// a new identity must not reset the sheet or mint the link again.
	const targetKey = targetProp ? JSON.stringify(targetProp) : "";
	// eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey is the value of targetProp
	const target = useMemo(() => targetProp, [targetKey]);
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { height: windowHeight, width: windowWidth } = useWindowDimensions();

	const [{ style, format, encourage }, setChoice] = useState<ShareCardPrefs>({
		style: "dawn",
		format: "story",
		encourage: true,
	});
	// The verse's line of encouragement, written once per passage server-side.
	const [note, setNote] = useState<
		| { status: "idle" | "loading" }
		| { status: "ready"; text: string; reference: string }
		| { status: "unavailable"; message: string }
	>({ status: "idle" });
	const [reloadKey, setReloadKey] = useState(0);
	const [link, setLink] = useState<SharedAnswerLink | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	const [busy, setBusy] = useState<"image" | "text" | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const previews = useRef(new Map<string, string>());
	const timeZone = useMemo(deviceTimeZone, []);

	const drawable = target ? canDrawCard(target) : false;

	// Last style and size, per device: people tend to have a favourite. Read on
	// every open, because each chat bubble and passage mounts its own sheet and
	// a choice made in one must carry to the next.
	const open = target !== null;
	useEffect(() => {
		if (!open) return;
		AsyncStorage.getItem(PREFS_KEY)
			.then((raw) => setChoice(parseStoredShareCardPrefs(raw)))
			.catch(() => {});
	}, [open]);

	const choose = useCallback(
		(next: Partial<ShareCardPrefs>) => {
			const choice = { style: next.style ?? style, format: next.format ?? format, encourage: next.encourage ?? encourage };
			setActionError(null);
			setChoice(choice);
			AsyncStorage.setItem(PREFS_KEY, JSON.stringify(choice)).catch(() => {});
		},
		[encourage, format, style]
	);

	// Each open starts clean: a new answer needs its own link.
	useEffect(() => {
		setLink(null);
		setLinkError(null);
		setActionError(null);
		setBusy(null);
		setNote({ status: "idle" });
		setPreview({ status: "loading" });
		previews.current.clear();
	}, [target]);

	// The sheet stays mounted between shares (the reader keeps one for every
	// verse), so a reply that started for an earlier target must never land on
	// the current one: verse A's slow encouragement once replaced verse B's.
	const openKey = useRef(targetKey);
	openKey.current = targetKey;

	// Ask for the verse's encouragement as the sheet opens. A passage someone
	// already shared answers at once; a first share takes a few seconds. Any
	// failure (AI turned off, the model down) leaves a plain verse card.
	const wantsNote = target?.kind === "verse" && drawable && encourage;
	useEffect(() => {
		if (!wantsNote || target?.kind !== "verse" || note.status !== "idle") return;
		const requestKey = openKey.current;
		setNote({ status: "loading" });
		apiJson<{ reference: string; text: string }>(getToken, "/api/cards/encouragement", {
			method: "POST",
			body: { ref: target.reference },
		})
			.then((result) => {
				if (openKey.current === requestKey) setNote({ status: "ready", text: result.text, reference: result.reference });
			})
			.catch((error: unknown) => {
				if (openKey.current !== requestKey) return;
				setNote({ status: "unavailable", message: errorMessage(error, "Encouragement isn't available right now.") });
			});
	}, [getToken, note.status, target, wantsNote]);
	const withNote = wantsNote === true && note.status === "ready";

	// An answer's card is drawn from its public snapshot, so the link is
	// minted as the sheet opens. Minting is idempotent per answer, exactly as
	// the old Share button was.
	const mintLink = useCallback(() => {
		if (target?.kind !== "answer") return;
		setLinkError(null);
		shareAnswer(getToken, target.conversationId, target.messageId)
			.then(setLink)
			.catch((error: unknown) =>
				setLinkError(errorMessage(error, "The link didn't reach the server. Check your connection and try again."))
			);
	}, [getToken, target]);

	useEffect(() => {
		mintLink();
	}, [mintLink]);

	const retry = useCallback(() => {
		previews.current.clear();
		if (target?.kind === "answer" && !link) mintLink();
		setReloadKey((key) => key + 1);
	}, [link, mintLink, target]);

	const pathFor = useCallback(
		(nextStyle: ShareCardStyle, size: "full" | "preview") => {
			if (!target) return null;
			// The server's own spelling of the reference, so the card is one URL.
			const drawn = withNote && target.kind === "verse" && note.status === "ready" ? { ...target, reference: note.reference } : target;
			return shareCardPath(drawn, { style: nextStyle, format, size, timeZone, note: withNote }, link?.id);
		},
		[format, link?.id, note, target, timeZone, withNote]
	);

	const fetchPreview = useCallback(
		async (path: string, signal?: AbortSignal): Promise<string> => {
			const cached = previews.current.get(path);
			if (cached) return cached;
			const file = await downloadCard(path, {
				getToken: target && cardNeedsSession(target) ? getToken : undefined,
				signal,
			});
			previews.current.set(path, file.uri);
			return file.uri;
		},
		[getToken, target]
	);

	// Load the chosen preview, then warm the other styles so a tap on them is
	// instant.
	useEffect(() => {
		if (!target || !drawable) return;
		if (wantsNote && (note.status === "idle" || note.status === "loading")) {
			setPreview({ status: "loading", message: "Writing a word for this verse…" });
			return;
		}
		const path = pathFor(style, "preview");
		if (!path) {
			setPreview(linkError ? { status: "error", message: linkError } : { status: "loading" });
			return;
		}
		const controller = new AbortController();
		const cached = previews.current.get(path);
		setPreview(cached ? { status: "ready", uri: cached } : { status: "loading" });
		fetchPreview(path, controller.signal)
			.then((uri) => {
				if (controller.signal.aborted) return;
				setPreview({ status: "ready", uri });
				for (const option of SHARE_CARD_STYLES) {
					const other = option.id === style ? null : pathFor(option.id, "preview");
					if (other) fetchPreview(other, controller.signal).catch(() => {});
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setPreview({ status: "error", message: errorMessage(error, "The card didn't load.") });
			});
		return () => controller.abort();
	}, [drawable, fetchPreview, linkError, note.status, pathFor, reloadKey, style, target, wantsNote]);

	const shareImage = useCallback(async () => {
		if (!target || busy) return;
		const path = pathFor(style, "full");
		if (!path) return;
		setBusy("image");
		setActionError(null);
		try {
			const file = await downloadCard(path, {
				getToken: cardNeedsSession(target) ? getToken : undefined,
				fileName: shareCardFileName(target, style, format),
			});
			await shareCardImage(file, "Share from SureWord");
			track(ANALYTICS_EVENTS.shareCardShared, { kind: target.kind, style, format, method: "image" });
			onClose();
		} catch (error) {
			setActionError(errorMessage(error, "That card couldn't be shared. Try again."));
		} finally {
			setBusy(null);
		}
	}, [busy, format, getToken, onClose, pathFor, style, target]);

	const shareWords = useCallback(async () => {
		if (!target || busy) return;
		setBusy("text");
		setActionError(null);
		try {
			if (target.kind === "answer") {
				if (!link) return;
				await presentShareSheet(link.url);
			} else if (shareText) {
				// The words travel with the door, so a text share brings people in too.
				const door = verseDoorUrl(target.reference);
				const line = withNote && note.status === "ready" ? `\n\n${note.text}` : "";
				await Share.share({ message: `${shareText}${line}${door ? `\n\n${door}` : ""}` });
			}
			track(ANALYTICS_EVENTS.shareCardShared, {
				kind: target.kind,
				method: target.kind === "answer" ? "link" : "text",
			});
			onClose();
		} catch (error) {
			setActionError(errorMessage(error, "That couldn't be shared. Try again."));
		} finally {
			setBusy(null);
		}
	}, [busy, link, note, onClose, shareText, target, withNote]);

	const aspectRatio = SHARE_CARD_FORMATS.find((option) => option.id === format)?.aspectRatio ?? 1;
	// The preview never takes more than about 44% of the screen, so the
	// choices and the button stay in view on any phone.
	const previewHeight = Math.min(windowHeight * 0.44, (windowWidth - spacing.xl * 2) / aspectRatio);
	const previewWidth = previewHeight * aspectRatio;
	const styleLabel = SHARE_CARD_STYLES.find((option) => option.id === style)?.label ?? "";
	const secondaryLabel = target?.kind === "answer" ? "Share link" : "Share as text";
	const canShareWords = target?.kind === "answer" ? link !== null : Boolean(shareText);

	return (
		<BottomSheet visible={target !== null} onClose={onClose} title="Share" scroll>
			<View style={styles.body}>
				{drawable ? (
					<>
						<View
							style={[styles.preview, { width: previewWidth, height: previewHeight }]}
							// Grouped only once it is a picture, so TalkBack can still reach
							// "Try again" when the card fails.
							accessible={preview.status === "ready"}
							accessibilityLabel={preview.status === "ready" ? `Preview of the ${styleLabel} ${format} card` : undefined}
						>
							{preview.status === "ready" ? (
								<Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="cover" />
							) : preview.status === "error" ? (
								<View style={styles.previewMessage}>
									<Text style={styles.previewError}>{preview.message}</Text>
									<Pressable
										accessibilityRole="button"
										onPress={retry}
										style={({ pressed }) => [styles.retry, pressed && { backgroundColor: colors.accentPressed }]}
									>
										<Text style={styles.retryLabel}>Try again</Text>
									</Pressable>
								</View>
							) : (
								<View style={styles.previewMessage}>
									<ActivityIndicator color={colors.accent} />
									{preview.message ? <Text style={styles.previewError}>{preview.message}</Text> : null}
								</View>
							)}
						</View>

						<View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Card style">
							{SHARE_CARD_STYLES.map((option) => {
								const selected = option.id === style;
								return (
									<Pressable
										key={option.id}
										accessibilityRole="radio"
										accessibilityState={{ selected }}
										onPress={() => choose({ style: option.id })}
										style={({ pressed }) => [
											styles.chip,
											selected && styles.chipSelected,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<View style={[styles.swatch, { backgroundColor: option.swatch[1] }]}>
											<View style={[styles.swatchGlow, { backgroundColor: option.swatch[0] }]} />
										</View>
										<Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{option.label}</Text>
									</Pressable>
								);
							})}
						</View>

						<View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Card size">
							{SHARE_CARD_FORMATS.map((option) => {
								const selected = option.id === format;
								return (
									<Pressable
										key={option.id}
										accessibilityRole="radio"
										accessibilityState={{ selected }}
										onPress={() => choose({ format: option.id })}
										style={[styles.segmentOption, selected && styles.segmentSelected]}
									>
										<Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
											{option.label}
										</Text>
									</Pressable>
								);
							})}
						</View>

						{target?.kind === "verse" ? (
							<View style={styles.noteRow}>
								<View style={styles.noteText}>
									<Text style={styles.noteLabel}>Add a word of encouragement</Text>
									{encourage && note.status === "unavailable" ? (
										<Text style={styles.noteHint}>{note.message}</Text>
									) : null}
								</View>
								<Switch
									accessibilityLabel="Add a word of encouragement"
									value={encourage}
									onValueChange={(value) => {
										choose({ encourage: value });
										if (value && note.status === "unavailable") setNote({ status: "idle" });
									}}
									trackColor={{ true: colors.accentBorder, false: colors.borderStrong }}
									thumbColor={encourage ? colors.accent : colors.textFaint}
								/>
							</View>
						) : null}

						<AccentButton
							label={busy === "image" ? "Preparing…" : "Share image"}
							onPress={shareImage}
							disabled={busy !== null || preview.status !== "ready"}
							style={styles.primary}
						/>
					</>
				) : (
					<Text style={styles.textOnly}>
						{target?.kind === "verse" && cardTranslation(target.translation)
							? `A card holds up to ${MAX_CARD_VERSES} verses. This passage shares as text.`
							: "Cards are drawn in the KJV, BSB and NKJV. This passage shares as text."}
					</Text>
				)}

				<GhostButton
					label={busy === "text" ? "Opening…" : secondaryLabel}
					onPress={shareWords}
					disabled={busy !== null || !canShareWords}
				/>
				{actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		body: { paddingHorizontal: spacing.xl, gap: spacing.md, alignItems: "stretch" },
		preview: {
			alignSelf: "center",
			borderRadius: radius.lg,
			overflow: "hidden",
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		previewImage: { width: "100%", height: "100%" },
		previewMessage: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
		previewError: { color: c.textSecondary, ...typography.support, textAlign: "center" },
		retry: {
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
		},
		retryLabel: { color: c.accent, ...typography.control, fontWeight: "600" },
		chips: { flexDirection: "row", gap: spacing.sm, justifyContent: "center" },
		chip: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 44,
			paddingHorizontal: spacing.md,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		chipSelected: { borderColor: c.accent, borderWidth: 1.5, backgroundColor: c.accentSoft },
		swatch: { width: 18, height: 18, borderRadius: 9, overflow: "hidden", justifyContent: "flex-start", alignItems: "center" },
		swatchGlow: { width: 12, height: 12, borderRadius: 6, marginTop: 2, opacity: 0.9 },
		chipLabel: { color: c.textMuted, ...typography.support, fontWeight: "600" },
		chipLabelSelected: { color: c.accent },
		segment: {
			flexDirection: "row",
			alignSelf: "center",
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			padding: 3,
		},
		segmentOption: { minHeight: 38, minWidth: 96, paddingHorizontal: spacing.lg, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
		segmentSelected: { backgroundColor: c.accentSoft },
		segmentLabel: { color: c.textMuted, ...typography.support, fontWeight: "600" },
		segmentLabelSelected: { color: c.accent },
		noteRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
		noteText: { flex: 1, gap: 2 },
		noteLabel: { color: c.textSecondary, ...typography.support, fontWeight: "600" },
		noteHint: { color: c.textFaint, ...typography.meta },
		primary: { marginTop: spacing.xs },
		textOnly: { color: c.textSecondary, ...typography.support, textAlign: "center", paddingVertical: spacing.md },
		actionError: { color: c.danger, ...typography.support, textAlign: "center" },
	});

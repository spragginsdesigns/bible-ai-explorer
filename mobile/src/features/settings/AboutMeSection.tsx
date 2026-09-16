import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { MAX_ABOUT_ME_LENGTH } from "./preferences";
import { hydratePreferences, saveAboutMe } from "./preferencesSync";
import { getSettings, useSettings, useTheme, useThemedStyles } from "./settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

/**
 * "About me": the paragraph the user writes about themselves, which the
 * assistant reads on every conversation. One field rather than a map, so there
 * is nothing to merge, but the load / dirty / save / retry shape is the same as
 * HighlightLabelsSection so the two cards behave identically under a bad
 * connection.
 */
export function AboutMeSection() {
	const aboutMe = useSettings().aboutMe;
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [draft, setDraft] = useState<string>(() => aboutMe ?? "");
	const draftRef = useRef(draft);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (aboutMe === null) return;
		setLoadFailed(false);
		// An edit in progress outranks the account: the user is looking at it.
		if (dirty) return;
		draftRef.current = aboutMe;
		setDraft(aboutMe);
	}, [aboutMe, dirty]);

	useEffect(() => {
		if (aboutMe !== null) return;
		let active = true;
		void hydratePreferences(true).then(() => {
			if (active && getSettings().aboutMe === null) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [aboutMe]);

	const change = (value: string) => {
		setSaved(false);
		setError(null);
		draftRef.current = value;
		setDraft(value);
		setDirty(true);
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		await hydratePreferences(true);
		if (getSettings().aboutMe === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || !dirty) return;
		const submitted = draftRef.current;

		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveAboutMe(submitted);
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}

		// The confirmed text is adopted only if the box still holds what was
		// sent; typing during the save keeps the card dirty and the text theirs.
		if (draftRef.current === submitted) {
			draftRef.current = result.aboutMe;
			setDraft(result.aboutMe);
			setDirty(false);
		}
		setSaved(true);
	};

	const status = error
		? error
		: saving
			? "Saving to your account…"
			: dirty
				? "Unsaved changes"
				: saved
					? "Saved to your account"
					: null;

	return (
		<>
			<Text style={styles.sectionLabel}>ABOUT ME</Text>
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>
					Tell SureWord about yourself in your own words: where you are in your walk with the Lord,
					your church background, what you are studying, what you want from this app. The assistant
					reads this on every conversation. Leave it blank and it learns only from what you say in
					chat.
				</Text>

				{aboutMe === null ? (
					<View style={styles.loadingRow}>
						<Text style={styles.hint}>
							{loadFailed ? "Couldn't load your About me." : "Loading About me…"}
						</Text>
						{loadFailed ? (
							<Pressable
								accessibilityRole="button"
								onPress={() => void retryLoad()}
								style={({ pressed }) => [
									styles.retryButton,
									pressed && { backgroundColor: colors.surfacePressed },
								]}
							>
								<Text style={styles.retryLabel}>Retry</Text>
							</Pressable>
						) : null}
					</View>
				) : (
					<>
						<TextInput
							value={draft}
							onChangeText={change}
							maxLength={MAX_ABOUT_ME_LENGTH}
							placeholder="Saved in 2019, studying Romans with my church, and I want help understanding what I read."
							placeholderTextColor={colors.textFaint}
							selectionColor={colors.accent}
							accessibilityLabel="About me"
							multiline
							textAlignVertical="top"
							style={styles.input}
						/>

						<View style={styles.saveRow}>
							<Text
								accessibilityLiveRegion="polite"
								style={[styles.status, error ? styles.error : null]}
							>
								{status ?? ""}
							</Text>
							<Text style={styles.counter}>{`${draft.length} / ${MAX_ABOUT_ME_LENGTH}`}</Text>
							<Pressable
								accessibilityRole="button"
								disabled={saving || !dirty}
								onPress={() => void save()}
								style={({ pressed }) => [
									styles.saveButton,
									(saving || !dirty) && styles.buttonDisabled,
									pressed && { opacity: 0.82 },
								]}
							>
								<Text style={styles.saveLabel}>{saving ? "Saving…" : "Save"}</Text>
							</Pressable>
						</View>
					</>
				)}
			</GlassCard>
		</>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		sectionLabel: {
			color: c.textFaint,
			...typography.sectionTitle,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
		},
		card: { padding: spacing.lg, gap: spacing.md },
		hint: { flex: 1, color: c.textFaint, ...typography.support },
		loadingRow: {
			minHeight: 72,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
		},
		retryButton: {
			minWidth: 64,
			minHeight: 44,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		retryLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		input: {
			minHeight: 120,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			borderRadius: radius.md,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			color: c.text,
			...typography.control,
		},
		saveRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingTop: spacing.sm,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		status: { flex: 1, color: c.textFaint, ...typography.micro },
		// Fixed width so the row does not shift as the count grows a digit.
		counter: { minWidth: 72, textAlign: "right", color: c.textFaint, ...typography.micro },
		error: { color: c.danger },
		saveButton: {
			minHeight: 46,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			backgroundColor: c.accent,
		},
		saveLabel: { color: "#171717", ...typography.meta, fontWeight: "700" },
		buttonDisabled: { opacity: 0.4 },
	});

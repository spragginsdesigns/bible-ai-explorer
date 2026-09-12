import React, { useCallback, useEffect, useState, useRef } from "react";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AccentButton } from "@/components/ui";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { useAuth } from "@clerk/expo";
import type { GetToken } from "@/lib/api";
import { fetchChurch } from "@/features/church/api";
import { PRESET_TAG_COLORS } from "../types";
import { BottomSheet } from "./primitives";

import { buildNoteTemplate, NOTE_TEMPLATE_OPTIONS, type NoteTemplateId, type NoteTemplateSeed } from "../noteTemplates";
export type { NoteTemplateId, NoteTemplateSeed } from "../noteTemplates";

/**
 * Shared create sheet for notes (B7: pick a template), folders (name only)
 * and tags (name + swatch). `onSubmit` receives the trimmed name and, for
 * tags, the chosen colour; `onSelectTemplate` receives the template id and
 * its ready-to-save seed.
 */
export function CreateItemSheet({
	visible,
	kind,
	onClose,
	onSubmit,
	onSelectTemplate,
}: {
	visible: boolean;
	kind: "folder" | "tag" | "note";
	onClose: () => void;
	onSubmit: (name: string, color: string) => void;
	onSelectTemplate?: (id: NoteTemplateId, seed: NoteTemplateSeed | null) => Promise<(() => void) | void>;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<string>(PRESET_TAG_COLORS[0]);
	const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const operation = useRef(false);
 const session = useRef<string | null | undefined>(null);
 const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { getToken, userId } = useAuth();
 session.current = userId;
 const visibleRef = useRef(visible);
 visibleRef.current = visible;
 const pendingNavigation = useRef<{ owner: string; action: () => void } | null>(null);
 const focusSubscription = useRef<ReturnType<typeof AppState.addEventListener> | null>(null);
 const cancelPendingNavigation = useCallback(() => {
  pendingNavigation.current = null;
  focusSubscription.current?.remove();
  focusSubscription.current = null;
 }, []);
 const finishDismissal = useCallback(() => {
  const pending = pendingNavigation.current;
  if (!pending || visibleRef.current) return;
  // Consume before invoking navigation so repeated native focus events are harmless.
  cancelPendingNavigation();
  if (mounted.current && session.current === pending.owner) pending.action();
 }, [cancelPendingNavigation]);
 useEffect(() => () => cancelPendingNavigation(), [cancelPendingNavigation]);
 useEffect(() => {
  if (visible) cancelPendingNavigation();
 }, [visible, userId, cancelPendingNavigation]);

	// The API layer's `{ fresh: true }` maps to Clerk's cache skip.
	const getApiToken = useCallback<GetToken>(
		(opts) => getToken(opts?.fresh ? { skipCache: true } : undefined),
		[getToken]
	);

	useEffect(() => {
		if (visible) {
			setName("");
            setError(null);
			setColor(PRESET_TAG_COLORS[0]);
		}
	}, [visible]);


	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onSubmit(trimmed, color);
		onClose();
	};

	const pickTemplate = async (id: NoteTemplateId) => {
		if (operation.current || !onSelectTemplate || !userId) return;
		operation.current = true; setBusy(true); setError(null);
		const owner = userId;
		try {
			let churchName: string | null = null;
			if (id === "sermon") {
				const data = await fetchChurch(getApiToken);
				if (data.status !== "unavailable") churchName = data.church?.name ?? null;
			}
			if (!mounted.current || session.current !== owner) return;
			const afterDismiss = await onSelectTemplate(id, buildNoteTemplate(id, { churchName }));
            if (!mounted.current || session.current !== owner) return;
            if (afterDismiss) {
                pendingNavigation.current = { owner, action: afterDismiss };
                // Android Modal has no onDismiss callback in RN 0.86. Its native
                // window relinquishes focus to the Activity when it is dismissed.
                // Subscribe before requesting dismissal; never navigate on a timer.
                if (Platform.OS === "android") {
                    focusSubscription.current = AppState.addEventListener("focus", finishDismissal);
                }
            }
            onClose();
		} catch {
			if (mounted.current && session.current === owner) setError("Could not finish creating the note. Check your notes before trying again.");
		} finally {
			operation.current = false;
			if (mounted.current) setBusy(false);
		}
	};

	return (
		<BottomSheet
			visible={visible}
            onDismiss={Platform.OS === "ios" ? finishDismissal : undefined}
			onClose={() => { if (!operation.current) onClose(); }}
			title={
				kind === "note" ? "Start a note" : kind === "folder" ? "New folder" : "New tag"
			}
		>
			{kind === "note" ? (
				<View style={styles.templateList}>
                    {error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
                    {busy && <Text>Creating your note...</Text>}
					{NOTE_TEMPLATE_OPTIONS.map((option) => (
						<Pressable
							key={option.id}
							accessibilityRole="button"
							accessibilityLabel={option.label}
							disabled={busy}
                            accessibilityState={{ disabled: busy }}
                            onPress={() => void pickTemplate(option.id)}
							style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}
						>
							<Text style={styles.templateLabel}>{option.label}</Text>
							<Text style={styles.templateDescription}>{option.description}</Text>
						</Pressable>
					))}
				</View>
			) : (
				<>
					<TextInput
						value={name}
						onChangeText={setName}
						onSubmitEditing={submit}
						autoFocus
						returnKeyType="done"
						placeholder={kind === "folder" ? "Folder name" : "Tag name"}
						placeholderTextColor={colors.textGhost}
						style={styles.input}
					/>

					{kind === "tag" ? (
						<View style={styles.swatches}>
							{PRESET_TAG_COLORS.map((preset) => (
								<Pressable
									key={preset}
									accessibilityRole="button"
									accessibilityLabel={`Colour ${preset}`}
									accessibilityState={{ selected: color === preset }}
									onPress={() => setColor(preset)}
									style={[
										styles.swatch,
										{ backgroundColor: preset },
										color === preset && styles.swatchActive,
									]}
								/>
							))}
						</View>
					) : null}

					<AccentButton
						label={kind === "folder" ? "Create folder" : "Create tag"}
						onPress={submit}
						disabled={!name.trim()}
						style={styles.submit}
					/>
					<Text style={styles.hint}>
						{kind === "folder"
							? "Folders group your studies; filter by them from the notes list."
							: "Tags show as coloured dots on each note card."}
					</Text>
				</>
			)}
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		templateList: { gap: spacing.sm },
		templateRow: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
			paddingVertical: 12,
		},
		templateLabel: { color: c.text, fontSize: 15, fontWeight: "600" },
		templateDescription: {
			...typography.meta,
			color: c.textFaint,
			marginTop: 2,
		},
		pressed: { backgroundColor: c.surfacePressed },
		input: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 12,
			color: c.text,
			fontSize: 15,
		},
		swatches: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.md,
			marginTop: spacing.lg,
		},
		swatch: {
			width: 30,
			height: 30,
			borderRadius: 15,
			borderWidth: 2,
			borderColor: "transparent",
		},
		swatchActive: { borderColor: c.text },
		submit: { marginTop: spacing.xl },
		hint: {
			...typography.support,
			color: c.textGhost,
			textAlign: "center",
			marginTop: spacing.md,
		},
	});

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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

/**
 * B7 note templates, mirrored from src/components/notes/noteTemplates.ts —
 * keep the wording identical when editing either copy. Each template is a
 * skeleton in the house style: first person, a descriptive title, claim-style
 * headings, the primary verse as a blockquote ending "— Reference, KJV", and
 * a closing "What I do next". Italic lines are prompts the writer replaces.
 */

export type NoteTemplateId = "verse-study" | "sermon" | "prayer" | "blank";

export interface NoteTemplateSeed {
	title: string;
	html: string;
	plainText: string;
	wordCount: number;
}

export interface NoteTemplateOption {
	id: NoteTemplateId;
	label: string;
	description: string;
}

export const NOTE_TEMPLATE_OPTIONS: NoteTemplateOption[] = [
	{
		id: "verse-study",
		label: "Verse study",
		description: "One verse, what it says, what it means, what you do next.",
	},
	{
		id: "sermon",
		label: "Sermon notes",
		description: "Sunday's date and your church, the passage, the point to keep.",
	},
	{
		id: "prayer",
		label: "Prayer journal",
		description: "Thanks, requests, and the people you are praying for.",
	},
	{
		id: "blank",
		label: "Blank note",
		description: "Start from an empty page.",
	},
];

/** The most recent Sunday (today when today is Sunday). */
function lastSunday(now: Date): Date {
	const day = new Date(now);
	day.setDate(day.getDate() - day.getDay());
	return day;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function prompt(text: string): string {
	return `<p><em>${text}</em></p>`;
}

function buildHtml(id: Exclude<NoteTemplateId, "blank">, churchName: string | null): string {
	switch (id) {
		case "verse-study":
			return [
				"<h2>The text</h2>",
				"<blockquote><p>Write the verse out in full. — Reference, KJV</p></blockquote>",
				"<h2>What it says</h2>",
				prompt("What the verse actually says, in my own words."),
				"<h2>What it means</h2>",
				prompt("What this teaches me about God, and about myself."),
				"<h2>The rest of Scripture on it</h2>",
				prompt("Cross-references that say the same thing."),
				"<h2>What I do next</h2>",
				prompt("One concrete thing this changes today."),
			].join("");
		case "sermon":
			return [
				...(churchName ? [prompt(`Church: ${churchName}`)] : []),
				"<h2>The passage</h2>",
				"<blockquote><p>The text the sermon preached. — Reference, KJV</p></blockquote>",
				"<h2>The preacher’s point</h2>",
				prompt("The one thing the sermon said."),
				"<h2>What I need to remember</h2>",
				prompt("The lines worth keeping."),
				"<h2>What I do next</h2>",
				prompt("How this sermon changes my week."),
			].join("");
		case "prayer":
			return [
				"<h2>What I thank God for</h2>",
				prompt("Name the mercies, specifically."),
				"<h2>What I ask</h2>",
				prompt("The requests, plainly."),
				"<h2>Who I pray for</h2>",
				prompt("The people, by name."),
				"<h2>What I do next</h2>",
				prompt("What faithfulness looks like while I wait."),
			].join("");
	}
}

function plainTextOf(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The seed for a template, or null for a blank note (the old behaviour).
 * `churchName` personalises the sermon template when the user has set a
 * church; the line is omitted otherwise.
 */
export function buildNoteTemplate(
	id: NoteTemplateId,
	options: { churchName?: string | null; now?: Date } = {}
): NoteTemplateSeed | null {
	if (id === "blank") return null;
	const now = options.now ?? new Date();
	const churchName = options.churchName ?? null;
	const title =
		id === "sermon"
			? `Sermon notes — ${formatDate(lastSunday(now))}`
			: id === "prayer"
				? `Prayer journal — ${formatDate(now)}`
				: "Verse study";
	const html = buildHtml(id, churchName);
	const plainText = plainTextOf(html);
	return {
		title,
		html,
		plainText,
		wordCount: plainText ? plainText.split(/\s+/).length : 0,
	};
}

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
	onSelectTemplate?: (id: NoteTemplateId, seed: NoteTemplateSeed | null) => void;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<string>(PRESET_TAG_COLORS[0]);
	const [churchName, setChurchName] = useState<string | null>(null);
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { getToken } = useAuth();

	// The API layer's `{ fresh: true }` maps to Clerk's cache skip.
	const getApiToken = useCallback<GetToken>(
		(opts) => getToken(opts?.fresh ? { skipCache: true } : undefined),
		[getToken]
	);

	useEffect(() => {
		if (visible) {
			setName("");
			setColor(PRESET_TAG_COLORS[0]);
		}
	}, [visible]);

	// The sermon template carries the user's church when they have set one.
	useEffect(() => {
		if (!visible || kind !== "note") return;
		let cancelled = false;
		fetchChurch(getApiToken)
			.then((data) => {
				if (cancelled || data.status === "unavailable") return;
				if (data.church?.name) setChurchName(data.church.name);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [visible, kind, getApiToken]);

	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onSubmit(trimmed, color);
		onClose();
	};

	const pickTemplate = (id: NoteTemplateId) => {
		onSelectTemplate?.(id, buildNoteTemplate(id, { churchName }));
		onClose();
	};

	return (
		<BottomSheet
			visible={visible}
			onClose={onClose}
			title={
				kind === "note" ? "Start a note" : kind === "folder" ? "New folder" : "New tag"
			}
		>
			{kind === "note" ? (
				<View style={styles.templateList}>
					{NOTE_TEMPLATE_OPTIONS.map((option) => (
						<Pressable
							key={option.id}
							accessibilityRole="button"
							accessibilityLabel={option.label}
							onPress={() => pickTemplate(option.id)}
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

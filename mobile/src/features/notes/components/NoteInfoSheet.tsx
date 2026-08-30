import React, { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { fetchNoteLinks } from "../api";
import {
	PROPERTY_TYPES,
	PROPERTY_TYPE_LABELS,
	formatPropertyValue,
	normalizeAliases,
	normalizePropertyKey,
	parsePropertyValue,
	propertyEntries,
	propertyKeyTaken,
	propertyTypeOf,
	propertyValueToInput,
	removeNoteProperty,
	setNoteProperty,
	type NotePropertyType,
} from "../noteProperties";
import type { Note, NoteLinks, NoteProperties } from "../types";
import { useStableGetToken } from "../useStableGetToken";
import { relativeTime } from "../utils";
import { outgoingLinkLabel } from "../wikilinks";
import { BottomSheet, Chip } from "./primitives";

/** Add form state; `originalKey` is null while adding rather than editing. */
interface PropertyDraft {
	originalKey: string | null;
	key: string;
	type: NotePropertyType;
	value: string;
}

const VALUE_PLACEHOLDER: Record<NotePropertyType, string> = {
	text: "Value",
	number: "0",
	checkbox: "",
	list: "Comma separated",
};

/**
 * Everything about a note that is not its text: read-only stats, the editable
 * aliases and custom properties, and both directions of its wikilink graph.
 * Links are fetched per open because the server recomputes them from the saved
 * text, so the screen flushes the editor before showing this.
 */
export function NoteInfoSheet({
	visible,
	note,
	folderName,
	onClose,
	onSaveAliases,
	onSaveProperties,
	onCreateLinkedNote,
}: {
	visible: boolean;
	note: Note;
	folderName: string | null;
	onClose: () => void;
	onSaveAliases: (aliases: string[]) => void;
	onSaveProperties: (properties: NoteProperties) => void;
	/** Resolves to the new note's id, or null when the create failed. */
	onCreateLinkedNote: (title: string) => Promise<string | null>;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();

	const [links, setLinks] = useState<NoteLinks | null>(null);
	const [linksLoading, setLinksLoading] = useState(false);
	const [linksError, setLinksError] = useState<string | null>(null);
	const [creatingTarget, setCreatingTarget] = useState<string | null>(null);

	const [aliasDraft, setAliasDraft] = useState("");
	const [draft, setDraft] = useState<PropertyDraft | null>(null);

	const loadLinks = useCallback(async () => {
		setLinksLoading(true);
		setLinksError(null);
		try {
			setLinks(await fetchNoteLinks(getToken, note.id));
		} catch (error) {
			setLinksError(error instanceof Error ? error.message : "Could not load links.");
		} finally {
			setLinksLoading(false);
		}
	}, [getToken, note.id]);

	useEffect(() => {
		if (!visible) return;
		setAliasDraft("");
		setDraft(null);
		setCreatingTarget(null);
		void loadLinks();
	}, [visible, loadLinks]);

	const openNote = useCallback(
		(noteId: string) => {
			onClose();
			router.push(`/notes/${noteId}`);
		},
		[onClose, router]
	);

	const createAndOpen = useCallback(
		async (targetTitle: string) => {
			if (creatingTarget) return;
			setCreatingTarget(targetTitle);
			const createdId = await onCreateLinkedNote(targetTitle);
			setCreatingTarget(null);
			if (createdId) openNote(createdId);
		},
		[creatingTarget, onCreateLinkedNote, openNote]
	);

	const addAlias = () => {
		const next = normalizeAliases([...note.aliases, aliasDraft]);
		setAliasDraft("");
		if (next.length !== note.aliases.length) onSaveAliases(next);
	};

	const removeAlias = (alias: string) => {
		onSaveAliases(note.aliases.filter((entry) => entry !== alias));
	};

	const draftKey = draft ? normalizePropertyKey(draft.key) : "";
	const draftValue = draft ? parsePropertyValue(draft.type, draft.value) : null;
	const draftValid =
		draft !== null &&
		draftKey.length > 0 &&
		draftValue !== null &&
		!propertyKeyTaken(note.properties, draftKey, draft.originalKey ?? undefined);

	const saveDraft = () => {
		if (!draft || !draftValid || draftValue === null) return;
		onSaveProperties(
			setNoteProperty(note.properties, draftKey, draftValue, draft.originalKey ?? undefined)
		);
		setDraft(null);
	};

	const outgoing = links?.outgoing ?? [];
	const backlinks = links?.backlinks ?? [];

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Note info" heightRatio={0.88}>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
			>
				<Text style={styles.sectionTitle}>Properties</Text>

				<View style={styles.statBox}>
					<StatRow label="Created" value={relativeTime(note.createdAt)} styles={styles} />
					<StatRow label="Updated" value={relativeTime(note.updatedAt)} styles={styles} />
					<StatRow label="Words" value={String(note.wordCount)} styles={styles} />
					<StatRow label="Folder" value={folderName ?? "None"} styles={styles} />
				</View>

				<Text style={styles.fieldLabel}>Aliases</Text>
				{note.aliases.length > 0 ? (
					<View style={styles.aliasRow}>
						{note.aliases.map((alias) => (
							<Pressable
								key={alias}
								accessibilityRole="button"
								accessibilityLabel={`Remove alias ${alias}`}
								onPress={() => removeAlias(alias)}
								style={({ pressed }) => [styles.alias, pressed && styles.aliasPressed]}
							>
								<Text style={styles.aliasLabel} numberOfLines={1}>
									{alias}
								</Text>
								<Ionicons name="close" size={13} color={colors.textMuted} />
							</Pressable>
						))}
					</View>
				) : (
					<Text style={styles.hint}>
						None. An alias lets a [[wikilink]] find this note by another name.
					</Text>
				)}

				<View style={styles.inlineForm}>
					<TextInput
						value={aliasDraft}
						onChangeText={setAliasDraft}
						onSubmitEditing={addAlias}
						placeholder="Add an alias"
						placeholderTextColor={colors.textGhost}
						returnKeyType="done"
						style={[styles.input, styles.inputFill]}
					/>
					<Pressable
						accessibilityRole="button"
						onPress={addAlias}
						disabled={!aliasDraft.trim()}
						style={({ pressed }) => [
							styles.addButton,
							pressed && { backgroundColor: colors.accentPressed },
							!aliasDraft.trim() && styles.dimmed,
						]}
					>
						<Text style={styles.addButtonLabel}>Add</Text>
					</Pressable>
				</View>

				<Text style={styles.fieldLabel}>Custom properties</Text>
				{propertyEntries(note.properties).length === 0 ? (
					<Text style={styles.hint}>None yet.</Text>
				) : (
					propertyEntries(note.properties).map(([key, value]) => (
						<View key={key} style={styles.propertyRow}>
							<View style={styles.propertyBody}>
								<Text style={styles.propertyKey} numberOfLines={1}>
									{key}
								</Text>
								<Text style={styles.propertyValue} numberOfLines={2}>
									{formatPropertyValue(value)}
								</Text>
							</View>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Edit property ${key}`}
								hitSlop={6}
								onPress={() =>
									setDraft({
										originalKey: key,
										key,
										type: propertyTypeOf(value),
										value: propertyValueToInput(value),
									})
								}
							>
								<Ionicons name="create-outline" size={17} color={colors.textMuted} />
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Delete property ${key}`}
								hitSlop={6}
								onPress={() => onSaveProperties(removeNoteProperty(note.properties, key))}
							>
								<Ionicons name="trash-outline" size={17} color={colors.danger} />
							</Pressable>
						</View>
					))
				)}

				{draft ? (
					<View style={styles.draftBox}>
						<TextInput
							value={draft.key}
							onChangeText={(key) => setDraft({ ...draft, key })}
							placeholder="Property name"
							placeholderTextColor={colors.textGhost}
							style={styles.input}
						/>
						<View style={styles.typeRow}>
							{PROPERTY_TYPES.map((type) => (
								<Chip
									key={type}
									label={PROPERTY_TYPE_LABELS[type]}
									active={draft.type === type}
									onPress={() =>
										setDraft({
											...draft,
											type,
											// Checkbox has no free text, so seed it with a real value.
											value: type === "checkbox" ? "true" : draft.value,
										})
									}
								/>
							))}
						</View>

						{draft.type === "checkbox" ? (
							<View style={styles.typeRow}>
								<Chip
									label="Yes"
									active={draft.value === "true"}
									onPress={() => setDraft({ ...draft, value: "true" })}
								/>
								<Chip
									label="No"
									active={draft.value === "false"}
									onPress={() => setDraft({ ...draft, value: "false" })}
								/>
							</View>
						) : (
							<TextInput
								value={draft.value}
								onChangeText={(value) => setDraft({ ...draft, value })}
								placeholder={VALUE_PLACEHOLDER[draft.type]}
								placeholderTextColor={colors.textGhost}
								keyboardType={draft.type === "number" ? "numeric" : "default"}
								style={styles.input}
							/>
						)}

						<View style={styles.draftActions}>
							<Pressable accessibilityRole="button" onPress={saveDraft} disabled={!draftValid}>
								<Text style={[styles.saveLabel, !draftValid && styles.dimmed]}>Save</Text>
							</Pressable>
							<Pressable accessibilityRole="button" onPress={() => setDraft(null)}>
								<Text style={styles.cancelLabel}>Cancel</Text>
							</Pressable>
						</View>
					</View>
				) : (
					<Pressable
						accessibilityRole="button"
						onPress={() => setDraft({ originalKey: null, key: "", type: "text", value: "" })}
						style={({ pressed }) => [styles.addProperty, pressed && styles.aliasPressed]}
					>
						<Ionicons name="add" size={15} color={colors.textFaint} />
						<Text style={styles.addPropertyLabel}>Add property</Text>
					</Pressable>
				)}

				<View style={styles.divider} />

				<Text style={styles.sectionTitle}>Links ({outgoing.length})</Text>
				{linksError ? (
					<Pressable
						accessibilityRole="button"
						onPress={() => void loadLinks()}
						style={({ pressed }) => [
							styles.errorBar,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<Text style={styles.errorText} numberOfLines={2}>
							{linksError}
						</Text>
						<Text style={styles.errorRetry}>Retry</Text>
					</Pressable>
				) : linksLoading && !links ? (
					<ActivityIndicator style={styles.loader} color={colors.accent} />
				) : outgoing.length === 0 ? (
					<Text style={styles.hint}>
						None. Type [[ a note title ]] in this note, or use the link button above the
						keyboard.
					</Text>
				) : (
					outgoing.map((link) => {
						const label = outgoingLinkLabel(link);
						if (link.noteId) {
							const targetId = link.noteId;
							return (
								<Pressable
									key={`${link.targetTitle}-${targetId}`}
									accessibilityRole="button"
									accessibilityLabel={`Open ${label}`}
									onPress={() => openNote(targetId)}
									style={({ pressed }) => [styles.linkRow, pressed && styles.aliasPressed]}
								>
									<Ionicons name="arrow-forward" size={15} color={colors.textMuted} />
									<Text style={styles.linkTitle} numberOfLines={1}>
										{label}
									</Text>
								</Pressable>
							);
						}
						return (
							<View key={`unresolved-${link.targetTitle}`} style={styles.linkRow}>
								<Ionicons name="help-circle-outline" size={15} color={colors.textGhost} />
								<Text style={[styles.linkTitle, styles.unresolved]} numberOfLines={1}>
									{label}
								</Text>
								{creatingTarget === link.targetTitle ? (
									<ActivityIndicator size="small" color={colors.accent} />
								) : (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`Create the note ${label}`}
										hitSlop={6}
										onPress={() => void createAndOpen(link.targetTitle)}
									>
										<Text style={styles.createLabel}>Create</Text>
									</Pressable>
								)}
							</View>
						);
					})
				)}

				<Text style={styles.sectionTitle}>Linked mentions ({backlinks.length})</Text>
				{linksError || (linksLoading && !links) ? null : backlinks.length === 0 ? (
					<Text style={styles.hint}>No other note links here yet.</Text>
				) : (
					backlinks.map((backlink) => (
						<Pressable
							key={backlink.noteId}
							accessibilityRole="button"
							accessibilityLabel={`Open ${backlink.title}`}
							onPress={() => openNote(backlink.noteId)}
							style={({ pressed }) => [styles.mentionRow, pressed && styles.aliasPressed]}
						>
							<Text style={styles.mentionTitle} numberOfLines={1}>
								{backlink.title || "Untitled Note"}
							</Text>
							<Text style={styles.mentionSnippet} numberOfLines={2}>
								{backlink.snippet}
							</Text>
							<Text style={styles.mentionMeta}>{relativeTime(backlink.updatedAt)}</Text>
						</Pressable>
					))
				)}
			</ScrollView>
		</BottomSheet>
	);
}

function StatRow({
	label,
	value,
	styles,
}: {
	label: string;
	value: string;
	styles: ReturnType<typeof createStyles>;
}) {
	return (
		<View style={styles.statRow}>
			<Text style={styles.statLabel}>{label}</Text>
			<Text style={styles.statValue} numberOfLines={1}>
				{value}
			</Text>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		scroll: { flex: 1 },
		scrollContent: { paddingBottom: spacing.xl },

		sectionTitle: {
			color: c.text,
			fontSize: 13,
			fontWeight: "700",
			letterSpacing: 0.4,
			textTransform: "uppercase",
			marginTop: spacing.md,
			marginBottom: spacing.sm,
		},
		fieldLabel: {
			...typography.meta,
			color: c.textFaint,
			fontWeight: "600",
			marginTop: spacing.lg,
			marginBottom: spacing.sm,
		},
		hint: { ...typography.support, color: c.textGhost },
		loader: { alignSelf: "flex-start", marginVertical: spacing.md },
		divider: {
			height: StyleSheet.hairlineWidth,
			backgroundColor: c.border,
			marginTop: spacing.xl,
		},

		statBox: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.xs,
		},
		statRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
			paddingVertical: 7,
		},
		statLabel: { color: c.textFaint, fontSize: 13 },
		statValue: { color: c.textSecondary, fontSize: 13, flexShrink: 1 },

		aliasRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		alias: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingLeft: spacing.md,
			paddingRight: spacing.sm,
			paddingVertical: 6,
			borderRadius: radius.full,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
		},
		aliasPressed: { backgroundColor: c.surfacePressed },
		aliasLabel: { ...typography.support, color: c.textSecondary, maxWidth: 190 },

		inlineForm: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
		inputFill: { flex: 1 },
		input: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 10,
			color: c.text,
			fontSize: 14,
		},
		addButton: {
			paddingHorizontal: spacing.lg,
			paddingVertical: 11,
			borderRadius: radius.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		addButtonLabel: { color: c.accent, fontSize: 13, fontWeight: "600" },
		dimmed: { opacity: 0.4 },

		propertyRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: spacing.sm,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
		},
		propertyBody: { flex: 1, minWidth: 0 },
		propertyKey: { ...typography.meta, color: c.textFaint, fontWeight: "600" },
		propertyValue: { color: c.textSecondary, fontSize: 14, marginTop: 1 },

		draftBox: {
			gap: spacing.sm,
			marginTop: spacing.md,
			padding: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		draftActions: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.xl,
			paddingTop: spacing.xs,
		},
		saveLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		cancelLabel: { color: c.textFaint, fontSize: 14 },

		addProperty: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.md,
			paddingVertical: 10,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		addPropertyLabel: { color: c.textFaint, fontSize: 13.5 },

		errorBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.md,
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
		},
		errorText: { ...typography.support, flex: 1, color: c.danger },
		errorRetry: { ...typography.support, color: c.danger, fontWeight: "600" },

		linkRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: 11,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		linkTitle: { flex: 1, color: c.textSecondary, fontSize: 14 },
		unresolved: { color: c.textGhost, fontStyle: "italic" },
		createLabel: { ...typography.support, color: c.accent, fontWeight: "600" },

		mentionRow: {
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		mentionTitle: { color: c.textSecondary, fontSize: 14 },
		mentionSnippet: { ...typography.support, color: c.textFaint, marginTop: 2 },
		mentionMeta: { ...typography.meta, color: c.textGhost, marginTop: 3 },
	});

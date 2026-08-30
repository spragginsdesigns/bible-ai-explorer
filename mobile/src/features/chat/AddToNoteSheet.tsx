import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { useRouter } from "expo-router";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { fetchNotes } from "@/features/notes/api";
import { BottomSheet } from "@/features/notes/components/primitives";
import type { NoteApiResponse } from "@/features/notes/types";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { relativeTime } from "@/features/notes/utils";
import {
	appendAnswerToNote,
	filterNotesByQuery,
	type AppendToNoteResult,
} from "./addToNote";

const SEARCH_DEBOUNCE_MS = 300;
const NEW_NOTE_KEY = "new";

/** Where a tap is aimed: the "New note" row (null) or an existing note. */
interface SaveTarget {
	key: string;
	noteId: string | null;
}

interface AddToNoteSheetProps {
	visible: boolean;
	/** The assistant message's cleaned markdown (follow-up lines already stripped). */
	markdown: string;
	/** Default title for the create path — the active conversation title. */
	defaultTitle?: string;
	onClose: () => void;
}

export function AddToNoteSheet({ visible, markdown, defaultTitle, onClose }: AddToNoteSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();

	const [notes, setNotes] = useState<NoteApiResponse[]>([]);
	const [listLoading, setListLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saved, setSaved] = useState<AppendToNoteResult | null>(null);
	const lastTarget = useRef<SaveTarget | null>(null);

	const loadNotes = useCallback(async () => {
		setListLoading(true);
		setListError(null);
		try {
			setNotes(await fetchNotes(getToken));
		} catch (error) {
			setListError(error instanceof Error ? error.message : "Could not load your notes.");
		} finally {
			setListLoading(false);
		}
	}, [getToken]);

	// Fresh state + notes every time the sheet opens.
	useEffect(() => {
		if (!visible) return;
		setQuery("");
		setDebouncedQuery("");
		setPendingKey(null);
		setSaveError(null);
		setSaved(null);
		void loadNotes();
	}, [visible, loadNotes]);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query]);

	const filtered = useMemo(
		() => filterNotesByQuery(notes, debouncedQuery),
		[notes, debouncedQuery]
	);

	const save = useCallback(
		async (target: SaveTarget) => {
			if (pendingKey) return;
			lastTarget.current = target;
			setPendingKey(target.key);
			setSaveError(null);
			try {
				const title = defaultTitle?.trim();
				const result = await appendAnswerToNote(getToken, {
					markdown,
					noteId: target.noteId,
					...(target.noteId === null && title ? { title } : {}),
				});
				setSaved(result);
			} catch (error) {
				setSaveError(error instanceof Error ? error.message : "Could not save to the note.");
			} finally {
				setPendingKey(null);
			}
		},
		[defaultTitle, getToken, markdown, pendingKey]
	);

	const retrySave = useCallback(() => {
		if (lastTarget.current) void save(lastTarget.current);
	}, [save]);

	const openSavedNote = useCallback(() => {
		if (!saved) return;
		onClose();
		router.push(`/notes/${saved.noteId}`);
	}, [onClose, router, saved]);

	const saving = pendingKey !== null;

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Add to notes" heightRatio={0.75}>
			{saved ? (
				<Pressable
					accessibilityRole="button"
					onPress={openSavedNote}
					style={({ pressed }) => [
						styles.successCard,
						pressed && { backgroundColor: colors.accentPressed },
					]}
				>
					<Text style={styles.successGlyph}>✓</Text>
					<Text style={styles.successLabel} numberOfLines={2}>
						{saved.created ? "Created " : "Added to "}
						<Text style={styles.successTitle}>{saved.noteTitle}</Text>
					</Text>
					<Text style={styles.successChevron}>›</Text>
				</Pressable>
			) : (
				<>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Create a new note with this answer"
						disabled={saving}
						onPress={() => void save({ key: NEW_NOTE_KEY, noteId: null })}
						style={({ pressed }) => [
							styles.newNote,
							pressed && !saving && { backgroundColor: colors.accentPressed },
							saving && styles.dimmed,
						]}
					>
						{pendingKey === NEW_NOTE_KEY ? (
							<ActivityIndicator size="small" color={colors.accent} />
						) : (
							<Text style={styles.newNoteGlyph}>＋</Text>
						)}
						<Text style={styles.newNoteLabel}>New note</Text>
					</Pressable>

					<TextInput
						value={query}
						onChangeText={setQuery}
						placeholder="Search your notes"
						placeholderTextColor={colors.textGhost}
						autoCapitalize="none"
						autoCorrect={false}
						style={styles.search}
					/>

					{saveError ? (
						<Pressable
							accessibilityRole="button"
							onPress={retrySave}
							disabled={saving}
							style={({ pressed }) => [
								styles.errorBar,
								pressed && { backgroundColor: colors.surfacePressed },
							]}
						>
							<Text style={styles.errorText} numberOfLines={2}>
								{saveError}
							</Text>
							<Text style={styles.errorRetry}>Retry</Text>
						</Pressable>
					) : null}

					<ScrollView
						style={styles.list}
						contentContainerStyle={styles.listContent}
						keyboardShouldPersistTaps="handled"
					>
						{listLoading ? (
							<Text style={styles.empty}>Loading your notes...</Text>
						) : listError ? (
							<Pressable accessibilityRole="button" onPress={() => void loadNotes()}>
								<Text style={styles.empty}>{listError} Tap to retry.</Text>
							</Pressable>
						) : filtered.length === 0 ? (
							<Text style={styles.empty}>
								{notes.length === 0
									? "No notes yet. Start one with “New note” above."
									: "No notes match that search."}
							</Text>
						) : (
							filtered.map((note) => (
								<Pressable
									key={note.id}
									accessibilityRole="button"
									accessibilityLabel={`Append to ${note.title || "Untitled Note"}`}
									disabled={saving}
									onPress={() => void save({ key: note.id, noteId: note.id })}
									style={({ pressed }) => [
										styles.noteRow,
										pressed && !saving && styles.noteRowPressed,
										saving && pendingKey !== note.id && styles.dimmed,
									]}
								>
									<View style={styles.noteRowBody}>
										<Text style={styles.noteTitle} numberOfLines={1}>
											{note.title || "Untitled Note"}
										</Text>
										<Text style={styles.notePreview} numberOfLines={1}>
											{note.plainText.trim() || "Empty note"}
										</Text>
										<Text style={styles.noteMeta}>{relativeTime(note.updatedAt)}</Text>
									</View>
									{pendingKey === note.id ? (
										<ActivityIndicator size="small" color={colors.accent} />
									) : null}
								</Pressable>
							))
						)}
					</ScrollView>
				</>
			)}
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		newNote: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			paddingVertical: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		newNoteGlyph: { color: c.accent, fontSize: 14 },
		newNoteLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		search: {
			marginTop: spacing.md,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 10,
			color: c.text,
			fontSize: 14,
		},
		errorBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginTop: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.md,
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
		},
		errorText: { ...typography.support, flex: 1, color: c.danger },
		errorRetry: { ...typography.support, color: c.danger, fontWeight: "600" },
		list: { marginTop: spacing.md, flexGrow: 0 },
		listContent: { gap: spacing.sm, paddingBottom: spacing.sm },
		empty: {
			color: c.textFaint,
			fontSize: 13,
			lineHeight: 20,
			paddingVertical: spacing.xl,
			textAlign: "center",
		},
		noteRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		noteRowPressed: { backgroundColor: c.surfacePressed },
		noteRowBody: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
		noteTitle: { color: c.textSecondary, fontSize: 14, fontWeight: "500" },
		notePreview: { ...typography.support, marginTop: 2, color: c.textFaint },
		noteMeta: { ...typography.meta, marginTop: 2, color: c.textGhost },
		dimmed: { opacity: 0.5 },
		successCard: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginTop: spacing.sm,
			marginBottom: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
		},
		successGlyph: { color: c.accent, fontSize: 15 },
		successLabel: { flex: 1, color: c.textSecondary, fontSize: 14, lineHeight: 20 },
		successTitle: { color: c.accent, fontWeight: "600" },
		successChevron: { color: c.accent, fontSize: 18 },
	});

import React, { useCallback, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { colors, fonts, radius, spacing } from "@/theme";
import { CreateItemSheet } from "@/features/notes/components/CreateItemSheet";
import { NoteActionSheet } from "@/features/notes/components/NoteActionSheet";
import { NoteCard } from "@/features/notes/components/NoteCard";
import { Chip, GlyphButton } from "@/features/notes/components/primitives";
import type { Note } from "@/features/notes/types";
import { SORT_LABELS, nextSort, useNotesLibrary } from "@/features/notes/useNotesLibrary";

const TAB_BAR_CLEARANCE = 100;

export default function NotesListScreen() {
	const router = useRouter();
	const library = useNotesLibrary();

	const [actionNote, setActionNote] = useState<Note | null>(null);
	const [createKind, setCreateKind] = useState<"folder" | "tag" | null>(null);
	const [isCreatingNote, setIsCreatingNote] = useState(false);

	// Pick up edits made on the editor screen when coming back to the list.
	const firstFocus = useRef(true);
	useFocusEffect(
		useCallback(() => {
			if (firstFocus.current) {
				firstFocus.current = false;
				return;
			}
			void library.refresh();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [library.refresh])
	);

	const handleNewNote = async () => {
		if (isCreatingNote) return;
		setIsCreatingNote(true);
		try {
			const note = await library.createNote();
			router.push(`/notes/${note.id}`);
		} catch {
			// The error banner from the library hook covers the failure.
		} finally {
			setIsCreatingNote(false);
		}
	};

	return (
		<Screen>
			<View style={styles.header}>
				<Text style={styles.heading}>Notes</Text>
				<GlyphButton
					glyph="+"
					accessibilityLabel="New note"
					onPress={() => void handleNewNote()}
					disabled={isCreatingNote}
					active
					size={40}
				/>
			</View>

			<View style={styles.searchWrap}>
				<Text style={styles.searchGlyph}>⌕</Text>
				<TextInput
					value={library.searchQuery}
					onChangeText={library.setSearchQuery}
					placeholder="Search notes"
					placeholderTextColor={colors.textGhost}
					style={styles.searchInput}
					returnKeyType="search"
				/>
				{library.searchQuery ? (
					<GlyphButton
						glyph="✕"
						accessibilityLabel="Clear search"
						onPress={() => library.setSearchQuery("")}
						size={28}
					/>
				) : null}
			</View>

			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.chipRow}
				keyboardShouldPersistTaps="handled"
			>
				<Chip
					label="All"
					active={library.activeFolderId === null}
					onPress={() => library.setActiveFolderId(null)}
				/>
				{library.folders.map((folder) => (
					<Chip
						key={folder.id}
						label={folder.name}
						active={library.activeFolderId === folder.id}
						onPress={() =>
							library.setActiveFolderId(
								library.activeFolderId === folder.id ? null : folder.id
							)
						}
					/>
				))}
				<Chip label="＋ Folder" active={false} onPress={() => setCreateKind("folder")} />
			</ScrollView>

			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.chipRow}
				keyboardShouldPersistTaps="handled"
			>
				{library.tags.map((tag) => (
					<Chip
						key={tag.id}
						label={tag.name}
						dotColor={tag.color}
						active={library.activeTagId === tag.id}
						onPress={() =>
							library.setActiveTagId(library.activeTagId === tag.id ? null : tag.id)
						}
					/>
				))}
				<Chip label="＋ Tag" active={false} onPress={() => setCreateKind("tag")} />
			</ScrollView>

			<View style={styles.metaRow}>
				<Text style={styles.metaText}>
					{library.notes.length} {library.notes.length === 1 ? "note" : "notes"}
				</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Change sort order"
					onPress={() => library.setSortBy(nextSort(library.sortBy))}
					hitSlop={8}
				>
					<Text style={styles.metaText}>⇅  {SORT_LABELS[library.sortBy]}</Text>
				</Pressable>
			</View>

			{library.error ? <Text style={styles.error}>{library.error}</Text> : null}

			{library.isLoading ? (
				<View style={styles.loading}>
					<ActivityIndicator color={colors.accent} />
				</View>
			) : (
				<FlatList
					data={library.notes}
					keyExtractor={(note) => note.id}
					contentContainerStyle={styles.listContent}
					keyboardShouldPersistTaps="handled"
					refreshControl={
						<RefreshControl
							refreshing={library.isRefreshing}
							onRefresh={() => void library.refresh()}
							tintColor={colors.accent}
							colors={[colors.accent]}
							progressBackgroundColor={colors.bgElevated}
						/>
					}
					ItemSeparatorComponent={() => <View style={styles.separator} />}
					ListEmptyComponent={
						<View style={styles.empty}>
							<Text style={styles.emptyTitle}>
								{library.totalNotes === 0 ? "No notes yet" : "Nothing matches"}
							</Text>
							<Text style={styles.emptyBody}>
								{library.totalNotes === 0
									? "Tap + to start your first Bible study note."
									: "Try a different search or clear your filters."}
							</Text>
						</View>
					}
					renderItem={({ item }) => (
						<NoteCard
							note={item}
							tags={library.tags}
							onPress={() => router.push(`/notes/${item.id}`)}
							onLongPress={() => setActionNote(item)}
						/>
					)}
				/>
			)}

			<NoteActionSheet
				note={actionNote}
				folders={library.folders}
				onClose={() => setActionNote(null)}
				onTogglePin={(id) => void library.togglePin(id)}
				onMoveToFolder={(id, folderId) => void library.moveNoteToFolder(id, folderId)}
				onDelete={(id) => void library.deleteNote(id)}
			/>

			<CreateItemSheet
				visible={createKind !== null}
				kind={createKind ?? "folder"}
				onClose={() => setCreateKind(null)}
				onSubmit={(name, color) => {
					if (createKind === "tag") void library.createTag(name, color);
					else void library.createFolder(name);
				}}
			/>
		</Screen>
	);
}

const styles = StyleSheet.create({
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
	},
	heading: { fontFamily: fonts.brand, fontSize: 34, color: colors.text },

	searchWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.sm,
		marginHorizontal: spacing.lg,
		paddingLeft: spacing.md,
		paddingRight: 6,
		borderRadius: radius.lg,
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
	},
	searchGlyph: { color: colors.textFaint, fontSize: 16 },
	searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },

	chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },

	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.lg,
		paddingBottom: spacing.sm,
	},
	metaText: { color: colors.textFaint, fontSize: 12 },
	error: {
		color: colors.danger,
		fontSize: 12.5,
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.sm,
	},

	loading: { flex: 1, alignItems: "center", justifyContent: "center" },
	listContent: { paddingHorizontal: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE },
	separator: { height: spacing.sm },
	empty: { alignItems: "center", paddingTop: 64, gap: 6 },
	emptyTitle: { color: colors.textMuted, fontSize: 15, fontWeight: "600" },
	emptyBody: { color: colors.textGhost, fontSize: 13, textAlign: "center", paddingHorizontal: spacing.xl },
});

"use client";

import React, { useState, useRef, useCallback } from "react";
import Link from "next/link";
import AppSidebar from "@/components/AppSidebar";
import NotesSidebar from "./NotesSidebar";
import NotesSearch from "./NotesSearch";
import NotesListView from "./NotesListView";
import NoteEditorView from "./NoteEditorView";
import NotesTopBar from "./NotesTopBar";
import { useNotes } from "@/hooks/useNotes";

const SWIPE_THRESHOLD = 50;
const EDGE_ZONE = 30;

const NotesPage: React.FC = () => {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const touchStartX = useRef(0);
	const touchStartY = useRef(0);
	const isSwiping = useRef(false);

	const {
		notes,
		folders,
		tags,
		activeNote,
		activeNoteId,
		activeFolderId,
		activeTagId,
		searchQuery,
		sortBy,
		setActiveNoteId,
		setActiveFolderId,
		setActiveTagId,
		setSearchQuery,
		setSortBy,
		createNote,
		updateNote,
		deleteNote,
		togglePin,
		createFolder,
		renameFolder,
		deleteFolder,
		createTag,
		deleteTag,
		toggleNoteTag,
	} = useNotes();

	const handleTouchStart = useCallback(
		(e: React.TouchEvent) => {
			const touch = e.touches[0];
			touchStartX.current = touch.clientX;
			touchStartY.current = touch.clientY;
			isSwiping.current = touch.clientX < EDGE_ZONE || sidebarOpen;
		},
		[sidebarOpen]
	);

	const handleTouchEnd = useCallback(
		(e: React.TouchEvent) => {
			if (!isSwiping.current) return;
			const touch = e.changedTouches[0];
			const dx = touch.clientX - touchStartX.current;
			const dy = Math.abs(touch.clientY - touchStartY.current);
			if (dy > Math.abs(dx)) return;

			if (dx > SWIPE_THRESHOLD && !sidebarOpen) {
				setSidebarOpen(true);
			} else if (dx < -SWIPE_THRESHOLD && sidebarOpen) {
				setSidebarOpen(false);
			}
		},
		[sidebarOpen]
	);

	const handleCreateNote = async () => {
		await createNote();
	};

	const handleDeleteNote = async (id: string) => {
		await deleteNote(id);
	};

	// Resolving an unresolved wikilink: create the target, then open it.
	const handleCreateLinkedNote = useCallback(
		async (title: string) => {
			await createNote(null, title);
		},
		[createNote]
	);

	return (
		<div
			className="flex h-[100dvh] gradient-mesh overflow-hidden"
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
		>
			<AppSidebar
				active="notes"
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
			>
				<NotesSidebar
					folders={folders}
					tags={tags}
					activeFolderId={activeFolderId}
					activeTagId={activeTagId}
					onSelectFolder={setActiveFolderId}
					onSelectTag={setActiveTagId}
					onCreateFolder={createFolder}
					onRenameFolder={renameFolder}
					onDeleteFolder={deleteFolder}
					onCreateNote={handleCreateNote}
					onNavigate={() => setSidebarOpen(false)}
				/>
			</AppSidebar>

			<div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
				<NotesTopBar
					onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
					onNewNote={handleCreateNote}
				/>

				{activeNote ? (
					<NoteEditorView
						note={activeNote}
						notes={notes}
						folders={folders}
						tags={tags}
						onBack={() => setActiveNoteId(null)}
						onUpdate={updateNote}
						onDelete={handleDeleteNote}
						onTogglePin={togglePin}
						onToggleTag={toggleNoteTag}
						onCreateTag={createTag}
						onDeleteTag={deleteTag}
						onOpenNote={setActiveNoteId}
						onCreateLinkedNote={handleCreateLinkedNote}
					/>
				) : (
					<>
						{/* Same back-link + centred-title header every other page
						    uses; Notes was the only screen with no title at all. */}
						<div className="mx-auto w-full max-w-5xl flex items-center gap-4 px-3 lg:px-8 pt-3 lg:pt-6">
							{/* A Link, not router.back(): Notes is a root tab reachable
							    from the bottom nav, so history-back can leave the app. */}
							<Link
								href="/"
								aria-label="Back to chat"
								className="text-control font-semibold text-amber-600 dark:text-amber-400"
							>
								‹ Back
							</Link>
							<h1 className="flex-1 truncate text-center text-control font-semibold text-neutral-900 dark:text-neutral-100">
								Notes
							</h1>
							<span className="w-11" aria-hidden />
						</div>
						<NotesSearch value={searchQuery} onChange={setSearchQuery} />
						<NotesListView
							notes={notes}
							tags={tags}
							activeNoteId={activeNoteId}
							sortBy={sortBy}
							onSelectNote={setActiveNoteId}
							onSortChange={setSortBy}
						/>
					</>
				)}
			</div>
		</div>
	);
};

export default NotesPage;

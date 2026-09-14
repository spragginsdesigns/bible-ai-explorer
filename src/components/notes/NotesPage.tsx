"use client";

import React, { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AppSidebar from "@/components/AppSidebar";
import NotesSidebar from "./NotesSidebar";
import NotesSearch from "./NotesSearch";
import NotesListView from "./NotesListView";
import NoteEditorView from "./NoteEditorView";
import NotesTopBar from "./NotesTopBar";
import NoteTemplatePicker from "./NoteTemplatePicker";
import { buildNoteTemplate, type NoteTemplateId } from "./noteTemplates";
import { useNotes } from "@/hooks/useNotes";

const SWIPE_THRESHOLD = 50;
const EDGE_ZONE = 30;

const NotesPage: React.FC = () => {
 const { user, isLoaded } = useUser();
 if (!isLoaded) return <p role="status">Loading your notes...</p>;
 if (!user) return <Link href="/sign-in">Sign in to open your notes</Link>;
 return (
 	<Suspense fallback={null}>
 		<NotesSession key={user.id} />
 	</Suspense>
 );
};
const NotesSession: React.FC = () => {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
	const [creating, setCreating] = useState(false);
 const [createError, setCreateError] = useState<string | null>(null);
 const creation = useRef(false);
 const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
		isLoading,
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

	// Deep link: /notes?note=<id> opens that note once the list has loaded.
	// Unknown or inaccessible ids simply fall back to the normal list.
	const searchParams = useSearchParams();
	const noteParam = searchParams.get("note");
	const handledNoteParam = useRef<string | null>(null);
	useEffect(() => {
		if (isLoading || !noteParam || noteParam === handledNoteParam.current) return;
		handledNoteParam.current = noteParam;
		if (notes.some((n) => n.id === noteParam)) setActiveNoteId(noteParam);
	}, [isLoading, noteParam, notes, setActiveNoteId]);

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

	const handleCreateNote = () => {
		setCreateError(null);
		setTemplatePickerOpen(true);
	};
	const handlePickTemplate = async (id: NoteTemplateId) => {
		if (creation.current) return;
		creation.current = true; setCreating(true); setCreateError(null);
		try {
			let churchName: string | null = null;
			if (id === "sermon") {
				const response = await fetch("/api/church", { cache: "no-store" });
				if (!response.ok) throw new Error("Could not load your church. Please try again.");
				const data = await response.json();
				if (data.status !== "unavailable" && typeof data.church?.name === "string") churchName = data.church.name;
			}
			if (!mounted.current) return;
			const seed = buildNoteTemplate(id, { churchName });
			await createNote(undefined, seed?.title, seed);
			if (mounted.current) setTemplatePickerOpen(false);
		} catch {
			if (mounted.current) setCreateError("Could not finish creating the note. Check your notes before trying again.");
		} finally {
			creation.current = false;
			if (mounted.current) setCreating(false);
		}
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
							folders={folders}
							activeNoteId={activeNoteId}
							sortBy={sortBy}
							onSelectNote={setActiveNoteId}
							onSortChange={setSortBy}
							onTogglePin={togglePin}
							onMoveToFolder={(id, folderId) => updateNote(id, { folderId })}
							onDeleteNote={handleDeleteNote}
						/>
					</>
				)}
			</div>
			<NoteTemplatePicker
				open={templatePickerOpen}
				onClose={() => { if (!creation.current) setTemplatePickerOpen(false); }}
                busy={creating}
                error={createError}
				onPick={(id) => void handlePickTemplate(id)}
			/>
		</div>
	);
};

export default NotesPage;

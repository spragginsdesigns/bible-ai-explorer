"use client";

import React, { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
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
const ERROR_DWELL_MS = 6000;
const NOTES_PATH = "/notes";

const noteUrl = (id: string) => `${NOTES_PATH}?note=${encodeURIComponent(id)}`;

const NotesPage: React.FC = () => {
 const { user, isLoaded } = useUser();
 if (!isLoaded) return <p role="status">Loading your notes...</p>;
 if (!user) return <Link href="/sign-in">Sign in to open your notes</Link>;
 return (
 	<Suspense fallback={null}>
 		<NotesSession key={user.id} userId={user.id} />
 	</Suspense>
 );
};
const NotesSession: React.FC<{ userId: string }> = ({ userId }) => {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
	const [creating, setCreating] = useState(false);
 const [createError, setCreateError] = useState<string | null>(null);
	const [pageError, setPageError] = useState<string | null>(null);
 const creation = useRef(false);
 const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const touchStartX = useRef(0);
	const touchStartY = useRef(0);
	const isSwiping = useRef(false);

	const {
		notes,
		allNotes,
		totalNotes,
		folders,
		tags,
		activeNote,
		activeNoteId,
		activeFolderId,
		activeTagId,
		searchQuery,
		sortBy,
		isLoading,
		hasLoaded,
		loadError,
		mutationError,
		retryLoad,
		clearMutationError,
		noteExists,
		setActiveNoteId,
		setActiveFolderId,
		setActiveTagId,
		setSearchQuery,
		setSortBy,
		createNote,
		updateNote,
		deleteNote,
		togglePin,
		moveNoteToFolder,
		createFolder,
		renameFolder,
		deleteFolder,
		createTag,
		deleteTag,
		toggleNoteTag,
	} = useNotes(userId);

	// The open note lives in the URL (/notes?note=<id>), so refresh, deep
	// links and browser back/forward all land on the same note. Opening a
	// note pushes a history entry with the native History API, which Next
	// syncs into useSearchParams without a server round trip.
	const searchParams = useSearchParams();
	const noteParam = searchParams.get("note");
	const noteParamRef = useRef(noteParam);
	noteParamRef.current = noteParam;
	/** History entries this session pushed on top of the list, for Back. */
	const pushedDepth = useRef(0);

	useEffect(() => {
		const onPopState = () => {
			pushedDepth.current = Math.max(0, pushedDepth.current - 1);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	const openNote = useCallback(
		(id: string) => {
			setActiveNoteId(id);
			if (noteParamRef.current === id) return;
			window.history.pushState(null, "", noteUrl(id));
			pushedDepth.current += 1;
		},
		[setActiveNoteId]
	);

	// Back always lands on the list, like Android's dismissTo("/notes"):
	// unwind the entries we pushed, or replace a deep-linked one.
	const closeNote = useCallback(() => {
		setActiveNoteId(null);
		if (pushedDepth.current > 0) {
			const depth = pushedDepth.current;
			pushedDepth.current = 0;
			window.history.go(-depth);
		} else if (noteParamRef.current) {
			window.history.replaceState(null, "", NOTES_PATH);
		}
	}, [setActiveNoteId]);

	// URL -> open note. An id that is not in the library (deleted, another
	// account's, or mistyped) falls back to the list once the server has
	// answered, so a stale cache cannot bounce a note that does exist.
	const syncedParam = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (noteParam && !noteExists(noteParam)) {
			if (hasLoaded) window.history.replaceState(null, "", NOTES_PATH);
			return;
		}
		if (syncedParam.current === noteParam) return;
		syncedParam.current = noteParam;
		setActiveNoteId(noteParam);
	}, [noteParam, hasLoaded, noteExists, setActiveNoteId]);

	const bannerError = mutationError ?? pageError;
	useEffect(() => {
		if (!bannerError) return;
		const timer = setTimeout(() => {
			clearMutationError();
			setPageError(null);
		}, ERROR_DWELL_MS);
		return () => clearTimeout(timer);
	}, [bannerError, clearMutationError]);

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
			const note = await createNote(undefined, seed?.title, seed);
			if (mounted.current) {
				openNote(note.id);
				setTemplatePickerOpen(false);
			}
		} catch {
			if (mounted.current) setCreateError("Could not finish creating the note. Check your notes before trying again.");
		} finally {
			creation.current = false;
			if (mounted.current) setCreating(false);
		}
	};

	const handleDeleteNote = (id: string) => {
		void deleteNote(id);
	};

	// Deleting the open note returns to the list first, as Android does; a
	// failed delete puts the note back in the list with the error showing.
	const handleDeleteOpenNote = (id: string) => {
		closeNote();
		void deleteNote(id);
	};

	// Resolving an unresolved wikilink: create the target in the source note's
	// folder (Android's createLinkedNote keeps a linked pair filed together),
	// then open it.
	const activeFolderOfNote = activeNote?.folderId ?? null;
	const handleCreateLinkedNote = useCallback(
		async (title: string) => {
			try {
				const note = await createNote(activeFolderOfNote, title);
				openNote(note.id);
			} catch {
				setPageError("The note could not be created.");
			}
		},
		[createNote, openNote, activeFolderOfNote]
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
					onCreateFolder={(name) => {
						createFolder(name).catch(() => setPageError("The folder could not be created."));
					}}
					onRenameFolder={renameFolder}
					onDeleteFolder={deleteFolder}
					onCreateTag={createTag}
					onCreateNote={handleCreateNote}
					onNavigate={() => setSidebarOpen(false)}
				/>
			</AppSidebar>

			<div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
				<NotesTopBar
					onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
					onNewNote={handleCreateNote}
				/>

				{bannerError && (
					<div role="alert" className="mx-auto w-full max-w-5xl px-3 lg:px-8 pt-2">
						<div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
							<p className="flex-1 text-xs text-red-600 dark:text-red-400">{bannerError}</p>
							<button
								type="button"
								onClick={() => {
									clearMutationError();
									setPageError(null);
								}}
								aria-label="Dismiss"
								className="text-red-500/70 hover:text-red-500 dark:text-red-400/70 dark:hover:text-red-400 transition-colors"
							>
								<X className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>
				)}

				{activeNote ? (
					<NoteEditorView
						note={activeNote}
						notes={allNotes}
						folders={folders}
						tags={tags}
						onBack={closeNote}
						onUpdate={updateNote}
						onDelete={handleDeleteOpenNote}
						onTogglePin={togglePin}
						onToggleTag={toggleNoteTag}
						onCreateTag={(name, color) => {
							createTag(name, color).catch(() => setPageError("The tag could not be created."));
						}}
						onDeleteTag={deleteTag}
						onOpenNote={openNote}
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
							totalNotes={totalNotes}
							tags={tags}
							folders={folders}
							activeNoteId={activeNoteId}
							activeFolderId={activeFolderId}
							activeTagId={activeTagId}
							sortBy={sortBy}
							isLoading={isLoading}
							loadError={loadError}
							onRetry={retryLoad}
							onSelectNote={openNote}
							onSortChange={setSortBy}
							onTogglePin={(id) => void togglePin(id)}
							onMoveToFolder={(id, folderId) => void moveNoteToFolder(id, folderId)}
							onDeleteNote={handleDeleteNote}
							onSelectFolder={setActiveFolderId}
							onSelectTag={setActiveTagId}
							onCreateFolder={createFolder}
							onCreateTag={createTag}
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

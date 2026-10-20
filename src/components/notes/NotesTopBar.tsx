"use client";

import { FilePlus, Menu } from "lucide-react";
import AppOptions from "../AppOptions";

/** Folder history remains in the drawer; shared options keep the header calm. */
export default function NotesTopBar({ onToggleSidebar, onNewNote }: { onToggleSidebar: () => void; onNewNote: () => void }) {
  return <header className="glass relative z-30 flex min-h-16 shrink-0 items-center gap-2 border-b border-black/[.08] px-4 dark:border-white/[.06] lg:hidden">
    <button type="button" onClick={onToggleSidebar} aria-label="Open note folders and sidebar" className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5"><Menu size={22} aria-hidden /></button>
    <span className="flex-1 text-lg font-bold">Notes</span>
    <button type="button" onClick={onNewNote} aria-label="New note" className="flex h-12 w-12 items-center justify-center rounded-full text-amber-800 hover:bg-black/5 dark:text-amber-300 dark:hover:bg-white/5"><FilePlus size={22} aria-hidden /></button>
    <AppOptions />
  </header>;
}

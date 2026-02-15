"use client";

import React from "react";
import Link from "next/link";
import { Menu, FilePlus, MessageSquare, BookOpen } from "lucide-react";

interface NotesTopBarProps {
	onToggleSidebar: () => void;
	onNewNote: () => void;
}

const NotesTopBar: React.FC<NotesTopBarProps> = ({ onToggleSidebar, onNewNote }) => {
	return (
		<div className="h-14 flex items-center justify-between px-4 border-b border-white/[0.06] glass flex-shrink-0">
			<div className="flex items-center gap-1 min-w-0">
				<button
					onClick={onToggleSidebar}
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<Menu className="w-5 h-5" />
				</button>

				{/* Navigation tabs */}
				<nav className="flex items-center gap-1 ml-1">
					<Link
						href="/"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03] transition-colors"
					>
						<MessageSquare className="w-3.5 h-3.5" />
						Chat
					</Link>
					<Link
						href="/notes"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-amber-400 bg-white/[0.04] border-b-2 border-amber-400 transition-colors"
					>
						<BookOpen className="w-3.5 h-3.5" />
						Notes
					</Link>
				</nav>
			</div>
			<div className="flex items-center gap-0">
				<button
					onClick={onNewNote}
					title="New Note"
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2"
				>
					<FilePlus className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
};

export default NotesTopBar;

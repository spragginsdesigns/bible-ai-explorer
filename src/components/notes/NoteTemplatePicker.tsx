"use client";

import React, { useEffect } from "react";
import { BookOpen, Church, HeartHandshake, FileText, X } from "lucide-react";
import { NOTE_TEMPLATE_OPTIONS, type NoteTemplateId } from "./noteTemplates";

const TEMPLATE_ICONS: Record<NoteTemplateId, React.ReactNode> = {
	"verse-study": <BookOpen className="w-4 h-4" />,
	sermon: <Church className="w-4 h-4" />,
	prayer: <HeartHandshake className="w-4 h-4" />,
	blank: <FileText className="w-4 h-4" />,
};

interface NoteTemplatePickerProps {
	open: boolean;
	onClose: () => void;
	onPick: (id: NoteTemplateId) => void;
}

/**
 * B7: the four ways a note can start, shown instead of opening a blank page.
 * Escape and the backdrop close without creating anything.
 */
const NoteTemplatePicker: React.FC<NoteTemplatePickerProps> = ({ open, onClose, onPick }) => {
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Choose how to start your note"
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-neutral-900 p-4 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between pb-3">
					<h2 className="text-control font-semibold text-neutral-900 dark:text-neutral-100">
						Start a note
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="flex flex-col gap-1.5">
					{NOTE_TEMPLATE_OPTIONS.map((option) => (
						<button
							key={option.id}
							onClick={() => onPick(option.id)}
							className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-left border border-transparent hover:border-amber-600/30 dark:hover:border-amber-400/30 hover:bg-amber-500/[0.06] dark:hover:bg-amber-400/[0.06] transition-colors"
						>
							<span className="mt-0.5 text-amber-600 dark:text-amber-400">
								{TEMPLATE_ICONS[option.id]}
							</span>
							<span>
								<span className="block text-control font-medium text-neutral-900 dark:text-neutral-100">
									{option.label}
								</span>
								<span className="block text-metadata text-neutral-500 dark:text-neutral-500">
									{option.description}
								</span>
							</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
};

export default NoteTemplatePicker;

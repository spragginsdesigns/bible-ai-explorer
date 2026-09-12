"use client";

import React, { useEffect, useRef } from "react";
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
 busy?: boolean;
 error?: string | null;
}

/**
 * B7: the four ways a note can start, shown instead of opening a blank page.
 * Escape and the backdrop close without creating anything.
 */
const NoteTemplatePicker: React.FC<NoteTemplatePickerProps> = ({ open, onClose, onPick, busy = false, error }) => {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const dialog = dialogRef.current;
		if (!dialog) return;
		const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
			'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
		)).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
		(controls()[0] ?? dialog).focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			event.preventDefault();
			const available = controls();
			if (!available.length) {
				dialog.focus();
				return;
			}
			const index = available.indexOf(document.activeElement as HTMLElement);
			const next = index < 0
				? (event.shiftKey ? available.length - 1 : 0)
				: (index + (event.shiftKey ? -1 : 1) + available.length) % available.length;
			available[next].focus();
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			if (trigger?.isConnected) trigger.focus();
		};
	}, [open]);

	useEffect(() => {
		// A disabled button cannot retain keyboard focus while creation runs.
		if (open && busy) dialogRef.current?.focus();
	}, [open, busy]);

	if (!open) return null;

	return (
		<div
			ref={dialogRef}
            tabIndex={-1}
            role="dialog"
			aria-modal="true"
			aria-label="Choose how to start your note"
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
			onClick={busy ? undefined : onClose}
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
						onClick={busy ? undefined : onClose}
						aria-label="Close"
                        disabled={busy}
						className="min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				{error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
                {busy && <p role="status" className="mb-3 text-sm">Creating your note...</p>}
                <div className="flex flex-col gap-1.5">
					{NOTE_TEMPLATE_OPTIONS.map((option) => (
						<button
							key={option.id}
                            disabled={busy}
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

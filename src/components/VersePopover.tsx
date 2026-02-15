"use client";

import React, { useState, useRef, useEffect } from "react";
import { BookOpen, X, Loader2 } from "lucide-react";

interface VersePopoverProps {
	reference: string;
	children: React.ReactNode;
}

interface VerseData {
	reference: string;
	text: string;
	translation: string;
}

const VersePopover: React.FC<VersePopoverProps> = ({ reference, children }) => {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [verseData, setVerseData] = useState<VerseData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const popoverRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [open]);

	const fetchVerse = async () => {
		if (verseData) {
			setOpen(!open);
			return;
		}

		setOpen(true);
		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/get-verse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reference }),
			});

			if (!res.ok) throw new Error("Failed to fetch verse");

			const data = await res.json();
			if (data.error || !data.text) {
				setError("Verse not found in KJV.");
			} else {
				setVerseData({
					reference: data.reference ?? reference,
					text: data.text,
					translation: data.translation ?? "King James Version",
				});
			}
		} catch {
			setError("Could not load verse. Try again.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<span className="relative inline" ref={popoverRef}>
			<button
				onClick={fetchVerse}
				className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline decoration-black/20 dark:decoration-white/20 hover:decoration-black/40 dark:hover:decoration-white/40 underline-offset-2 transition-colors cursor-pointer"
				title={`Look up ${reference} in KJV`}
			>
				{children}
			</button>
			{open && (
				<div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 max-w-[90vw] glass-card border border-black/[0.1] dark:border-white/[0.1] rounded-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-3">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-semibold">
							<BookOpen className="w-4 h-4" />
							{reference}
						</div>
						<button
							onClick={() => setOpen(false)}
							className="text-neutral-400 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					</div>
					{loading && (
						<div className="flex items-center gap-2 text-neutral-500 text-xs py-2">
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
							Loading KJV text...
						</div>
					)}
					{error && (
						<p className="text-red-500 dark:text-red-400 text-xs">{error}</p>
					)}
					{verseData && (
						<div className="max-h-48 overflow-y-auto custom-scrollbar font-[family-name:var(--font-cormorant)]">
							<p className="text-base text-neutral-700 dark:text-neutral-300 leading-relaxed italic">
								{verseData.text}
							</p>
							<p className="text-xs text-neutral-400 dark:text-neutral-600 mt-2">
								— {verseData.reference} ({verseData.translation})
							</p>
						</div>
					)}
					{/* Arrow */}
					<div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-black/[0.1] dark:border-t-white/[0.1]" />
				</div>
			)}
		</span>
	);
};

export default VersePopover;

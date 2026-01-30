"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, BookOpen, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { RetrievedVerse } from "./useChat";

interface RetrievedVersesCollapsibleProps {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}

function getConfidenceBadge(avg: number) {
	if (avg >= 0.85) {
		return {
			label: "Strong biblical match",
			icon: ShieldCheck,
			className: "text-green-400 bg-green-900/30 border-green-700/40",
		};
	}
	if (avg >= 0.7) {
		return {
			label: "Moderate match",
			icon: Shield,
			className: "text-amber-400 bg-amber-900/30 border-amber-700/40",
		};
	}
	return {
		label: "Broad topic — verify independently",
		icon: ShieldAlert,
		className: "text-red-400 bg-red-900/30 border-red-700/40",
	};
}

const RetrievedVersesCollapsible: React.FC<RetrievedVersesCollapsibleProps> = ({
	verses,
	averageSimilarity,
}) => {
	const [open, setOpen] = useState(false);
	const badge = getConfidenceBadge(averageSimilarity);
	const BadgeIcon = badge.icon;

	return (
		<div className="mt-3">
			<div className="flex items-center gap-2 flex-wrap">
				<button
					onClick={() => setOpen(!open)}
					className="flex items-center gap-1.5 text-xs text-amber-500/70 hover:text-amber-500 transition-colors"
				>
					{open ? (
						<ChevronDown className="w-3.5 h-3.5" />
					) : (
						<ChevronRight className="w-3.5 h-3.5" />
					)}
					<BookOpen className="w-3.5 h-3.5" />
					{verses.length} verse{verses.length !== 1 ? "s" : ""} retrieved from KJV database
				</button>
				<span
					className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${badge.className}`}
				>
					<BadgeIcon className="w-3 h-3" />
					{badge.label}
				</span>
			</div>
			{open && (
				<div className="mt-2 space-y-2 pl-1 border-l-2 border-amber-700/20 ml-1">
					{verses.map((verse, i) => {
						const pct = Math.round(verse.similarity * 100);
						return (
							<div key={i} className="pl-3 py-1.5">
								<div className="flex items-start gap-2">
									<BookOpen className="w-3.5 h-3.5 text-amber-500/60 mt-0.5 flex-shrink-0" />
									<div className="flex-1 min-w-0">
										<p className="text-sm text-amber-300 font-medium">
											{verse.reference}
										</p>
										<span
											className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${
												pct >= 85
													? "bg-green-900/30 text-green-400"
													: pct >= 70
														? "bg-amber-900/30 text-amber-400"
														: "bg-red-900/30 text-red-400"
											}`}
										>
											{pct}% match
										</span>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export default RetrievedVersesCollapsible;

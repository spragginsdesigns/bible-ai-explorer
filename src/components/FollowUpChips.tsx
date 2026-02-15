"use client";

import React from "react";
import { MessageCircleQuestion } from "lucide-react";

interface FollowUpChipsProps {
	questions: string[];
	onSelect: (question: string) => void;
}

const FollowUpChips: React.FC<FollowUpChipsProps> = ({ questions, onSelect }) => {
	return (
		<div className="mt-4 space-y-2">
			<p className="text-xs text-neutral-600 flex items-center gap-1">
				<MessageCircleQuestion className="w-3.5 h-3.5" />
				Continue studying:
			</p>
			<div className="flex flex-wrap gap-2">
				{questions.map((q, i) => (
					<button
						key={i}
						onClick={() => onSelect(q)}
						className="text-sm text-neutral-400 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/[0.15] rounded-full px-3 py-1.5 transition-all duration-200 text-left hover:text-neutral-200"
					>
						{q}
					</button>
				))}
			</div>
		</div>
	);
};

export default FollowUpChips;

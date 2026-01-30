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
			<p className="text-xs text-amber-500/60 flex items-center gap-1">
				<MessageCircleQuestion className="w-3.5 h-3.5" />
				Continue studying:
			</p>
			<div className="flex flex-wrap gap-2">
				{questions.map((q, i) => (
					<button
						key={i}
						onClick={() => onSelect(q)}
						className="text-sm text-amber-300 bg-amber-600/15 hover:bg-amber-600/25 border border-amber-600/30 hover:border-amber-500/50 rounded-full px-3 py-1.5 transition-colors text-left"
					>
						{q}
					</button>
				))}
			</div>
		</div>
	);
};

export default FollowUpChips;

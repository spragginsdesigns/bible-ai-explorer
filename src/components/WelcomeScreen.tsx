"use client";

import React from "react";
import { Brain } from "lucide-react";
import { commonQuestions } from "@/utils/commonQuestions";

interface WelcomeScreenProps {
	onSelectQuestion: (question: string) => void;
}

const suggestedQuestions = commonQuestions.slice(0, 6);

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSelectQuestion }) => {
	return (
		<div className="flex-1 flex items-center justify-center">
			<div className="max-w-2xl mx-auto px-4 text-center">
				<div className="mb-6">
					<div className="w-20 h-20 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-5 animate-pulse-glow">
						<Brain className="w-10 h-10 text-amber-400" />
					</div>
					<h1 className="text-5xl sm:text-7xl font-bold text-white mb-3 font-[family-name:var(--font-pirata)]">
						<span className="bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(200,160,40,0.3)]">VerseMind</span>
					</h1>
					<p className="text-neutral-500 text-sm">
						AI-powered biblical exploration. Ask anything about the Bible.
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8">
					{suggestedQuestions.map((q, i) => (
						<button
							key={i}
							onClick={() => onSelectQuestion(q)}
							className="text-left px-4 py-3 rounded-xl gradient-border glass-card text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04] transition-all duration-200 text-sm group"
						>
							<span className="group-hover:text-neutral-200 transition-colors">{q}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
};

export default WelcomeScreen;

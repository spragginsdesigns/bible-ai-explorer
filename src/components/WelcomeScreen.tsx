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
					<div className="w-16 h-16 rounded-full bg-amber-600/20 border border-amber-600/30 flex items-center justify-center mx-auto mb-4">
						<Brain className="w-8 h-8 text-amber-500" />
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold text-amber-500 mb-2">VerseMind</h1>
					<p className="text-amber-100/50 text-sm">
						AI-powered biblical exploration. Ask anything about the Bible.
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8">
					{suggestedQuestions.map((q, i) => (
						<button
							key={i}
							onClick={() => onSelectQuestion(q)}
							className="text-left px-4 py-3 rounded-xl border border-amber-700/20 bg-gray-900/50 text-amber-100/70 hover:bg-amber-600/10 hover:border-amber-600/30 hover:text-amber-100 transition-colors text-sm"
						>
							{q}
						</button>
					))}
				</div>
			</div>
		</div>
	);
};

export default WelcomeScreen;

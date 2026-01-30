import React from "react";
import { Search, Database, Brain, BookOpen } from "lucide-react";

const steps = [
	{ icon: Search, text: "Searching for relevant verses..." },
	{ icon: Database, text: "Performing vector similarity search..." },
	{ icon: Brain, text: "Generating AI response..." },
	{ icon: BookOpen, text: "Compiling biblical insights..." }
];

const LoadingAnimation: React.FC = () => (
	<div className="flex flex-col items-center mt-4 space-y-4">
		{steps.map((step, index) => (
			<div key={index} className="flex items-center space-x-2">
				<step.icon className="h-5 w-5 text-amber-500 animate-pulse" />
				<span className="text-sm text-gray-600 dark:text-gray-300 animate-fade-in">
					{step.text}
				</span>
			</div>
		))}
	</div>
);

export default LoadingAnimation;

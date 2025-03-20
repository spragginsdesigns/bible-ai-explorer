import React from "react";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Moon, Sun, Brain, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";

interface HeaderProps {
	showHistory: boolean;
	setShowHistory: (show: boolean) => void;
	onClearHistory: () => void;
}

const Header: React.FC<HeaderProps> = ({
	showHistory,
	setShowHistory,
	onClearHistory
}) => {
	const { theme, setTheme } = useTheme();

	return (
		<CardHeader className="relative z-10 px-3 sm:px-6 pb-3">
			<div className="flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0">
				<CardTitle className="text-3xl sm:text-4xl font-bold bg-gradient-to-br from-amber-400 to-amber-600 bg-clip-text text-transparent flex items-center">
					<Brain className="h-7 w-7 mr-2 text-amber-500" />
					VerseMind
				</CardTitle>

				<div className="flex space-x-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowHistory(!showHistory)}
						className={`border-amber-700/30 bg-black/50 hover:bg-amber-900/20 text-amber-400 flex items-center ${showHistory
							? "ring-1 ring-amber-500/50"
							: ""}`}
					>
						<History className="h-4 w-4 mr-1.5" />
						<span className="text-xs">History</span>
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={() => onClearHistory()}
						title="Clear History"
						className="border-amber-700/30 bg-black/50 hover:bg-amber-900/20 text-amber-400"
					>
						<Trash2 className="h-4 w-4" />
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={() => setTheme(theme === "light" ? "dark" : "light")}
						className="border-amber-700/30 bg-black/50 hover:bg-amber-900/20 text-amber-400"
					>
						{theme === "light"
							? <Moon className="h-4 w-4" />
							: <Sun className="h-4 w-4" />}
					</Button>
				</div>
			</div>

			<CardDescription className="mt-3 text-amber-100/70 text-center sm:text-left sm:pl-1">
				<span className="italic">
					Illuminating biblical wisdom through AI-powered exploration
				</span>
			</CardDescription>

			{/* Gold gradient divider */}
			<div className="h-px w-full bg-gradient-to-r from-transparent via-amber-600/50 to-transparent mt-4" />
		</CardHeader>
	);
};

export default Header;

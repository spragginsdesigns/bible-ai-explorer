import React from "react";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Moon, Sun, Book, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";

interface HeaderProps {
	showHistory: boolean;
	setShowHistory: (show: boolean) => void;
}

const Header: React.FC<HeaderProps> = ({ showHistory, setShowHistory }) => {
	const { theme, setTheme } = useTheme();

	return (
		<CardHeader>
			<div className="flex justify-between items-center">
				<CardTitle className="text-2xl font-bold text-gray-800 dark:text-gray-100">
					Bible AI Explorer
				</CardTitle>
				<div className="flex space-x-2">
					<Button
						variant="outline"
						size="icon"
						onClick={() => setShowHistory(!showHistory)}
					>
						<Book className="h-5 w-5" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						onClick={() => setTheme(theme === "light" ? "dark" : "light")}
					>
						{theme === "light" ? (
							<Moon className="h-5 w-5" />
						) : (
							<Sun className="h-5 w-5" />
						)}
					</Button>
				</div>
			</div>
			<CardDescription className="flex items-center justify-center space-x-4 text-gray-600 dark:text-gray-300">
				<div className="flex items-center space-x-2">
					<Brain className="h-5 w-5 text-green-500" />
					<span>Ask questions about the Bible</span>
				</div>
			</CardDescription>
		</CardHeader>
	);
};

export default Header;

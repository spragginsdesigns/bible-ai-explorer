"use client";

import React from "react";
import { Menu, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

interface ChatTopBarProps {
	title: string;
	onToggleSidebar: () => void;
}

const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar }) => {
	const { theme, setTheme } = useTheme();

	return (
		<div className="h-14 flex items-center justify-between px-4 border-b border-amber-700/20 bg-black/60 backdrop-blur-sm flex-shrink-0">
			<div className="flex items-center gap-3 min-w-0">
				<button
					onClick={onToggleSidebar}
					className="text-amber-100/60 hover:text-amber-100 transition-colors"
				>
					<Menu className="w-5 h-5" />
				</button>
				<h1 className="text-amber-100/80 text-sm font-medium truncate">
					{title}
				</h1>
			</div>
			<button
				onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
				className="text-amber-100/60 hover:text-amber-100 transition-colors"
			>
				{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
			</button>
		</div>
	);
};

export default ChatTopBar;

"use client";

import React from "react";
import { Menu, Sun, Moon, SquarePen } from "lucide-react";
import { useTheme } from "next-themes";

interface ChatTopBarProps {
	title: string;
	onToggleSidebar: () => void;
	onNewChat: () => void;
}

const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar, onNewChat }) => {
	const { theme, setTheme } = useTheme();

	return (
		<div className="h-14 flex items-center justify-between px-4 border-b border-white/[0.06] glass flex-shrink-0">
			<div className="flex items-center gap-1 min-w-0">
				<button
					onClick={onToggleSidebar}
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<Menu className="w-5 h-5" />
				</button>
				<h1 className="text-neutral-400 text-sm font-medium truncate">
					{title}
				</h1>
			</div>
			<div className="flex items-center gap-0">
				<button
					onClick={onNewChat}
					title="New Chat"
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<SquarePen className="w-4 h-4" />
				</button>
				<button
					onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
					className="text-neutral-500 hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2"
				>
					{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
				</button>
			</div>
		</div>
	);
};

export default ChatTopBar;

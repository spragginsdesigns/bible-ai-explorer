import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatHistoryProps {
	showHistory: boolean;
	history: Array<{
		id: string;
		question: string;
		answer: string;
		selected: boolean;
	}>;
	selectHistoryItem: (id: string) => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
	showHistory,
	history,
	selectHistoryItem
}) => {
	if (!showHistory) return null;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0, height: 0 }}
				animate={{ opacity: 1, height: "auto" }}
				exit={{ opacity: 0, height: 0 }}
				className="bg-gray-100 dark:bg-gray-700 rounded-md p-4 max-h-60 overflow-y-auto"
			>
				<h3 className="text-lg font-semibold mb-2">Chat History</h3>
				{history.map((item) => (
					<div
						key={item.id}
						className={`mb-2 p-2 rounded cursor-pointer ${
							item.selected ? "bg-blue-100 dark:bg-blue-900" : ""
						}`}
						onClick={() => selectHistoryItem(item.id)}
					>
						<p className="font-medium">{item.question}</p>
						<p className="text-sm text-gray-600 dark:text-gray-400">
							{item.answer.substring(0, 100)}...
						</p>
					</div>
				))}
			</motion.div>
		</AnimatePresence>
	);
};

export default ChatHistory;

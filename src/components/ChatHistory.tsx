import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, MessageSquare } from "lucide-react";

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
				transition={{ duration: 0.3, ease: "easeInOut" }}
				className="bg-gradient-to-br from-black to-gray-900 rounded-md p-3 sm:p-4 max-h-72 overflow-y-auto border border-amber-700/30 shadow-inner"
			>
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center">
						<Clock className="h-4 w-4 text-amber-500 mr-2" />
						<h3 className="text-lg font-semibold text-amber-500">
							Chat History
						</h3>
					</div>
					<span className="text-amber-400/60 text-xs">
						{history.length} conversations
					</span>
				</div>

				{history.length === 0
					? <div className="text-center py-4 text-amber-100/50 italic">
							No conversation history yet
						</div>
					: <div className="space-y-2">
							{history.map(item =>
								<div
									key={item.id}
									className={`p-3 rounded-md cursor-pointer transition-all duration-200
									${item.selected
										? "bg-amber-900/30 border border-amber-600/40"
										: "bg-black/40 border border-amber-700/10 hover:border-amber-700/30"}`}
									onClick={() => selectHistoryItem(item.id)}
								>
									<div className="flex items-start space-x-2">
										<MessageSquare
											className={`h-4 w-4 mt-1 flex-shrink-0 ${item.selected
												? "text-amber-500"
												: "text-amber-600/50"}`}
										/>
										<div className="flex-grow">
											<p
												className={`font-medium text-sm ${item.selected
													? "text-amber-300"
													: "text-amber-100/80"}`}
											>
												{item.question}
											</p>
											<p
												className={`text-xs line-clamp-2 mt-1 ${item.selected
													? "text-amber-100/70"
													: "text-amber-100/40"}`}
											>
												{item.answer.substring(0, 120)}...
											</p>
										</div>
									</div>
								</div>
							)}
						</div>}
			</motion.div>
		</AnimatePresence>
	);
};

export default ChatHistory;

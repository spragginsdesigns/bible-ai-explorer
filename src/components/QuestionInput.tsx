import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

interface QuestionInputProps {
	query: string;
	setQuery: (query: string) => void;
	handleSubmit: (e: React.FormEvent) => void;
	loading: boolean;
	isTyping: boolean;
}

const QuestionInput: React.FC<QuestionInputProps> = ({
	query,
	setQuery,
	handleSubmit,
	loading,
	isTyping
}) => {
	return (
		<form
			onSubmit={handleSubmit}
			className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mb-4 mt-1"
		>
			<div className="relative flex-grow">
				<Input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Ask a question about the Bible..."
					className="flex-grow bg-black/50 border-amber-700/30 text-amber-100 placeholder:text-amber-100/40
                    focus-visible:ring-amber-500/40 focus-visible:border-amber-600/40 py-6 pl-4 pr-12 rounded-lg shadow-inner"
					disabled={loading || isTyping}
				/>
				{isTyping && (
					<div className="absolute right-3 top-1/2 transform -translate-y-1/2">
						<div className="animate-pulse text-amber-500/70 flex items-center">
							<span className="animate-bounce mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"></span>
							<span className="animate-bounce animation-delay-200 mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"></span>
							<span className="animate-bounce animation-delay-500 mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"></span>
						</div>
					</div>
				)}
			</div>

			<Button
				type="submit"
				disabled={loading || isTyping || !query.trim()}
				className="bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600
                text-black font-medium flex items-center justify-center py-6 px-5 rounded-lg shadow-md
                disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-w-24"
			>
				{loading ? (
					<>
						<Loader2 className="h-4 w-4 mr-2 animate-spin" />
						Processing...
					</>
				) : isTyping ? (
					<>
						<Loader2 className="h-4 w-4 mr-2 animate-spin" />
						Typing...
					</>
				) : (
					<>
						Ask <Send className="h-4 w-4 ml-2" />
					</>
				)}
			</Button>
		</form>
	);
};

export default QuestionInput;

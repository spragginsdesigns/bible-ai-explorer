import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
			className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2"
		>
			<Input
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Ask a question about the Bible..."
				className="flex-grow"
				disabled={loading || isTyping}
			/>
			<Button type="submit" disabled={loading || isTyping || !query.trim()}>
				{loading ? "Loading..." : isTyping ? "Typing..." : "Ask"}
			</Button>
		</form>
	);
};

export default QuestionInput;

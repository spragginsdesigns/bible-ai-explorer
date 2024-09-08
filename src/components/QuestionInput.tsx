import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import Autosuggest from "react-autosuggest";
import { commonQuestions } from "../utils/commonQuestions";

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
	const [suggestions, setSuggestions] = useState<string[]>([]);

	const getSuggestions = (value: string) => {
		const inputValue = value.trim().toLowerCase();
		const inputLength = inputValue.length;

		return inputLength === 0
			? []
			: commonQuestions.filter(
					(question) =>
						question.toLowerCase().slice(0, inputLength) === inputValue
			  );
	};

	const onSuggestionsFetchRequested = useCallback(
		({ value }: { value: string }) => {
			setSuggestions(getSuggestions(value));
		},
		[]
	);

	const onSuggestionsClearRequested = useCallback(() => {
		setSuggestions([]);
	}, []);

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="relative">
				<Autosuggest
					suggestions={suggestions}
					onSuggestionsFetchRequested={onSuggestionsFetchRequested}
					onSuggestionsClearRequested={onSuggestionsClearRequested}
					getSuggestionValue={(suggestion) => suggestion}
					renderSuggestion={(suggestion) => <div>{suggestion}</div>}
					inputProps={{
						placeholder: "Ask a question about the Bible...",
						value: query,
						onChange: (_, { newValue }) => setQuery(newValue),
						className:
							"w-full bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 p-2 rounded-md pr-10"
					}}
					theme={{
						container: "relative",
						suggestionsContainer:
							"absolute z-10 w-full bg-white dark:bg-gray-700 shadow-lg rounded-md mt-1",
						suggestionsList: "list-none p-0 m-0",
						suggestion:
							"p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
					}}
					alwaysRenderSuggestions={false}
				/>
				{query && (
					<button
						type="button"
						onClick={() => setQuery("")}
						className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-100"
					>
						<X className="h-5 w-5" />
					</button>
				)}
			</div>
			<Button
				type="submit"
				className="w-full bg-blue-500 hover:bg-blue-600 text-white transition-colors duration-200"
				disabled={loading || isTyping}
			>
				<Search className="h-5 w-5 mr-2" />
				Ask Question
			</Button>
		</form>
	);
};

export default QuestionInput;

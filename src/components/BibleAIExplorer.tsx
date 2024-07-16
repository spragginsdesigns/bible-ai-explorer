"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	CardFooter
} from "@/components/ui/card";
import { Moon, Sun, Book, Brain, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import Autosuggest from "react-autosuggest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LoadingAnimation = () => (
	<div className="flex flex-col items-center mt-2">
		<div className="text-sm mb-2">Referencing Scripture...</div>
		<div className="relative w-16 h-16">
			<div className="absolute inset-0 animate-page-turn">
				<svg viewBox="0 0 24 24" className="w-full h-full">
					<path
						fill="currentColor"
						d="M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v16h12V4H6z"
					/>
					<path
						fill="currentColor"
						className="animate-page-content"
						d="M8 6h8v2H8V6zm0 4h8v2H8v-2zm0 4h8v2H8v-2z"
					/>
				</svg>
			</div>
		</div>
	</div>
);

export const FormattedResponse = ({ response }: { response: string }) => {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	if (!isClient) {
		return null; // or a loading placeholder
	}

	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={{
				p: ({ children }) => <p className="mb-4">{children}</p>,
				strong: ({ children }) => (
					<span className="font-bold text-blue-600 dark:text-blue-400">
						{children}
					</span>
				)
			}}
		>
			{response}
		</ReactMarkdown>
	);
};

const BibleAIExplorer: React.FC = () => {
	const [query, setQuery] = useState("");
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const [isTyping, setIsTyping] = useState(false);
	const [isClient, setIsClient] = useState(false);
	const { theme, setTheme } = useTheme();

	const commonQuestions = [
		"What is the story of creation?",
		"What is the purpose of life according to the Bible?",
		"Where was Jesus born?",
		"What are the Ten Commandments?",
		"Who wrote the Book of Revelation?",
		"What is the Sermon on the Mount?",
		"How many disciples did Jesus have?",
		"What is the story of Noah's Ark?",
		"Who was Moses in the Bible?",
		"What is the Book of Psalms about?",
		"What is the significance of the Last Supper?",
		"Who was King David?",
		"What is the story of Adam and Eve?",
		"What does the Bible say about love?",
		"Who was the Apostle Paul?",
		"What is the story of Daniel in the lion's den?",
		"What is the significance of baptism in Christianity?",
		"What are the Beatitudes?",
		"What is the story of Jonah and the whale?",
		"What does the Bible say about forgiveness?"
	];

	useEffect(() => {
		setIsClient(true);
	}, []);

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

	const onSuggestionsFetchRequested = ({ value }: { value: string }) => {
		setSuggestions(getSuggestions(value));
	};

	const onSuggestionsClearRequested = () => {
		setSuggestions([]);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setResponse("");

		try {
			const response = await fetch("/api/ask-question", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ question: query })
			});

			if (!response.ok) {
				throw new Error("API response was not ok");
			}

			const data = await response.json();

			setIsTyping(true);
			let i = 0;
			const intervalId = setInterval(() => {
				setResponse(data.response.slice(0, i));
				i += 5;
				if (i > data.response.length) {
					clearInterval(intervalId);
					setIsTyping(false);
					setResponse(data.response);
				}
			}, 10);
		} catch (error) {
			console.error("Error:", error);
			setResponse("An error occurred while processing your request.");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		const smoothScroll = () => {
			const element = document.getElementById("response-card");
			if (element) {
				element.scrollIntoView({ behavior: "smooth", block: "start" });
			}
		};

		if (response && !isTyping) {
			smoothScroll();
		}
	}, [response, isTyping]);

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center overflow-hidden relative p-4">
			<Card className="w-full max-w-2xl shadow-lg backdrop-blur-sm bg-white/80 dark:bg-gray-800/80">
				<CardHeader>
					<div className="flex justify-between items-center">
						<CardTitle className="text-3xl font-bold text-gray-800 dark:text-gray-100">
							Bible AI Explorer
						</CardTitle>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setTheme(theme === "light" ? "dark" : "light")}
							className="transition-colors duration-200"
						>
							{theme === "light" ? (
								<Moon className="h-6 w-6" />
							) : (
								<Sun className="h-6 w-6" />
							)}
						</Button>
					</div>
					<CardDescription className="flex items-center justify-center space-x-4 text-gray-600 dark:text-gray-300">
						<div className="flex items-center space-x-2">
							<Book className="h-5 w-5 text-blue-500" />
							<span>Ask questions</span>
						</div>
						<div className="flex items-center space-x-2">
							<Brain className="h-5 w-5 text-green-500" />
							<span>Get AI answers</span>
						</div>
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="relative">
							<Autosuggest
								suggestions={suggestions}
								onSuggestionsFetchRequested={onSuggestionsFetchRequested}
								onSuggestionsClearRequested={onSuggestionsClearRequested}
								getSuggestionValue={(suggestion) => suggestion}
								renderSuggestion={(suggestion) => <div>{suggestion}</div>}
								inputProps={{
									placeholder: "Enter your question about the Bible...",
									value: query,
									onChange: (_, { newValue }) => setQuery(newValue),
									className:
										"w-full bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 p-2 rounded-md"
								}}
								theme={{
									container: "relative",
									suggestionsContainer:
										"absolute z-10 w-full bg-white dark:bg-gray-700 shadow-lg rounded-md mt-1",
									suggestionsList: "list-none p-0 m-0",
									suggestion:
										"p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
								}}
							/>
							<button
								type="button"
								onClick={() => setQuery("")}
								className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-200 dark:bg-gray-600 rounded-full p-1"
							>
								Clear
							</button>
						</div>
						<Button
							type="submit"
							className="w-full bg-blue-500 hover:bg-blue-600 text-white transition-colors duration-200"
							disabled={loading || isTyping}
						>
							Ask Question
						</Button>
					</form>
					{(loading || isTyping) && (
						<div className="mt-4">
							<LoadingAnimation />
						</div>
					)}
					{response && (
						<Card
							id="response-card"
							className="mt-4 animate-fadeIn bg-gray-50 dark:bg-gray-700"
						>
							<CardContent className="pt-4">
								<div className="flex items-center mb-2">
									<Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
									<h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
										AI Response
									</h3>
								</div>
								<FormattedResponse response={response} />
							</CardContent>
						</Card>
					)}
				</CardContent>
				<CardFooter className="text-center text-sm text-gray-500 dark:text-gray-400">
					Powered by Bible AI Explorer | Use with discernment and in conjunction
					with personal Bible study
				</CardFooter>
			</Card>
		</div>
	);
};

export default BibleAIExplorer;

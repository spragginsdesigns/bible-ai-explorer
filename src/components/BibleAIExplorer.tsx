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

export const FormattedResponse = ({ response }: { response: string }) => {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	if (!isClient) {
		return null; // or a loading placeholder
	}

	const paragraphs = response.split("\n\n");
	return (
		<>
			{paragraphs.map((paragraph, index) => (
				<p key={index} className="text-sm font-medium mb-4">
					<FormattedText text={paragraph} />
				</p>
			))}
		</>
	);
};

const FormattedText = ({ text }: { text: string }) => {
	const bibleReferenceRegex = /(\d?\s?[A-Za-z]+\s\d+:\d+(?:-\d+)?)/g;
	const parts = text.split(bibleReferenceRegex);

	return (
		<>
			{parts.map((part, index) =>
				part.match(bibleReferenceRegex) ? (
					<span
						key={index}
						className="font-bold text-blue-600 dark:text-blue-400"
					>
						{part}
					</span>
				) : (
					<span key={index}>{part}</span>
				)
			)}
		</>
	);
};

const BibleAIExplorer: React.FC = () => {
	const [query, setQuery] = useState("");
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const [isTyping, setIsTyping] = useState(false);
	const [isClient, setIsClient] = useState(false);
	const { theme, setTheme } = useTheme();

	useEffect(() => {
		setIsClient(true);
	}, []);

	const LoadingBible = () => (
		<div className="flex justify-center items-center">
			<svg className="animate-pulse w-16 h-16" viewBox="0 0 24 24">
				<path
					fill="currentColor"
					d="M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v16h12V4H6z"
				/>
				<path
					fill="currentColor"
					d="M8 6h8v2H8V6zm0 4h8v2H8v-2zm0 4h8v2H8v-2z"
				/>
			</svg>
		</div>
	);

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
						<div className="flex items-center space-x-2 animate-bounce">
							<Book className="h-5 w-5 text-blue-500" />
							<span>Ask questions</span>
						</div>
						<div className="flex items-center space-x-2 animate-pulse">
							<Brain className="h-5 w-5 text-green-500" />
							<span>Get AI answers</span>
						</div>
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<Input
							type="text"
							placeholder="Enter your question about the Bible..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-full bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
						/>
						<Button
							type="submit"
							className="w-full bg-blue-500 hover:bg-blue-600 text-white transition-colors duration-200"
							disabled={loading || isTyping}
						>
							{loading ? (
								<LoadingBible />
							) : isTyping ? (
								"Processing..."
							) : (
								"Ask Question"
							)}
						</Button>
					</form>
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

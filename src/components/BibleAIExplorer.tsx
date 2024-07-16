"use client";

import React, { useState } from "react";
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
import { Moon, Sun, Book, Brain } from "lucide-react";
import { useTheme } from "next-themes";
import { OpenAI } from "langchain/llms/openai";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";

const BibleAIExplorer: React.FC = () => {
	const [query, setQuery] = useState("");
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const { theme, setTheme } = useTheme();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);

		try {
			const model = new OpenAI({
				openAIApiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
				modelName: "gpt-4",
				temperature: 0.7
			});

			const template =
				"You are a knowledgeable AI assistant specializing in Biblical studies. Please answer the following question about the Bible: {question}";
			const prompt = new PromptTemplate({
				template: template,
				inputVariables: ["question"]
			});

			const chain = new LLMChain({ llm: model, prompt: prompt });
			const result = await chain.call({ question: query });

			setResponse(result.text);
		} catch (error) {
			console.error("Error:", error);
			setResponse("An error occurred while processing your request.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
			<Card className="w-full max-w-2xl shadow-lg">
				<CardHeader>
					<div className="flex justify-between items-center">
						<CardTitle className="text-3xl font-bold">
							Bible AI Explorer
						</CardTitle>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setTheme(theme === "light" ? "dark" : "light")}
						>
							{theme === "light" ? (
								<Moon className="h-6 w-6" />
							) : (
								<Sun className="h-6 w-6" />
							)}
						</Button>
					</div>
					<CardDescription className="flex items-center justify-center space-x-2">
						<Book className="h-5 w-5 text-blue-500" />
						<span>Ask questions about the Bible</span>
						<Brain className="h-5 w-5 text-green-500" />
						<span>Get AI-powered answers</span>
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<Input
							type="text"
							placeholder="Enter your question about the Bible..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-full"
						/>
						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? "Thinking..." : "Ask Question"}
						</Button>
					</form>
					{response && (
						<Card className="mt-4">
							<CardContent className="pt-4">
								<p className="text-sm font-medium">{response}</p>
							</CardContent>
						</Card>
					)}
				</CardContent>
				<CardFooter className="text-center text-sm text-gray-500">
					Powered by Bible AI Explorer
				</CardFooter>
			</Card>
		</div>
	);
};

export default BibleAIExplorer;

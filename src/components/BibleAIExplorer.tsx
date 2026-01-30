"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import ChatHistory from "./ChatHistory";
import QuestionInput from "./QuestionInput";
import SelectedConversation from "./SelectedConversation";
import { useChat } from "./useChat";
import Header from "./Header";
import Link from "next/link";
import ClientResponse from "./ClientResponse";
import TavilyResults from "./TavilyResults";

interface BibleAIExplorerProps {
	initialQuery?: string;
}

const BibleAIExplorer: React.FC<BibleAIExplorerProps> = ({
	initialQuery = ""
}) => {
	const [showHistory, setShowHistory] = useState(false);
	const [timeoutError, setTimeoutError] = useState(false);
	const {
		query,
		setQuery,
		response,
		loading,
		isStreaming,
		history,
		handleSubmit,
		selectHistoryItem,
		clearHistory,
		error: apiError,
		tavilyResults
	} = useChat(initialQuery);

	useEffect(
		() => {
			let timer: NodeJS.Timeout;
			if (loading) {
				setTimeoutError(false);
				timer = setTimeout(() => {
					setTimeoutError(true);
				}, 30000); // 30 seconds timeout
			}
			return () => clearTimeout(timer);
		},
		[loading]
	);

	useEffect(
		() => {
			if (response) {
				console.log("Final formatted response in BibleAIExplorer:", response);
			}
		},
		[response]
	);

	const error = apiError
		? apiError
		: timeoutError
			? "The request is taking longer than expected. Please wait or try again later."
			: null;

	return (
		<div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex flex-col items-center justify-center p-2 sm:p-4">
			<div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
				<div className="absolute top-[-10%] left-[-10%] right-0 bottom-0 bg-amber-500/5 rounded-full blur-3xl transform -rotate-12" />
				<div className="absolute top-[40%] right-[-5%] w-[40%] h-[40%] bg-amber-700/5 rounded-full blur-3xl" />
			</div>

			<Card className="w-full max-w-6xl shadow-2xl border border-amber-500/30 backdrop-blur-sm bg-black/90 relative overflow-hidden mb-4">
				{/* Background gradients and effects */}
				<div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-amber-700/5 rounded-lg pointer-events-none" />
				<div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-r from-amber-500/0 via-amber-500/80 to-amber-500/0" />

				<Header
					showHistory={showHistory}
					setShowHistory={setShowHistory}
					onClearHistory={clearHistory}
				/>

				<CardContent className="relative z-10 px-3 sm:px-6">
					<div className="flex flex-col space-y-4">
						<ChatHistory
							showHistory={showHistory}
							history={history}
							selectHistoryItem={selectHistoryItem}
						/>
						<SelectedConversation history={history} />
						<QuestionInput
							query={query}
							setQuery={setQuery}
							handleSubmit={handleSubmit}
							loading={loading}
							isStreaming={isStreaming}
						/>

						<div className="flex flex-col lg:flex-row space-y-4 lg:space-y-0 lg:space-x-4">
							<div className="w-full lg:w-3/5">
								<ClientResponse
									response={response}
									loading={loading || isStreaming}
									error={error}
								/>
							</div>
							<div className="w-full lg:w-2/5">
								<TavilyResults results={tavilyResults} loading={loading} />
							</div>
						</div>
					</div>
				</CardContent>

				<CardFooter className="text-center text-sm text-amber-100/60 relative z-10 px-3 sm:px-6 pb-6">
					<div className="w-full flex flex-col items-center space-y-4 text-center text-sm mt-4">
						<div className="bg-gradient-to-r from-gray-900 to-black p-4 sm:p-6 rounded-lg shadow-inner border border-amber-600/20">
							<h4 className="font-semibold text-amber-500 mb-3 text-lg">
								How VerseMind Works
							</h4>
							<p className="mb-3 text-amber-100/80">
								VerseMind utilizes advanced AI and database technologies to
								provide insightful biblical answers:
							</p>
							<ul className="list-disc list-inside text-left space-y-2 text-amber-100/70">
								<li>
									Vector database (AstraDB) storing the entire KJV Bible for
									efficient retrieval
								</li>
								<li>AI-powered similarity search to find relevant verses</li>
								<li>OpenAI Model for generating responses</li>
								<li>
									Integration with Tavily for additional context from trusted
									sources
								</li>
							</ul>
						</div>

						<div className="flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-4 pt-2 border-t border-amber-700/20 w-full">
							<p className="text-amber-100/60">
								Powered by AI Models trained on the KJV Bible. Please use with
								discernment in conjunction with personal Bible study
							</p>
							<p className="text-amber-100/60 flex items-center">
								<span className="hidden sm:inline mx-2">•</span>
								Created by{" "}
								<Link href="https://www.spragginsdesigns.com">
									<span className="text-amber-500 hover:text-amber-400 transition-colors ml-1">
										Austin Spraggins
									</span>
								</Link>{" "}
								<span className="mx-1">&</span>
								<span className="text-amber-500">Emmanuel Sanchez</span>
							</p>
						</div>
					</div>
				</CardFooter>
			</Card>
		</div>
	);
};

export default BibleAIExplorer;

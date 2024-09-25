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
		isTyping,
		history,
		handleSubmit,
		selectHistoryItem,
		clearHistory,
		error: apiError,
		tavilyResults
	} = useChat(initialQuery);

	useEffect(() => {
		let timer: NodeJS.Timeout;
		if (loading) {
			setTimeoutError(false);
			timer = setTimeout(() => {
				setTimeoutError(true);
			}, 30000); // 30 seconds timeout
		}
		return () => clearTimeout(timer);
	}, [loading]);

	useEffect(() => {
		if (response) {
			console.log("Final formatted response in BibleAIExplorer:", response);
		}
	}, [response]);

	const error = apiError
		? apiError
		: timeoutError
		? "The request is taking longer than expected. Please wait or try again later."
		: null;

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center p-4">
			<Card className="w-full max-w-6xl shadow-lg backdrop-blur-sm bg-white/80 dark:bg-gray-800/80">
				<Header
					showHistory={showHistory}
					setShowHistory={setShowHistory}
					onClearHistory={clearHistory}
				/>
				<CardContent>
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
							isTyping={isTyping}
						/>
						<div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
							<div className="w-full md:w-1/2">
								<ClientResponse
									response={response}
									loading={loading || isTyping}
									error={error}
								/>
							</div>
							<div className="w-full md:w-1/2">
								<TavilyResults results={tavilyResults} loading={loading} />
							</div>
						</div>
					</div>
				</CardContent>
				<CardFooter className="text-center text-sm text-gray-500 dark:text-gray-400">
					<div className="w-full">
						Powered by AI Models | Use with discernment and in conjunction with
						personal Bible study | Created by{" "}
						<Link href="https://www.spragginsdesigns.com">
							<span className="text-blue-500 hover:text-blue-600">
								Austin Spraggins
							</span>
						</Link>
					</div>
				</CardFooter>
			</Card>
		</div>
	);
};

export default BibleAIExplorer;

"use client";
import React, { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import ChatHistory from "./ChatHistory";
import QuestionInput from "./QuestionInput";
import SelectedConversation from "./SelectedConversation";
import LoadingAnimation from "./LoadingAnimation";
import { useChat } from "./useChat";
import Header from "./Header";
import dynamic from "next/dynamic";

const FormattedResponse = dynamic(() => import("./FormattedResponse"), {
	ssr: false
});

const BibleAIExplorer: React.FC = () => {
	const [showHistory, setShowHistory] = useState(false);
	const {
		query,
		setQuery,
		response,
		loading,
		isTyping,
		history,
		handleSubmit,
		selectHistoryItem
	} = useChat();

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center p-4">
			<Card className="w-full max-w-4xl shadow-lg backdrop-blur-sm bg-white/80 dark:bg-gray-800/80">
				<Header showHistory={showHistory} setShowHistory={setShowHistory} />
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
						{(loading || isTyping) && <LoadingAnimation />}
						{response && <FormattedResponse response={response} />}
					</div>
				</CardContent>
				<CardFooter className="text-center text-sm text-gray-500 dark:text-gray-400">
					Powered by AI Models| Use with discernment and in conjunction with
					personal Bible study
				</CardFooter>
			</Card>
		</div>
	);
};

export default BibleAIExplorer;

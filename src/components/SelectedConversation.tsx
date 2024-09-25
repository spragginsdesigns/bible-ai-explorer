import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import FormattedResponse from "./FormattedResponse";

interface SelectedConversationProps {
	history: Array<{
		id: string;
		question: string;
		answer: string;
		selected: boolean;
	}>;
}

const SelectedConversation: React.FC<SelectedConversationProps> = ({
	history
}) => {
	const selectedItem = history.find(item => item.selected);

	if (!selectedItem) return null;

	return (
		<Card className="mt-4 bg-gray-50 dark:bg-gray-700">
			<CardContent className="pt-4">
				<h3 className="text-lg font-semibold mb-2">Selected Conversation</h3>
				<p className="font-medium">
					{selectedItem.question}
				</p>
				<FormattedResponse response={selectedItem.answer} />
			</CardContent>
		</Card>
	);
};

export default SelectedConversation;

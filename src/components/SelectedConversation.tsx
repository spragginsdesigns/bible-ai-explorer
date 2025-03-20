import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import FormattedResponse from "./FormattedResponse";
import { MessageCircle } from "lucide-react";

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
		<Card className="bg-black/80 border border-amber-600/30 shadow-lg">
			<CardContent className="pt-4">
				<div className="flex items-center mb-3 pb-2 border-b border-amber-700/20">
					<MessageCircle className="h-5 w-5 text-amber-500 mr-2" />
					<h3 className="text-lg font-semibold text-amber-500">
						Selected Conversation
					</h3>
				</div>

				<div className="bg-amber-900/10 p-3 rounded-md border-l-2 border-amber-500/50 mb-4">
					<p className="font-medium text-amber-200">
						{selectedItem.question}
					</p>
				</div>

				<FormattedResponse response={selectedItem.answer} />
			</CardContent>
		</Card>
	);
};

export default SelectedConversation;

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, AlertCircle } from "lucide-react";
import FormattedResponse from "./FormattedResponse";

interface ClientResponseProps {
	response: {
		content: string;
		keyTakeaways: string[];
		reflectionQuestion: string;
		biblicalReferences: string[];
	} | null;
	loading: boolean;
	error: string | null;
}

const ClientResponse: React.FC<ClientResponseProps> = ({
	response,
	loading,
	error
}) => {
	if (loading) {
		return (
			<Card
				id="response-card"
				className="mt-4 animate-pulse bg-gray-50 dark:bg-gray-700"
			>
				<CardContent className="pt-4">
					<div className="h-6 bg-gray-200 dark:bg-gray-600 rounded w-3/4 mb-4" />
					<div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-full mb-2" />
					<div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-5/6" />
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card id="response-card" className="mt-4 bg-red-50 dark:bg-red-900">
				<CardContent className="pt-4">
					<div className="flex items-center mb-2">
						<AlertCircle className="h-5 w-5 text-red-500 mr-2" />
						<h3 className="text-lg font-semibold text-red-800 dark:text-red-100">
							Error
						</h3>
					</div>
					<p className="text-red-700 dark:text-red-200">
						{error.includes("An error occurred:")
							? "We're experiencing technical difficulties. Please try again later."
							: error}
					</p>
					{error.includes("An error occurred:") &&
						<p className="text-sm text-red-600 dark:text-red-300 mt-2">
							If this problem persists, please contact support.
						</p>}
				</CardContent>
			</Card>
		);
	}

	if (!response) {
		return null;
	}

	return (
		<Card
			id="response-card"
			className="mt-4 animate-fadeIn bg-gray-50 dark:bg-gray-700"
		>
			<CardContent className="pt-4">
				<div className="flex items-center mb-2">
					<Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
					<h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
						Biblical Insight
					</h3>
				</div>
				<FormattedResponse response={response} />
			</CardContent>
		</Card>
	);
};

export default ClientResponse;

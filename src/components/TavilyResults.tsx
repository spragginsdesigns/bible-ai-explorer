import React from "react";
import { Card, CardContent } from "@/components/ui/card";

interface TavilyResult {
	title: string;
	content: string;
	url: string;
}

interface TavilyResultsProps {
	results: TavilyResult[] | null;
	loading: boolean;
}

const TavilyResults: React.FC<TavilyResultsProps> = ({ results, loading }) => {
	if (loading) {
		return (
			<Card className="mt-4">
				<CardContent className="pt-4">
					<h3 className="text-lg font-semibold mb-2">Tavily Search Results</h3>
					<p>Loading Tavily results...</p>
				</CardContent>
			</Card>
		);
	}

	if (!results || results.length === 0) {
		return null;
	}

	return (
		<Card className="mt-4">
			<CardContent className="pt-4">
				<h3 className="text-lg font-semibold mb-2">Tavily Search Results</h3>
				{results.map((result, index) => (
					<div key={index} className="mb-4">
						<h4 className="font-medium">{result.title}</h4>
						<p className="text-sm text-gray-600 dark:text-gray-300">
							{result.content}
						</p>
						<a
							href={result.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-500 hover:underline"
						>
							Read more
						</a>
					</div>
				))}
			</CardContent>
		</Card>
	);
};

export default TavilyResults;

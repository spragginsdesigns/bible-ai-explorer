import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ExternalLink, Loader2, Globe } from "lucide-react";

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
			<Card className="bg-black/60 border border-amber-700/20 shadow-lg rounded-xl overflow-hidden h-full">
				<CardContent className="pt-5 px-5">
					<div className="flex items-center mb-4 border-b border-amber-700/20 pb-3">
						<Search className="h-5 w-5 text-amber-500 mr-2" />
						<h3 className="text-lg font-semibold text-amber-500">
							Tavily Search
						</h3>
					</div>
					<div className="flex items-center justify-center space-x-2 py-8">
						<Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
						<p className="text-amber-100/60">
							Searching for biblical resources...
						</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!results || results.length === 0) {
		return null;
	}

	return (
		<Card className="bg-black/70 border border-amber-700/30 shadow-lg rounded-xl overflow-hidden h-full">
			<CardContent className="pt-5 px-5 max-h-[600px] overflow-y-auto custom-scrollbar">
				<div className="flex items-center justify-between mb-4 border-b border-amber-700/20 pb-3 sticky top-0 bg-black/90 backdrop-blur-sm z-10">
					<div className="flex items-center">
						<Search className="h-5 w-5 text-amber-500 mr-2" />
						<h3 className="text-lg font-semibold text-amber-500">
							Tavily Results
						</h3>
					</div>
					<span className="text-amber-400/60 text-xs">
						{results.length} sources
					</span>
				</div>

				<div className="space-y-4">
					{results.map((result, index) =>
						<div key={index} className="group">
							<div className="mb-3 border-b border-amber-900/30 pb-4 last:border-0 hover:bg-amber-900/5 transition-colors p-2 rounded-lg -mx-2">
								<div className="flex items-start">
									<Globe className="h-4 w-4 text-amber-500/70 mt-1 mr-2 flex-shrink-0" />
									<div>
										<h4 className="font-medium text-amber-300 group-hover:text-amber-200 transition-colors">
											{result.title}
										</h4>
										<p className="text-sm text-amber-100/70 my-2 line-clamp-3">
											{result.content}
										</p>
										<a
											href={result.url}
											target="_blank"
											rel="noopener noreferrer"
											className="text-amber-500 hover:text-amber-400 transition-colors flex items-center text-xs mt-2 w-fit"
										>
											<span>View source</span>{" "}
											<ExternalLink className="h-3 w-3 ml-1 inline" />
										</a>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
};

export default TavilyResults;

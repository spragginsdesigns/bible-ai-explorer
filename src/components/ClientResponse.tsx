import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, AlertCircle, Loader2 } from "lucide-react";
import FormattedResponse from "./FormattedResponse";

interface ClientResponseProps {
	response: string | null;
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
				className="animate-pulse bg-black/60 border border-amber-700/20 shadow-lg rounded-xl overflow-hidden"
			>
				<CardContent className="pt-5 px-5">
					<div className="flex items-center mb-4">
						<Loader2 className="h-5 w-5 text-amber-500 mr-2 animate-spin" />
						<h3 className="text-lg font-semibold text-amber-500">
							Generating Response...
						</h3>
					</div>
					<div className="space-y-3">
						<div className="h-4 bg-amber-900/20 rounded-full w-full" />
						<div className="h-4 bg-amber-900/20 rounded-full w-11/12" />
						<div className="h-4 bg-amber-900/20 rounded-full w-3/4" />
						<div className="h-4 bg-amber-900/20 rounded-full w-5/6" />
						<div className="h-4 bg-amber-900/20 rounded-full w-2/3" />
					</div>

					<div className="flex justify-center mt-8 mb-2">
						<div className="flex items-center space-x-1.5">
							<span className="text-xs text-amber-500/70">
								Searching biblical wisdom
							</span>
							<div className="flex items-center">
								<span className="animate-bounce mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
								<span className="animate-bounce animation-delay-200 mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
								<span className="animate-bounce animation-delay-500 mx-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card
				id="response-card"
				className="bg-black/70 border border-red-700/30 shadow-lg rounded-xl overflow-hidden"
			>
				<CardContent className="pt-5 px-5">
					<div className="flex items-center mb-4 border-b border-red-800/20 pb-3">
						<AlertCircle className="h-5 w-5 text-red-500 mr-2" />
						<h3 className="text-lg font-semibold text-red-400">
							Error Encountered
						</h3>
					</div>
					<div className="bg-red-900/10 p-4 rounded-lg border border-red-900/30">
						<p className="text-red-300 mb-2">
							{error.includes("An error occurred:")
								? "We're experiencing technical difficulties. Please try again later."
								: error}
						</p>
						{error.includes("An error occurred:") &&
							<p className="text-sm text-red-400/80 italic mt-2">
								If this problem persists, please contact support.
							</p>}
					</div>
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
			className="animate-fadeIn bg-black/70 border border-amber-700/30 shadow-lg rounded-xl overflow-hidden"
		>
			<CardContent className="pt-5 px-5">
				<div className="flex items-center mb-4 border-b border-amber-700/20 pb-3">
					<Sparkles className="h-5 w-5 text-amber-500 mr-2" />
					<h3 className="text-lg font-semibold text-amber-500">
						VerseMind Response
					</h3>
				</div>
				<FormattedResponse response={response} />
			</CardContent>
		</Card>
	);
};

export default ClientResponse;

"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { FormattedResponse } from "./BibleAIExplorer";

interface ClientResponseProps {
	response: string;
}

const ClientResponse: React.FC<ClientResponseProps> = ({ response }) => (
	<Card
		id="response-card"
		className="mt-4 animate-fadeIn bg-gray-50 dark:bg-gray-700"
	>
		<CardContent className="pt-4">
			<div className="flex items-center mb-2">
				<Sparkles className="h-5 w-5 text-yellow-500 mr-2" />
				<h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
					AI Response
				</h3>
			</div>
			<FormattedResponse response={response} />
		</CardContent>
	</Card>
);

export default ClientResponse;

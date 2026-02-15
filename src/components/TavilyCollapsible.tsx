"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe } from "lucide-react";
import type { TavilyResult } from "./useChat";

interface TavilyCollapsibleProps {
	results: TavilyResult[];
}

const TavilyCollapsible: React.FC<TavilyCollapsibleProps> = ({ results }) => {
	const [open, setOpen] = useState(false);

	return (
		<div className="mt-3">
			<button
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
			>
				{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
				{results.length} source{results.length !== 1 ? "s" : ""} found
			</button>
			{open && (
				<div className="mt-2 space-y-2 pl-1 border-l border-black/[0.08] dark:border-white/[0.08] ml-1">
					{results.map((result, i) => (
						<div key={i} className="pl-3 py-1.5">
							<div className="flex items-start gap-2">
								<Globe className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 mt-0.5 flex-shrink-0" />
								<div>
									<p className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">{result.title}</p>
									<p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">{result.content}</p>
									<a
										href={result.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center gap-1 mt-1 w-fit"
									>
										View source <ExternalLink className="w-3 h-3" />
									</a>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export default TavilyCollapsible;

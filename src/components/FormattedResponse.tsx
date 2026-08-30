import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents } from "./markdownComponents";
import VersePopover from "./VersePopover";
import { parseVerseReferences } from "../utils/verseParser";

interface FormattedResponseProps {
	response: string | undefined;
}

/**
 * The renderer map is built once, outside the component, so react-markdown
 * sees a stable `components` identity across streamed re-renders.
 */
const markdownComponents = createMarkdownComponents({
	VerseRef: VersePopover,
	parseVerseReferences,
});

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	if (!response || typeof response !== "string") {
		return (
			<div className="text-neutral-500 dark:text-neutral-400 font-semibold">
				No valid response available.
			</div>
		);
	}

	return (
		// `prose-neutral` used to sit here and matched no rule at all
		// (@tailwindcss/typography is not installed). The renderer map owns the
		// styling now; the wrapper only has to stop long unbroken tokens from
		// widening the message bubble.
		<div className="min-w-0 break-words text-chat">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={markdownComponents}
			>
				{response}
			</ReactMarkdown>
		</div>
	);
};

export default FormattedResponse;

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FormattedResponseProps {
	response: string;
}

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={{
				p: ({ children }) => <div className="mb-4">{children}</div>,
				strong: ({ children }) => (
					<span className="font-bold text-blue-600 dark:text-blue-400">
						{children}
					</span>
				)
			}}
		>
			{response}
		</ReactMarkdown>
	);
};

export default FormattedResponse;

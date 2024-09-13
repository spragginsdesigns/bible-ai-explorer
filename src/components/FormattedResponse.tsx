import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	Book,
	Quote,
	Lightbulb,
	List,
	ChevronRight,
	Info,
	CheckCircle,
	BookOpen
} from "lucide-react";

interface FormattedResponseProps {
	response: {
		content: string;
		keyTakeaways: string[];
		reflectionQuestion: string;
		biblicalReferences: string[];
	};
}

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	const parsedResponse = response;

	return (
		<div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-lg shadow-lg p-6 mt-6 border border-blue-200 dark:border-gray-700">
			<div className="flex items-center mb-6">
				<Book className="w-8 h-8 text-blue-600 dark:text-blue-400 mr-3" />
				<h2 className="text-3xl font-bold text-blue-800 dark:text-blue-300">
					Biblical Insight
				</h2>
			</div>

			{/* Content Section */}
			{parsedResponse.content &&
				<div className="mb-8">
					<h3 className="text-2xl font-semibold mb-4 text-indigo-600 dark:text-indigo-400 flex items-center">
						<ChevronRight className="w-6 h-6 mr-2 text-indigo-500" />
						Content
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{parsedResponse.content}
					</ReactMarkdown>
				</div>}

			{/* Key Takeaways Section */}
			{parsedResponse.keyTakeaways.length > 0 &&
				<div className="mb-8 bg-green-50 dark:bg-green-900 rounded-lg p-4 border-l-4 border-green-500">
					<h3 className="text-xl font-semibold text-green-700 dark:text-green-300 mb-4 flex items-center">
						<Info className="w-6 h-6 mr-2" />
						Key Takeaways
					</h3>
					<ul className="list-none space-y-2">
						{parsedResponse.keyTakeaways.map((takeaway, index) =>
							<li key={index} className="flex items-start">
								<CheckCircle className="w-5 h-5 text-green-500 mr-2 mt-1 flex-shrink-0" />
								<span className="text-gray-700 dark:text-gray-300">
									{takeaway}
								</span>
							</li>
						)}
					</ul>
				</div>}

			{/* Reflection Question Section */}
			{parsedResponse.reflectionQuestion &&
				<div className="mb-8 bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4 border-l-4 border-yellow-500">
					<h3 className="text-xl font-semibold text-yellow-700 dark:text-yellow-300 mb-2 flex items-center">
						<Lightbulb className="w-6 h-6 mr-2" />
						Reflection Question
					</h3>
					<div className="text-gray-700 dark:text-gray-300 italic">
						{parsedResponse.reflectionQuestion}
					</div>
				</div>}

			{/* Biblical References Section */}
			{parsedResponse.biblicalReferences.length > 0 &&
				<div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
					<h3 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4 flex items-center">
						<BookOpen className="w-6 h-6 mr-2" />
						Biblical References
					</h3>
					<ul className="list-none space-y-4">
						{parsedResponse.biblicalReferences.map(
							(reference: string, index: number) =>
								<li key={index} className="flex items-start">
									<Quote className="w-5 h-5 text-blue-500 mr-2 mt-1 flex-shrink-0" />
									<span className="text-gray-700 dark:text-gray-300">
										{reference}
									</span>
								</li>
						)}
					</ul>
				</div>}
		</div>
	);
};

const markdownComponents: React.ComponentProps<
	typeof ReactMarkdown
>["components"] = {
	p: ({ children }) =>
		<p className="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">
			{children}
		</p>,
	h1: ({ children }) =>
		<h1 className="text-3xl font-bold mb-4 text-blue-700 dark:text-blue-300 border-b-2 border-blue-200 dark:border-blue-700 pb-2">
			{children}
		</h1>,
	h2: ({ children }) =>
		<h2 className="text-2xl font-semibold mb-3 text-indigo-600 dark:text-indigo-400 flex items-center">
			<Lightbulb className="w-5 h-5 mr-2 text-yellow-500" />
			{children}
		</h2>,
	h3: ({ children }) =>
		<h3 className="text-xl font-medium mb-2 text-purple-600 dark:text-purple-400 flex items-center">
			<ChevronRight className="w-5 h-5 mr-2 text-green-500" />
			{children}
		</h3>,
	ul: ({ children }) =>
		<ul className="list-none mb-4 text-gray-700 dark:text-gray-300 space-y-2">
			{React.Children.map(children, child =>
				<li className="flex items-start">
					<CheckCircle className="w-4 h-4 text-green-500 mr-2 mt-1 flex-shrink-0" />
					{child}
				</li>
			)}
		</ul>,
	ol: ({ children }) =>
		<ol className="list-decimal list-inside mb-4 text-gray-700 dark:text-gray-300 space-y-2">
			{children}
		</ol>,
	li: ({ children }) =>
		<li className="mb-2">
			{children}
		</li>,
	blockquote: ({ children }) =>
		<div className="flex items-start mb-4 bg-blue-50 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
			<Quote className="w-6 h-6 text-blue-500 mr-3 flex-shrink-0 mt-1" />
			<div className="italic text-gray-700 dark:text-gray-300">
				{children}
			</div>
		</div>,
	code: ({ children }) =>
		<code className="text-sm bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-pink-500 dark:text-pink-300">
			{children}
		</code>,
	strong: ({ children }) =>
		<span className="font-bold text-blue-600 dark:text-blue-400">
			{children}
		</span>,
	em: ({ children }) =>
		<span className="italic text-purple-600 dark:text-purple-400">
			{children}
		</span>
};

export default FormattedResponse;

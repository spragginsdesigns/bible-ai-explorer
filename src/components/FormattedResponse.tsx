// src\components\FormattedResponse.tsx
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
	response: string | undefined;
}

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	if (!response || typeof response !== "string") {
		return (
			<div className="text-red-500 font-semibold">
				No valid response available.
			</div>
		);
	}

	// Split the response into sections based on bold headings
	const sections = response
		.split(
			/(?=\*\*(Answer \d+:|Biblical Reference \d+:|Translation Insights:|Overall Explanation \/ Summary:|Thought-Provoking Question:)\*\*)/g
		)
		.filter(Boolean);

	// Helper function to extract content after the heading
	const extractContent = (section: string, heading: string): string => {
		const regex = new RegExp(`\\*\\*${heading}\\*\\*:\\n?`);
		return section.replace(regex, "").trim();
	};

	// Extract individual sections
	const answer1 = extractContent(
		sections.find(sec => sec.startsWith("**Answer 1:**")) || "",
		"Answer 1"
	);
	const reference1 = extractContent(
		sections.find(sec => sec.startsWith("**Biblical Reference 1:**")) || "",
		"Biblical Reference 1"
	);
	const answer2 = extractContent(
		sections.find(sec => sec.startsWith("**Answer 2:**")) || "",
		"Answer 2"
	);
	const reference2 = extractContent(
		sections.find(sec => sec.startsWith("**Biblical Reference 2:**")) || "",
		"Biblical Reference 2"
	);
	const answer3 = extractContent(
		sections.find(sec => sec.startsWith("**Answer 3:**")) || "",
		"Answer 3"
	);
	const reference3 = extractContent(
		sections.find(sec => sec.startsWith("**Biblical Reference 3:**")) || "",
		"Biblical Reference 3"
	);
	const translationInsights = extractContent(
		sections.find(sec => sec.startsWith("**Translation Insights:**")) || "",
		"Translation Insights"
	);
	const summary = extractContent(
		sections.find(sec =>
			sec.startsWith("**Overall Explanation / Summary:**")
		) || "",
		"Overall Explanation / Summary"
	);
	const reflectionQuestion = extractContent(
		sections.find(sec => sec.startsWith("**Thought-Provoking Question:**")) ||
			"",
		"Thought-Provoking Question"
	);

	return (
		<div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-lg shadow-lg p-6 mt-6 border border-blue-200 dark:border-gray-700">
			<div className="flex items-center mb-6">
				<Book className="w-8 h-8 text-blue-600 dark:text-blue-400 mr-3" />
				<h2 className="text-3xl font-bold text-blue-800 dark:text-blue-300">
					Biblical Insight
				</h2>
			</div>

			{/* Answer 1 Section */}
			{answer1 &&
				<div className="mb-6">
					<h3 className="text-2xl font-semibold mb-4 text-blue-700 dark:text-blue-300 flex items-center">
						<ChevronRight className="w-6 h-6 mr-2 text-blue-500" />
						Answer 1
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{answer1}
					</ReactMarkdown>
				</div>}

			{/* Biblical Reference 1 Section */}
			{reference1 &&
				<div className="mb-6 bg-blue-100 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
					<h3 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4 flex items-center">
						<BookOpen className="w-6 h-6 mr-2" />
						Biblical Reference 1
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={biblicalReferenceComponents}
					>
						{reference1}
					</ReactMarkdown>
				</div>}

			{/* Answer 2 Section */}
			{answer2 &&
				<div className="mb-6">
					<h3 className="text-2xl font-semibold mb-4 text-blue-700 dark:text-blue-300 flex items-center">
						<ChevronRight className="w-6 h-6 mr-2 text-blue-500" />
						Answer 2
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{answer2}
					</ReactMarkdown>
				</div>}

			{/* Biblical Reference 2 Section */}
			{reference2 &&
				<div className="mb-6 bg-blue-100 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
					<h3 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4 flex items-center">
						<BookOpen className="w-6 h-6 mr-2" />
						Biblical Reference 2
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={biblicalReferenceComponents}
					>
						{reference2}
					</ReactMarkdown>
				</div>}

			{/* Answer 3 Section */}
			{answer3 &&
				<div className="mb-6">
					<h3 className="text-2xl font-semibold mb-4 text-blue-700 dark:text-blue-300 flex items-center">
						<ChevronRight className="w-6 h-6 mr-2 text-blue-500" />
						Answer 3
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{answer3}
					</ReactMarkdown>
				</div>}

			{/* Biblical Reference 3 Section */}
			{reference3 &&
				<div className="mb-6 bg-blue-100 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
					<h3 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4 flex items-center">
						<BookOpen className="w-6 h-6 mr-2" />
						Biblical Reference 3
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={biblicalReferenceComponents}
					>
						{reference3}
					</ReactMarkdown>
				</div>}

			{/* Translation Insights Section */}
			{translationInsights &&
				<div className="mb-6">
					<h3 className="text-2xl font-semibold mb-4 text-blue-700 dark:text-blue-300 flex items-center">
						<Lightbulb className="w-6 h-6 mr-2 text-yellow-500" />
						Translation Insights
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{translationInsights}
					</ReactMarkdown>
				</div>}

			{/* Summary Section */}
			{summary &&
				<div className="mb-6">
					<h3 className="text-2xl font-semibold mb-4 text-blue-700 dark:text-blue-300 flex items-center">
						<Info className="w-6 h-6 mr-2 text-purple-500" />
						Overall Explanation / Summary
					</h3>
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={markdownComponents}
					>
						{summary}
					</ReactMarkdown>
				</div>}

			{/* Reflection Question Section */}
			{reflectionQuestion &&
				<div className="mb-6 bg-yellow-100 dark:bg-yellow-900 rounded-lg p-4 border-l-4 border-yellow-500">
					<h3 className="text-xl font-semibold text-yellow-700 dark:text-yellow-300 mb-2 flex items-center">
						<Lightbulb className="w-6 h-6 mr-2" />
						Reflection Question
					</h3>
					<div className="text-gray-700 dark:text-gray-300 italic">
						{reflectionQuestion}
					</div>
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
		<h2 className="text-2xl font-semibold mb-3 text-blue-600 dark:text-blue-400 flex items-center">
			<Lightbulb className="w-5 h-5 mr-2 text-yellow-500" />
			{children}
		</h2>,
	h3: ({ children }) =>
		<h3 className="text-xl font-medium mb-2 text-blue-600 dark:text-blue-400 flex items-center">
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
		<div className="flex items-start mb-4 bg-blue-100 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
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

const biblicalReferenceComponents: React.ComponentProps<
	typeof ReactMarkdown
>["components"] = {
	...markdownComponents,
	ul: ({ children }) =>
		<ul className="list-none mb-4 text-gray-700 dark:text-gray-300 space-y-2">
			{children}
		</ul>,
	li: ({ children }) =>
		<li className="mb-2 flex items-start">
			<CheckCircle className="w-4 h-4 text-green-500 mr-2 mt-1 flex-shrink-0" />
			<span>
				{children}
			</span>
		</li>
};

export default FormattedResponse;

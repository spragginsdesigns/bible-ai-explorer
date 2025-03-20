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
			<div className="text-amber-500 font-semibold">
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
		<div className="bg-gradient-to-br from-black/80 to-gray-900/90 rounded-lg shadow-lg p-4 sm:p-6 border border-amber-700/30 max-h-[500px] overflow-y-auto custom-scrollbar">
			<div className="flex items-center mb-6 pb-2 border-b border-amber-700/20">
				<Book className="w-6 h-6 text-amber-500 mr-3" />
				<h2 className="text-2xl sm:text-3xl font-bold text-amber-500">
					Biblical Insight
				</h2>
			</div>

			{/* Answer 1 Section */}
			{answer1 &&
				<div className="mb-6">
					<h3 className="text-xl sm:text-2xl font-semibold mb-4 text-amber-500 flex items-center">
						<ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-amber-600" />
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
				<div className="mb-6 bg-black/60 rounded-lg p-4 border-l-4 border-amber-600">
					<h3 className="text-lg sm:text-xl font-semibold text-amber-400 mb-4 flex items-center">
						<BookOpen className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
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
					<h3 className="text-xl sm:text-2xl font-semibold mb-4 text-amber-500 flex items-center">
						<ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-amber-600" />
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
				<div className="mb-6 bg-black/60 rounded-lg p-4 border-l-4 border-amber-600">
					<h3 className="text-lg sm:text-xl font-semibold text-amber-400 mb-4 flex items-center">
						<BookOpen className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
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
					<h3 className="text-xl sm:text-2xl font-semibold mb-4 text-amber-500 flex items-center">
						<ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-amber-600" />
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
				<div className="mb-6 bg-black/60 rounded-lg p-4 border-l-4 border-amber-600">
					<h3 className="text-lg sm:text-xl font-semibold text-amber-400 mb-4 flex items-center">
						<BookOpen className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
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
					<h3 className="text-xl sm:text-2xl font-semibold mb-4 text-amber-500 flex items-center">
						<Lightbulb className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-amber-400" />
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
					<h3 className="text-xl sm:text-2xl font-semibold mb-4 text-amber-500 flex items-center">
						<Info className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-amber-400" />
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
				<div className="mb-2 bg-black/70 rounded-lg p-4 border-l-4 border-amber-500">
					<h3 className="text-lg sm:text-xl font-semibold text-amber-400 mb-2 flex items-center">
						<Lightbulb className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
						Reflection Question
					</h3>
					<div className="text-amber-100/80 italic">
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
		<p className="mb-4 text-amber-100/80 leading-relaxed">
			{children}
		</p>,
	h1: ({ children }) =>
		<h1 className="text-2xl sm:text-3xl font-bold mb-4 text-amber-500 border-b-2 border-amber-700/30 pb-2">
			{children}
		</h1>,
	h2: ({ children }) =>
		<h2 className="text-xl sm:text-2xl font-semibold mb-3 text-amber-500 flex items-center">
			<Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-400" />
			{children}
		</h2>,
	h3: ({ children }) =>
		<h3 className="text-lg sm:text-xl font-medium mb-2 text-amber-400 flex items-center">
			<ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500" />
			{children}
		</h3>,
	ul: ({ children }) =>
		<ul className="list-none mb-4 text-amber-100/80 space-y-2">
			{React.Children.map(children, child =>
				<li className="flex items-start">
					<CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500 mt-0.5" />
					<span>
						{child}
					</span>
				</li>
			)}
		</ul>,
	blockquote: ({ children }) =>
		<blockquote className="border-l-4 border-amber-500 pl-4 my-4 italic text-amber-100/70">
			<div className="flex items-start">
				<Quote className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500 mt-1" />
				<div>
					{children}
				</div>
			</div>
		</blockquote>
};

const biblicalReferenceComponents: React.ComponentProps<
	typeof ReactMarkdown
>["components"] = {
	...markdownComponents,
	p: ({ children }) =>
		<p className="mb-2 text-amber-100/80 font-medium leading-relaxed">
			{children}
		</p>,
	blockquote: ({ children }) =>
		<blockquote className="border-l-2 border-amber-500/50 pl-4 my-2 italic text-amber-200/90">
			<div className="flex items-start">
				<Quote className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500 mt-1 flex-shrink-0" />
				<div>
					{children}
				</div>
			</div>
		</blockquote>
};

export default FormattedResponse;

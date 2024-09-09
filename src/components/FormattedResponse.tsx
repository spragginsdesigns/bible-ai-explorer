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
		biblicalReferences: string[]; // Add this line
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
			<div className="mb-8">
				<h3 className="text-2xl font-semibold mb-4 text-indigo-600 dark:text-indigo-400 flex items-center">
					<ChevronRight className="w-6 h-6 mr-2 text-indigo-500" />
					Content
				</h3>
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						p: ({ children }) => (
							<p className="mb-4 text-gray-700 dark:text-gray-300">
								{children}
							</p>
						),
						h1: ({ children }) => (
							<h1 className="text-2xl font-bold mb-4 text-blue-800 dark:text-blue-300">
								{children}
							</h1>
						),
						h2: ({ children }) => (
							<h2 className="text-xl font-semibold mb-3 text-blue-700 dark:text-blue-400">
								{children}
							</h2>
						),
						h3: ({ children }) => (
							<h3 className="text-lg font-semibold mb-2 text-blue-600 dark:text-blue-500">
								{children}
							</h3>
						),
						ul: ({ children }) => (
							<ul className="list-disc pl-5 mb-4 text-gray-700 dark:text-gray-300">
								{children}
							</ul>
						),
						ol: ({ children }) => (
							<ol className="list-decimal pl-5 mb-4 text-gray-700 dark:text-gray-300">
								{children}
							</ol>
						),
						li: ({ children }) => <li className="mb-2">{children}</li>,
						blockquote: ({ children }) => (
							<blockquote className="border-l-4 border-blue-500 pl-4 py-2 mb-4 italic text-gray-600 dark:text-gray-400">
								{children}
							</blockquote>
						),
						code: ({ className, children, ...props }) => {
							const match = /language-(\w+)/.exec(className || "");
							return match ? (
								<pre className="bg-gray-100 dark:bg-gray-800 rounded p-2 mb-4">
									<code className={`language-${match[1]} text-sm`} {...props}>
										{children}
									</code>
								</pre>
							) : (
								<code className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-sm">
									{children}
								</code>
							);
						},
						em: ({ children }) => <em className="italic">{children}</em>
					}}
				>
					{parsedResponse.content}
				</ReactMarkdown>
			</div>

			{/* Key Takeaways Section */}
			{parsedResponse.keyTakeaways.length > 0 && (
				<div className="mb-8 bg-green-50 dark:bg-green-900 rounded-lg p-4 border-l-4 border-green-500">
					<h3 className="text-xl font-semibold text-green-700 dark:text-green-300 mb-4 flex items-center">
						<Info className="w-6 h-6 mr-2" />
						Key Takeaways
					</h3>
					<ul className="list-none space-y-2">
						{parsedResponse.keyTakeaways.map((takeaway, index) => (
							<li key={index} className="flex items-start">
								<CheckCircle className="w-5 h-5 text-green-500 mr-2 mt-1 flex-shrink-0" />
								<span className="text-gray-700 dark:text-gray-300">
									{takeaway}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Reflection Question Section */}
			{parsedResponse.reflectionQuestion && (
				<div className="mb-8 bg-yellow-50 dark:bg-yellow-900 rounded-lg p-4 border-l-4 border-yellow-500">
					<h3 className="text-xl font-semibold text-yellow-700 dark:text-yellow-300 mb-2 flex items-center">
						<Lightbulb className="w-6 h-6 mr-2" />
						Reflection Question
					</h3>
					<div className="text-gray-700 dark:text-gray-300 italic">
						{parsedResponse.reflectionQuestion}
					</div>
				</div>
			)}

			{/* Biblical References Section */}
			{parsedResponse.biblicalReferences.length > 0 && (
				<div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
					<h3 className="text-xl font-semibold text-blue-700 dark:text-blue-300 mb-4 flex items-center">
						<BookOpen className="w-6 h-6 mr-2" />
						Biblical References
					</h3>
					<ul className="list-none space-y-4">
						{parsedResponse.biblicalReferences.map(
							(reference: string, index: number) => (
								<li key={index} className="flex items-start">
									<Quote className="w-5 h-5 text-blue-500 mr-2 mt-1 flex-shrink-0" />
									<span className="text-gray-700 dark:text-gray-300">
										{reference}
									</span>
								</li>
							)
						)}
					</ul>
				</div>
			)}
		</div>
	);
};

// ... existing code ...

const markdownComponents = {
	p: ({ children }: { children: React.ReactNode }) => (
		<p className="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">
			{children}
		</p>
	),
	h1: ({ children }: { children: React.ReactNode }) => (
		<h1 className="text-3xl font-bold mb-4 text-blue-700 dark:text-blue-300 border-b-2 border-blue-200 dark:border-blue-700 pb-2">
			{children}
		</h1>
	),
	h2: ({ children }: { children: React.ReactNode }) => (
		<h2 className="text-2xl font-semibold mb-3 text-indigo-600 dark:text-indigo-400 flex items-center">
			<Lightbulb className="w-5 h-5 mr-2 text-yellow-500" />
			{children}
		</h2>
	),
	h3: ({ children }: { children: React.ReactNode }) => (
		<h3 className="text-xl font-medium mb-2 text-purple-600 dark:text-purple-400 flex items-center">
			<ChevronRight className="w-5 h-5 mr-2 text-green-500" />
			{children}
		</h3>
	),
	ul: ({ children }: { children: React.ReactNode }) => (
		<ul className="list-none mb-4 text-gray-700 dark:text-gray-300 space-y-2">
			{React.Children.map(children, (child) => (
				<li className="flex items-start">
					<CheckCircle className="w-4 h-4 text-green-500 mr-2 mt-1 flex-shrink-0" />
					{child}
				</li>
			))}
		</ul>
	),
	ol: ({ children }: { children: React.ReactNode }) => (
		<ol className="list-decimal list-inside mb-4 text-gray-700 dark:text-gray-300 space-y-2">
			{children}
		</ol>
	),
	li: ({ children }: { children: React.ReactNode }) => (
		<li className="mb-2">{children}</li>
	),
	blockquote: ({ children }: { children: React.ReactNode }) => (
		<div className="flex items-start mb-4 bg-blue-50 dark:bg-blue-900 rounded-lg p-4 border-l-4 border-blue-500">
			<Quote className="w-6 h-6 text-blue-500 mr-3 flex-shrink-0 mt-1" />
			<div className="italic text-gray-700 dark:text-gray-300">{children}</div>
		</div>
	),
	code: ({ children }: { children: React.ReactNode }) => (
		<code className="text-sm bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-pink-500 dark:text-pink-300">
			{children}
		</code>
	),
	strong: ({ children }: { children: React.ReactNode }) => (
		<span className="font-bold text-blue-600 dark:text-blue-400">
			{children}
		</span>
	),
	em: ({ children }: { children: React.ReactNode }) => (
		<span className="italic text-purple-600 dark:text-purple-400">
			{children}
		</span>
	)
};

export default FormattedResponse;

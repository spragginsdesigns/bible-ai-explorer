"use client";

import { AddLearnButton } from "./AddLearnButton";
import { suggestionKey, type LearnSuggestion, type LearnSuggestionsView } from "./suggestions";

export interface SuggestedVersesProps {
	view: LearnSuggestionsView;
	translation: "KJV" | "NKJV" | "BSB";
	/** Stands in for the row that was just added, so the confirmation outlives it. */
	confirmation: string | null;
	onAdded: (suggestion: LearnSuggestion) => void;
	onDismiss: (suggestion: LearnSuggestion) => void;
}

export function SuggestedVerses({ view, translation, confirmation, onAdded, onDismiss }: SuggestedVersesProps) {
	if (!view.rows.length && !confirmation) return null;
	return <section
		aria-label="Suggested for you"
		className={view.lead ? "my-auto py-4" : "border-t border-neutral-200 pt-6 dark:border-white/10"}
	>
		<h2 className={view.lead
			? "text-center font-serif text-2xl leading-relaxed"
			: "text-sm font-semibold text-neutral-600 dark:text-neutral-400"}>{view.heading}</h2>
		{confirmation ? <p role="status" className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{confirmation}</p> : null}
		<ul>
			{view.rows.map((suggestion) => <li
				key={suggestionKey(suggestion)}
				className="border-t border-neutral-200 pt-5 mt-5 first:border-t-0 dark:border-white/10"
			>
				<p className="text-sm text-amber-700 dark:text-amber-400">{suggestion.reference}</p>
				<p className="mt-2 font-serif text-xl leading-relaxed">{suggestion.text}</p>
				<p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{suggestion.reason}</p>
				<div className="mt-2 flex flex-wrap items-center gap-3">
					<div className="min-w-[12rem] flex-1">
						<AddLearnButton
							book={suggestion.book}
							chapter={suggestion.chapter}
							verse={suggestion.verse}
							translation={translation}
							source="suggestion"
							accessibilityLabel={`Learn ${suggestion.reference}`}
							onAdded={() => onAdded(suggestion)}
						/>
					</div>
					<button
						type="button"
						aria-label={`Dismiss ${suggestion.reference}`}
						onClick={() => onDismiss(suggestion)}
						className="min-h-11 px-2 py-3 text-sm text-neutral-600 dark:text-neutral-400"
					>Not now</button>
				</div>
			</li>)}
		</ul>
	</section>;
}

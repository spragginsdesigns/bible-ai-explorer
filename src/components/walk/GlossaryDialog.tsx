import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { GLOSSARY, type GlossaryTerm } from "@/lib/onboarding-rules";

/**
 * A tapped word on a welcome card ("saved"), explained plainly from the KJV.
 * Instant and free: the words are fixed in `GLOSSARY`, not generated. "Talk
 * with SureWord about this" sends the entry's question as their answer, when
 * the card can still take one.
 */
export default function GlossaryDialog({ term, onClose, onAsk }: { term: GlossaryTerm; onClose: () => void; onAsk?: (question: string) => void }) {
	const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const entry = GLOSSARY[term];
	const titleId = `glossary-${term}-title`;
	// Portaled: the message row animates with a transform, which would trap a
	// fixed overlay inside it.
	return createPortal(
		<div
			className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-5"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-3xl border border-black/10 bg-[#f6f2e9] text-[#24281f] shadow-xl outline-none dark:border-white/10 dark:bg-[#111710] dark:text-[#f1eadc] sm:rounded-3xl"
			>
				<header className="flex items-center gap-4 border-b border-black/10 px-5 py-4 dark:border-white/10">
					<h2 id={titleId} className="flex-1 text-xl font-bold">
						{entry.title}
					</h2>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
					>
						<X size={22} aria-hidden />
					</button>
				</header>
				<div className="flex flex-col gap-5 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
					{entry.sections.map((section) => (
						<section key={section.text} className="flex flex-col gap-3">
							<p className="text-lg leading-7">{section.text}</p>
							{section.verses.map((verse) => (
								<blockquote key={verse.reference} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
									<p className="font-[family-name:var(--font-cormorant)] text-xl leading-7">{verse.text}</p>
									<footer className="mt-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]">{verse.reference} (KJV)</footer>
								</blockquote>
							))}
						</section>
					))}
					{onAsk && (
						<button
							type="button"
							onClick={() => onAsk(entry.ask)}
							className="flex min-h-12 items-center justify-center gap-3 rounded-full border border-amber-800/30 font-bold text-amber-800 dark:border-amber-300/30 dark:text-[#e5b664]"
						>
							<MessageCircle size={19} aria-hidden />
							Talk with SureWord about this
						</button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}

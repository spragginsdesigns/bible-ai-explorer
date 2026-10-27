"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { ArrowUp, BookOpen, Layers, NotebookPen, Sun, type LucideIcon } from "lucide-react";
import { useVerseOfDayPreview } from "@/components/daily/useVerseOfDayPreview";
import { BETA_MODULES, betaModulesByProgress } from "@/lib/beta/modules";
import BetaModuleCard from "./BetaModuleCard";
import VaultResume from "./vault/VaultResume";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
/** Home shows this many modules until "Show all" is pressed. */
const WORKSHOP_PREVIEW = 4;

function partOfDay(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 17) return "Good afternoon";
	return "Good evening";
}

function Shortcut({ href, label, Icon }: { href: string; label: string; Icon: LucideIcon }) {
	return (
		<Link href={href} className={`${card} flex min-h-[92px] flex-col items-center justify-center gap-2 px-2 py-3 text-center text-sm font-bold leading-tight transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`}>
			<Icon size={24} strokeWidth={1.6} className="text-amber-800 dark:text-[#e5b664]" aria-hidden />
			{label}
		</Link>
	);
}

export default function BetaHome() {
	const { userId } = useAuth();
	// A different account must never see the previous one's rows, even briefly.
	return <BetaHomeContent key={userId ?? "guest"} />;
}

function BetaHomeContent() {
	const router = useRouter();
	const { user } = useUser();
	const preview = useVerseOfDayPreview();
	const [now, setNow] = useState<Date | null>(null);
	const [question, setQuestion] = useState("");
	const [showAll, setShowAll] = useState(false);
	// The greeting depends on the reader's clock, which the server does not know.
	useEffect(() => setNow(new Date()), []);

	const ask = (event: FormEvent) => {
		event.preventDefault();
		const text = question.trim();
		if (!text) return;
		// The chat's own deep link: it prefills and focuses, and the reader sends.
		router.push(`/?prompt=${encodeURIComponent(text)}`);
	};

	const workshop = betaModulesByProgress();
	const shown = showAll ? workshop : workshop.slice(0, WORKSHOP_PREVIEW);
	const firstName = user?.firstName?.trim();
	const greeting = now ? `${partOfDay(now.getHours())}${firstName ? `, ${firstName}` : ""}` : "";

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-8">
				<section aria-labelledby="beta-home-title" className="overflow-hidden rounded-[28px] border border-amber-900/10 bg-white/25 dark:border-amber-200/10 dark:bg-white/[.015]">
					<div className="relative h-56 overflow-hidden sm:h-64 lg:h-80">
						<Image src="/daily-walk-dawn.jpg" alt="" fill priority sizes="(min-width: 1024px) 560px, 100vw" className="object-cover object-[65%_52%]" />
						<div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
						<div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
							<p className="min-h-[1.25rem] text-xs font-bold uppercase tracking-[.2em] text-white/85">{greeting}</p>
							<h1 id="beta-home-title" className="mt-2 font-[family-name:var(--font-cormorant)] text-[clamp(2.1rem,8vw,3rem)] font-semibold leading-[1.05] text-white">
								Let&rsquo;s grow together in God&rsquo;s Word.
							</h1>
						</div>
					</div>
					<form onSubmit={ask} className="p-4 sm:p-5">
						<label htmlFor="beta-ask" className="sr-only">Ask anything about the Bible</label>
						<div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/80 py-1.5 pl-4 pr-1.5 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
							<input
								id="beta-ask"
								value={question}
								onChange={(event) => setQuestion(event.target.value)}
								placeholder="Ask anything about the Bible…"
								enterKeyHint="send"
								autoComplete="off"
								className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
							/>
							<button
								type="submit"
								disabled={!question.trim()}
								aria-label="Ask"
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#24281f] text-white transition-opacity disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]"
							>
								<ArrowUp size={20} aria-hidden />
							</button>
						</div>
					</form>
				</section>

				<div className="flex flex-col gap-5">
					<nav aria-label="Shortcuts" className="grid grid-cols-4 gap-2.5">
						<Shortcut href="/bible" label="Bible" Icon={BookOpen} />
						<Shortcut href="/cross" label="Today's word" Icon={Sun} />
						<Shortcut href="/bible/learn" label="Learn a verse" Icon={Layers} />
						<Shortcut href="/notes" label="Notes" Icon={NotebookPen} />
					</nav>

					{/* The newest study anywhere in SureWord (reader, chat, note, Learn a verse or a beta module), the Knowledge Vault's own study memory. */}
					<VaultResume />

					<section aria-labelledby="beta-invitation" className={`${card} px-5 py-5`}>
						<h2 id="beta-invitation" className={eyebrow}>{preview ? "Today's invitation" : "A light for your walk"}</h2>
						<blockquote className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] leading-[1.3]">
							&ldquo;{preview?.text ?? "Thy word is a lamp unto my feet, and a light unto my path."}&rdquo;
						</blockquote>
						<div className="mt-3 flex flex-wrap items-center justify-between gap-x-4">
							<p className="text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">{preview?.reference ?? "Psalm 119:105"} · KJV</p>
							<Link href="/cross" className="flex min-h-11 items-center whitespace-nowrap text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
								Read today&apos;s word
							</Link>
						</div>
					</section>
				</div>
			</div>

			<section aria-labelledby="beta-workshop" className="mt-9">
				<div className="flex items-end justify-between gap-3">
					<div>
						<h2 id="beta-workshop" className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">In the workshop</h2>
						<p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">What is being built into SureWord Beta, and where each piece stands.</p>
					</div>
					{workshop.length > WORKSHOP_PREVIEW && (
						<button type="button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll} className="min-h-11 shrink-0 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
							{showAll ? "Show less" : `Show all ${BETA_MODULES.length}`}
						</button>
					)}
				</div>
				<div className="mt-4 grid gap-3 lg:grid-cols-2">
					{shown.map((entry) => (
						<BetaModuleCard key={`${entry.destination}/${entry.slug}`} entry={entry} />
					))}
				</div>
			</section>
		</main>
	);
}

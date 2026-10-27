"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Lock, Star } from "lucide-react";
import type { KidsAdventureView, KidsAward, KidsChild } from "@/lib/beta/kids/kids-rules";
import { adventureIcon } from "./adventure-icons";
import KidsAdventure from "./KidsAdventure";
import { KIDS_PARENT_HREF, clearKidsLock, setKidsLock } from "./kids-lock";
import ParentGate from "./ParentGate";

/**
 * SureWord Kids mode for one child (docs/beta/kids.md).
 *
 * It is a modal <dialog> filling the screen, so everything behind it (the beta's
 * header, rail and tab bar) is inert: no link out can be reached by touch,
 * mouse or keyboard. There is no chat and nothing to type. Every way out leads
 * to the parent check instead:
 *
 * - the Grown-ups button;
 * - Escape (the dialog's cancel), and a browser that force-closes the dialog;
 * - Back: the first tap inside Kids adds a history entry (Chrome skips entries
 *   added without a tap), and going back from it opens the check and re-arms;
 * - a reload stays here (the child is in the URL), and reaching the parent's
 *   page any other way bounces back here while the tab's lock is set.
 */
export default function KidsMode({ child, adventures }: { child: KidsChild; adventures: KidsAdventureView[] }) {
	const router = useRouter();
	const dialog = useRef<HTMLDialogElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const [stars, setStars] = useState(child.stars);
	const [verses, setVerses] = useState(child.verses);
	const [openId, setOpenId] = useState<string | null>(null);
	const [gate, setGate] = useState(false);
	const leaving = useRef(false);
	const trapped = useRef(false);
	/** The server renders the dialog open so it covers the page before hydration; this marks its swap to a modal. */
	const upgrading = useRef(false);
	const open = adventures.find((adventure) => adventure.id === openId) ?? null;

	useEffect(() => {
		setKidsLock(child.id);
		const element = dialog.current;
		if (!element || element.matches(":modal")) return;
		if (element.open) {
			upgrading.current = true;
			element.close();
		}
		element.showModal();
	}, [child.id]);

	useEffect(() => {
		const onPopState = () => {
			if (leaving.current) return;
			trapped.current = false;
			setGate(true);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	/** Adds the history entry Back will land on, from inside a tap so the browser keeps it. */
	const arm = useCallback(() => {
		if (trapped.current || leaving.current) return;
		window.history.pushState({ ...window.history.state, kidsTrap: true }, "", window.location.href);
		trapped.current = true;
	}, []);

	useEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
	}, [openId, gate]);

	const leave = () => {
		leaving.current = true;
		clearKidsLock();
		dialog.current?.close();
		if (trapped.current) {
			// Step back off the entry Kids added, then swap Kids for the parent's page.
			window.addEventListener("popstate", () => router.replace(KIDS_PARENT_HREF), { once: true });
			window.history.back();
		} else {
			router.replace(KIDS_PARENT_HREF);
		}
	};

	const award = (adventureId: string, kind: KidsAward) => {
		const set = kind === "star" ? setStars : setVerses;
		set((old) => (old.includes(adventureId) ? old : [...old, adventureId]));
		void fetch(`/api/beta/kids/children/${encodeURIComponent(child.id)}/progress`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ adventure: adventureId, award: kind }),
		})
			.then((response) => (response.ok ? (response.json() as Promise<{ child: KidsChild }>) : null))
			.then((saved) => {
				if (!saved) return;
				setStars(saved.child.stars);
				setVerses(saved.child.verses);
			})
			.catch(() => {
				// Offline: the star shows now and is saved the next time it is earned.
			});
	};

	return (
		<dialog
			ref={dialog}
			open
			aria-label={`SureWord Kids for ${child.name}`}
			onCancel={(event) => {
				event.preventDefault();
				setGate(true);
			}}
			onClose={() => {
				if (upgrading.current) {
					upgrading.current = false;
					return;
				}
				// Chrome force-closes a modal on a repeated Escape; Kids stays open and asks for the check.
				if (leaving.current) return;
				dialog.current?.showModal();
				setGate(true);
			}}
			onPointerDownCapture={arm}
			onKeyDownCapture={arm}
			className="fixed inset-0 z-[100] m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden border-0 bg-[#f6f2e9] p-0 text-[#24281f] backdrop:bg-[#f6f2e9] dark:bg-[#0d100d] dark:text-[#f1eadc] dark:backdrop:bg-[#0d100d]"
		>
			<div ref={scroller} className="flex h-full flex-col overflow-y-auto overscroll-contain">
				<header className="sticky top-0 z-10 bg-[#f6f2e9] px-4 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] dark:bg-[#0d100d] lg:px-8">
					<div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
						{open && !gate ? (
							<button type="button" onClick={() => setOpenId(null)} className="-ml-1 flex min-h-12 items-center gap-2 rounded-full px-3 text-base font-bold">
								<ArrowLeft size={22} aria-hidden /> All adventures
							</button>
						) : (
							<span className="flex min-h-12 items-center gap-2 rounded-full border border-black/[.1] bg-white/60 px-4 text-base font-bold dark:border-white/[.12] dark:bg-white/[.05]">
								{child.name}
								<span className="inline-flex items-center gap-1 text-amber-800 dark:text-[#e5b664]" aria-label={`${stars.length} stars`}>
									<Star size={18} fill="currentColor" aria-hidden /> {stars.length}
								</span>
							</span>
						)}
						{gate ? null : (
							<button
								type="button"
								onClick={() => setGate(true)}
								className="flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-neutral-500 dark:text-neutral-400"
							>
								<Lock size={16} aria-hidden /> Grown-ups
							</button>
						)}
					</div>
				</header>

				{gate ? (
					<ParentGate onPass={leave} onCancel={() => setGate(false)} />
				) : open ? (
					<KidsAdventure
						key={open.id}
						adventure={open}
						band={child.ageBand}
						star={stars.includes(open.id)}
						learned={verses.includes(open.id)}
						onStar={() => award(open.id, "star")}
						onLearned={() => award(open.id, "verse")}
						onDone={() => setOpenId(null)}
					/>
				) : (
					<main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-4 lg:px-8">
						<h2 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.4rem,10vw,3.4rem)] font-semibold leading-none">Hi, {child.name}!</h2>
						<p className="mt-2 text-lg leading-7 text-neutral-700 dark:text-[#d9d1c3]">Pick a Bible adventure.</p>
						<ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
							{adventures.map((adventure) => {
								const Icon = adventureIcon(adventure.id);
								const starred = stars.includes(adventure.id);
								const known = verses.includes(adventure.id);
								return (
									<li key={adventure.id}>
										<button
											type="button"
											onClick={() => setOpenId(adventure.id)}
											className="relative flex h-full min-h-[150px] w-full flex-col items-start gap-3 rounded-[22px] border-2 border-black/[.09] bg-white/60 p-4 text-left transition-colors active:bg-[#e5b664]/20 dark:border-white/[.1] dark:bg-white/[.04]"
										>
											<span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-violet-500/[.12] text-violet-800 dark:bg-violet-300/[.12] dark:text-violet-200" aria-hidden>
												<Icon size={26} strokeWidth={1.7} />
											</span>
											<span className="font-[family-name:var(--font-cormorant)] text-[23px] font-semibold leading-[1.1]">{adventure.title}</span>
											<span className="absolute right-3 top-3 flex gap-1 text-amber-700 dark:text-[#e5b664]">
												{starred ? <Star size={20} fill="currentColor" aria-label="Star earned" /> : null}
												{known ? <Check size={20} strokeWidth={3} aria-label="Verse learned" /> : null}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</main>
				)}
			</div>
		</dialog>
	);
}

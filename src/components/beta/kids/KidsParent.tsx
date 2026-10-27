"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Lock, Pencil, Play, Star, Trash2 } from "lucide-react";
import { AGE_BANDS, AGE_BAND_LABEL, KIDS_MAX_CHILDREN, KIDS_NAME_MAX, type AgeBand, type KidsChild } from "@/lib/beta/kids/kids-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import { clearKidsLock, kidsPlayHref, readKidsLock } from "./kids-lock";

const CARD = "rounded-[22px] border border-black/[.09] bg-white/35 p-5 dark:border-white/[.09] dark:bg-white/[.025]";
const H2 = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
const FIELD = "mt-1.5 min-h-12 w-full rounded-[14px] border border-black/[.14] bg-white/70 px-4 text-base outline-none focus-visible:border-amber-700 dark:border-white/[.16] dark:bg-white/[.05] dark:focus-visible:border-[#e5b664]";
const GOLD = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#e5b664] px-5 text-base font-bold text-[#1c2118] disabled:opacity-50";
const QUIET = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-black/[.12] px-4 text-sm font-bold dark:border-white/[.14]";

interface AdventureSummary {
	id: string;
	title: string;
	reference: string;
}

async function send(url: string, method: string, body?: unknown): Promise<{ child?: KidsChild; error?: string }> {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as { child?: KidsChild; error?: string };
	if (!response.ok) throw new Error(data.error && data.error !== "Not found" ? data.error : "That didn't save. Try again.");
	return data;
}

function AgeBandChoice({ value, onChange, name }: { value: AgeBand | null; onChange: (band: AgeBand) => void; name: string }) {
	return (
		<fieldset className="mt-4">
			<legend className="text-sm font-bold">Age</legend>
			<div className="mt-1.5 grid grid-cols-3 gap-2">
				{AGE_BANDS.map((band) => (
					<label
						key={band}
						className={`flex min-h-12 cursor-pointer items-center justify-center rounded-[14px] border-2 text-base font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber-700 ${
							value === band ? "border-[#e5b664] bg-[#e5b664]/25" : "border-black/[.12] dark:border-white/[.14]"
						}`}
					>
						<input type="radio" name={name} value={band} checked={value === band} onChange={() => onChange(band)} className="sr-only" />
						{band}
					</label>
				))}
			</div>
		</fieldset>
	);
}

/**
 * SureWord Kids, the parent's side (docs/beta/kids.md): the child profiles,
 * the way into Kids mode for each, and what Kids does and does not keep.
 */
export default function KidsParent({ initialChildren, adventures }: { initialChildren: KidsChild[]; adventures: AdventureSummary[] }) {
	const router = useRouter();
	const [children, setChildren] = useState(initialChildren);
	const [name, setName] = useState("");
	const [band, setBand] = useState<AgeBand | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ id: string; name: string; band: AgeBand } | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

	// Kids mode is still locked in this tab (a back gesture or a typed address landed here): go back to it.
	useEffect(() => {
		const lock = readKidsLock();
		if (!lock) return;
		if (initialChildren.some((child) => child.id === lock)) router.replace(kidsPlayHref(lock));
		else clearKidsLock();
	}, [initialChildren, router]);

	const add = async (event: FormEvent) => {
		event.preventDefault();
		if (!band) return setError("Choose an age band.");
		setBusy(true);
		setError(null);
		try {
			const { child } = await send("/api/beta/kids/children", "POST", { name, ageBand: band });
			if (child) setChildren((old) => [...old, child]);
			setName("");
			setBand(null);
		} catch (failure) {
			setError((failure as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const saveEdit = async (event: FormEvent) => {
		event.preventDefault();
		if (!editing) return;
		setRowError(null);
		try {
			const { child } = await send(`/api/beta/kids/children/${encodeURIComponent(editing.id)}`, "PATCH", { name: editing.name, ageBand: editing.band });
			if (child) setChildren((old) => old.map((item) => (item.id === child.id ? child : item)));
			setEditing(null);
		} catch (failure) {
			setRowError({ id: editing.id, message: (failure as Error).message });
		}
	};

	const remove = async (id: string) => {
		setRowError(null);
		try {
			await send(`/api/beta/kids/children/${encodeURIComponent(id)}`, "DELETE");
			setChildren((old) => old.filter((child) => child.id !== id));
			setRemoving(null);
		} catch (failure) {
			setRowError({ id, message: (failure as Error).message });
		}
	};

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/together" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Together
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("kids", "together")} tone={DESTINATION_TILE.together} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">SureWord Kids</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Bible adventures for children, guided by a parent</p>
				</div>
			</header>

			<p className="mt-6 text-[17px] leading-7">
				Open Kids on this device and hand it to your child. Each adventure reads a Bible story aloud from the King James Bible, retells it for their age, asks a few
				questions answered in the verse, and teaches a verse. A star marks each one finished.
			</p>

			<section aria-labelledby="kids-children" className="mt-8">
				<h2 id="kids-children" className={H2}>Your children</h2>
				{children.length === 0 ? (
					<p className={`${CARD} mt-3 text-base leading-7 text-neutral-700 dark:text-[#d9d1c3]`}>Add your first child below to start their adventures.</p>
				) : (
					<ul className="mt-3 flex flex-col gap-3">
						{children.map((child) => (
							<li key={child.id} className={CARD}>
								{editing?.id === child.id ? (
									<form onSubmit={saveEdit} aria-label={`Edit ${child.name}`}>
										<label className="block text-sm font-bold">
											First name or nickname
											<input
												value={editing.name}
												onChange={(event) => setEditing({ ...editing, name: event.target.value })}
												maxLength={KIDS_NAME_MAX}
												autoComplete="off"
												className={FIELD}
											/>
										</label>
										<AgeBandChoice name={`band-${child.id}`} value={editing.band} onChange={(value) => setEditing({ ...editing, band: value })} />
										<div className="mt-4 flex flex-wrap gap-2">
											<button type="submit" className={GOLD}>Save</button>
											<button type="button" onClick={() => setEditing(null)} className={QUIET}>Cancel</button>
										</div>
									</form>
								) : (
									<>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-[family-name:var(--font-cormorant)] text-[28px] font-semibold leading-none">{child.name}</p>
												<p className="mt-1.5 text-sm font-semibold text-neutral-600 dark:text-[#b3ad9e]">{AGE_BAND_LABEL[child.ageBand]}</p>
												<p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
													<span className="inline-flex items-center gap-1">
														<Star size={16} fill="currentColor" className="text-amber-700 dark:text-[#e5b664]" aria-hidden />
														{child.stars.length} of {adventures.length} adventures
													</span>
													<span className="inline-flex items-center gap-1">
														<Check size={16} strokeWidth={3} className="text-amber-700 dark:text-[#e5b664]" aria-hidden />
														{child.verses.length} {child.verses.length === 1 ? "verse" : "verses"} learned
													</span>
												</p>
											</div>
											<Link href={kidsPlayHref(child.id)} prefetch={false} className={GOLD}>
												<Play size={18} fill="currentColor" aria-hidden /> Open Kids
											</Link>
										</div>
										{removing === child.id ? (
											<div className="mt-4 rounded-[16px] border border-amber-700/30 bg-amber-500/10 p-4" role="alertdialog" aria-label={`Remove ${child.name}`}>
												<p className="text-[15px] leading-6">
													Remove {child.name}? Their stars and learned verses are deleted too. This cannot be undone.
												</p>
												<div className="mt-3 flex flex-wrap gap-2">
													<button type="button" onClick={() => void remove(child.id)} className={`${QUIET} border-amber-800/40 text-amber-900 dark:text-[#e5b664]`}>
														<Trash2 size={16} aria-hidden /> Remove
													</button>
													<button type="button" onClick={() => setRemoving(null)} className={QUIET}>Keep</button>
												</div>
											</div>
										) : (
											<div className="mt-4 flex flex-wrap gap-2">
												<button type="button" onClick={() => setEditing({ id: child.id, name: child.name, band: child.ageBand })} className={QUIET}>
													<Pencil size={16} aria-hidden /> Edit
												</button>
												<button type="button" onClick={() => setRemoving(child.id)} className={QUIET}>
													<Trash2 size={16} aria-hidden /> Remove
												</button>
											</div>
										)}
									</>
								)}
								{rowError?.id === child.id ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">{rowError.message}</p> : null}
							</li>
						))}
					</ul>
				)}
			</section>

			{children.length < KIDS_MAX_CHILDREN ? (
				<section aria-labelledby="kids-add" className="mt-8">
					<h2 id="kids-add" className={H2}>Add a child</h2>
					<form onSubmit={add} className={`${CARD} mt-3`}>
						<label className="block text-sm font-bold">
							First name or nickname
							<input
								value={name}
								onChange={(event) => setName(event.target.value)}
								maxLength={KIDS_NAME_MAX}
								autoComplete="off"
								placeholder="Lily"
								className={FIELD}
							/>
						</label>
						<AgeBandChoice name="band-new" value={band} onChange={setBand} />
						{error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p> : null}
						<button type="submit" disabled={busy || !name.trim()} className={`${GOLD} mt-5 w-full sm:w-auto`}>
							{busy ? "Adding…" : "Add child"}
						</button>
						<p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
							Only a first name or nickname and an age band are kept. Nothing about your child is ever sent to an AI model.
						</p>
					</form>
				</section>
			) : null}

			<section aria-labelledby="kids-safe" className="mt-8">
				<h2 id="kids-safe" className={H2}>How Kids keeps your child safe</h2>
				<ul className="mt-3 space-y-3 text-[15px] leading-6">
					{[
						"Kids fills the screen, with no links out, no chat and nothing to type.",
						"Leaving Kids takes a grown-up question that a young child cannot answer with a tap.",
						"Every story is read from the King James Bible. The retellings were written once and checked against each verse, and they are never made up by AI.",
						"Removing a profile deletes its stars and verses, and deleting your account removes everything.",
						"For a full lock on your phone, you can also turn on Guided Access (iPhone) or app pinning (Android).",
					].map((item) => (
						<li key={item} className="flex gap-3">
							<Lock size={17} className="mt-1 shrink-0 text-amber-700 dark:text-[#e5b664]" aria-hidden />
							<span>{item}</span>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="kids-adventures" className="mt-8">
				<h2 id="kids-adventures" className={H2}>The adventures</h2>
				<ol className="mt-3 divide-y divide-black/[.07] dark:divide-white/[.07]">
					{adventures.map((adventure) => (
						<li key={adventure.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
							<span className="font-bold">{adventure.title}</span>
							<span className="text-sm text-neutral-600 dark:text-[#bbb3a7]">{adventure.reference}</span>
						</li>
					))}
				</ol>
			</section>
		</main>
	);
}

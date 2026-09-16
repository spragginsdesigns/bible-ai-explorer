"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_ABOUT_ME_LENGTH, readAboutMePref } from "@/lib/preferences";
import { hydratePreferences, saveAboutMe, useAboutMePreference } from "@/lib/preferencesSync";

/**
 * "About me": what the user wants every conversation to start from. It is one
 * free-text field rather than a form of questions on purpose, since the thing
 * the assistant needs is their own words, and it is saved explicitly rather
 * than on every keystroke so a paragraph in progress is never half-written to
 * the account.
 */
export default function AboutMeSection() {
	const aboutMe = useAboutMePreference();
	const [draft, setDraft] = useState("");
	const draftRef = useRef(draft);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	// The server value only replaces the box while the user has nothing unsaved
	// in it, so a hydrate on tab focus cannot swallow what they are typing.
	useEffect(() => {
		if (aboutMe === null) return;
		setLoadFailed(false);
		if (dirty) return;
		draftRef.current = aboutMe;
		setDraft(aboutMe);
	}, [aboutMe, dirty]);

	useEffect(() => {
		if (aboutMe !== null) return;
		let active = true;
		void hydratePreferences({ force: true }).then((ok) => {
			if (active && (!ok || readAboutMePref() === null)) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [aboutMe]);

	const change = (value: string) => {
		setSaved(false);
		setError(null);
		draftRef.current = value;
		setDraft(value);
		setDirty(true);
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		const ok = await hydratePreferences({ force: true });
		if (!ok || readAboutMePref() === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || !dirty) return;
		const submitted = draftRef.current;
		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveAboutMe(submitted);
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		// Kept dirty when the user typed on while the save was in flight: what is
		// in the box then is newer than what the server just confirmed.
		if (draftRef.current === submitted) {
			draftRef.current = result.aboutMe;
			setDraft(result.aboutMe);
			setDirty(false);
		}
		setSaved(true);
	};

	return (
		<section id="about-me" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				ABOUT ME
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
					Tell SureWord about yourself in your own words: where you are in your walk with the
					Lord, your church background, what you are studying, what you want from this app. The
					assistant reads this on every conversation. Leave it blank and it learns only from what
					you say in chat.
				</p>

				{aboutMe === null ? (
					<div className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3">
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							{loadFailed ? "Couldn't load your About me." : "Loading About me…"}
						</p>
						{loadFailed ? (
							<button
								type="button"
								onClick={() => void retryLoad()}
								className="min-h-11 px-3 text-xs font-bold text-amber-600 dark:text-amber-400"
							>
								Retry
							</button>
						) : null}
					</div>
				) : (
					<>
						<label className="min-w-0">
							<span className="sr-only">About me</span>
							<textarea
								value={draft}
								onChange={(event) => change(event.target.value)}
								maxLength={MAX_ABOUT_ME_LENGTH}
								rows={5}
								placeholder="I came to the Lord two years ago and I am reading through the Gospels…"
								className="w-full resize-y rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 py-2 text-sm leading-6 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15"
							/>
						</label>

						{/* Its own line rather than the status slot below, so it keeps
						    counting while "Unsaved changes" is showing. */}
						<p className="text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
							{draft.length} / {MAX_ABOUT_ME_LENGTH}
						</p>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
							<p
								aria-live="polite"
								className={`min-w-0 flex-1 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}
							>
								{error
									? error
									: saving
										? "Saving to your account…"
										: dirty
											? "Unsaved changes"
											: saved
												? "Saved to your account"
												: ""}
							</p>
							{/* Dark ink on the amber fill in both themes, for the contrast
							    reason documented on the highlight labels Save button. */}
							<button
								type="button"
								onClick={() => void save()}
								disabled={saving || !dirty}
								className="min-h-11 flex-shrink-0 rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}

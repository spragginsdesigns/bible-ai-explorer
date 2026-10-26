"use client";

import React from "react";
import { readTextScalePref } from "@/lib/preferences";
import { setTextScalePreference, usePreference } from "@/lib/preferencesSync";
import { spotlightTarget } from "@/lib/spotlight";
import { DEFAULT_TEXT_SCALE, TEXT_SCALES, TEXT_SCALE_FACTORS, TEXT_SCALE_LABELS } from "@/lib/text-scale";

/**
 * Settings → Appearance → Text size: the same three sizes as the welcome's
 * first card, saved to the account and applied to the whole app at once. Each
 * button draws its label at its own size, so the choice previews itself.
 */
export default function TextSizeControl({ mounted }: { mounted: boolean }) {
	const scale = usePreference(readTextScalePref, DEFAULT_TEXT_SCALE);
	return (
		<div {...spotlightTarget("settings.textSize")} className="flex flex-col gap-2 p-4">
			<div role="radiogroup" aria-label="Text size" className="grid grid-cols-3 gap-2">
				{TEXT_SCALES.map((option) => {
					const active = mounted && scale === option;
					return (
						<button
							key={option}
							type="button"
							role="radio"
							aria-checked={active}
							disabled={!mounted}
							onClick={() => void setTextScalePreference(option)}
							// Divided by the applied scale so each label shows its true size.
							style={{ fontSize: `calc(0.9375rem * ${TEXT_SCALE_FACTORS[option]} / var(--sw-text-scale, 1))` }}
							className={`flex min-h-[48px] items-center justify-center rounded-xl border font-bold transition-colors disabled:opacity-50 ${
								active
									? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400"
									: "border-black/[0.1] bg-black/[0.03] text-neutral-500 hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
							}`}
						>
							{TEXT_SCALE_LABELS[option]}
						</button>
					);
				})}
			</div>
			<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
				Makes everything in SureWord larger, on top of your browser&apos;s own text size.
			</p>
		</div>
	);
}

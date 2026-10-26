/**
 * Where each spotlight target lives, so "Show me" can take the reader there
 * before lighting it up. Tab targets stay put: the tab bar is on every main
 * screen. Pure, for the logic tests.
 */
export type SpotlightHref =
	| string
	| { pathname: string; params: Record<string, string> };

/** John 3 opens on the reader for the last tour stop, on John 3:16. */
export const TOUR_READER_HREF: SpotlightHref = {
	pathname: "/bible/chapter",
	params: { book: "43", chapter: "3", verse: "16" },
};

const TARGET_HREFS: Readonly<Record<string, SpotlightHref | null>> = {
	"tab.today": null,
	"tab.bible": null,
	"tab.chat": null,
	"tab.study": null,
	"tab.connections": null,
	"today.cross": "/today",
	"today.learn": "/today",
	"today.plan": "/today",
	"reader.verse": TOUR_READER_HREF,
	"study.sermons": "/study",
	"study.notes": "/study",
	"settings.church": "/settings",
	"settings.textSize": "/settings/appearance",
	"chat.mic": "/",
	tour: null,
};

/** Null: no navigation needed (or an unknown target, which is skipped). */
export function hrefForTarget(target: string): SpotlightHref | null {
	return Object.prototype.hasOwnProperty.call(TARGET_HREFS, target) ? TARGET_HREFS[target] : null;
}

export function isKnownTarget(target: string): boolean {
	return Object.prototype.hasOwnProperty.call(TARGET_HREFS, target);
}

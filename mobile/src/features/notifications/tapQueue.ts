/**
 * Holds a notification tap until the tab navigator exists to receive it.
 *
 * Why this exists (issue #30): the tap that cold-launches the app is read in the
 * (app) layout, but `AIConsentPresenter` keeps `<Tabs>` out of the tree until
 * the consent gate is configured. A `router.push("/today/cross")` sent in that
 * window has no tab navigator to land in, so the root Stack handles it by
 * pushing a SECOND `(app)` shell. The cross screen inside that copy never
 * loaded, and Back popped the copy, whose cleanup cleared the shared consent
 * gate and left the original shell on "Opening SureWord..." until the app was
 * killed. Taps now wait here and are delivered by `NotificationTapOutlet`,
 * which only mounts beside the tabs.
 *
 * Pure and free of native imports so it can be unit tested.
 */
export type TapRoute<T> = (target: T) => void;

export interface TapQueue<T> {
	/** A tap arrived. Routed now if the navigator is attached, otherwise kept (latest wins). */
	deliver(target: T): void;
	/** The navigator is mounted: route anything pending, then route taps as they come. */
	attach(route: TapRoute<T>): () => void;
}

export function createTapQueue<T>(): TapQueue<T> {
	let pending: T | null = null;
	let route: TapRoute<T> | null = null;
	return {
		deliver(target) {
			if (route) route(target);
			else pending = target;
		},
		attach(next) {
			route = next;
			if (pending !== null) {
				const target = pending;
				pending = null;
				next(target);
			}
			return () => {
				if (route === next) route = null;
			};
		},
	};
}

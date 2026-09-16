"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
	'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface ModalFocusOptions {
	/** Whether the surface is currently presented as a modal. */
	open: boolean;
	/** Called when Escape is pressed while the surface is open. */
	onClose: () => void;
	/**
	 * Control that should take initial focus instead of the first tabbable one
	 * (the Add-to-note search field, for instance).
	 */
	initialFocusRef?: RefObject<HTMLElement | null>;
	/**
	 * Stop containing Tab once focus has already left the container. The
	 * sidebar hosts Clerk's UserButton, whose menu renders in a portal outside
	 * the aside; without this the trap would drag focus back out of that menu.
	 */
	allowPortalFocus?: boolean;
	/**
	 * Mark the container `inert` whenever it is closed. For a surface that stays
	 * mounted while hidden (the mobile sidebar drawer, translated off-screen)
	 * this is what keeps its links out of the tab order and the accessibility
	 * tree; surfaces that unmount when closed do not need it.
	 */
	inertWhenClosed?: boolean;
}

/**
 * The modal focus lifecycle shared by the app's dialog surfaces: remember the
 * trigger, move focus inside, close on Escape, cycle Tab within the container,
 * and hand focus back to the trigger on close.
 *
 * Returns the ref to attach to the container element.
 */
export function useModalFocus<T extends HTMLElement>(
	options: ModalFocusOptions
): RefObject<T> {
	const containerRef = useRef<T>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const { open, inertWhenClosed = false } = options;

	// Declared before the focus effect on purpose. React runs every cleanup
	// before any effect, and effects in call order, so opening clears `inert`
	// before focus moves inside (focusing into an inert subtree is a no-op) and
	// closing restores focus to the trigger before the container goes inert.
	// The attribute is set here rather than in JSX because React 18 discards
	// attributes it does not recognise when the value is a boolean.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (inertWhenClosed && !open) container.setAttribute("inert", "");
		else container.removeAttribute("inert");
	}, [inertWhenClosed, open]);

	useEffect(() => {
		if (!open) return;
		const container = containerRef.current;
		if (!container) return;
		const trigger =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const controls = () =>
			Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
				(element) =>
					element.tabIndex >= 0 &&
					element.getClientRects().length > 0 &&
					getComputedStyle(element).visibility !== "hidden"
			);
		(
			optionsRef.current.initialFocusRef?.current ??
			controls()[0] ??
			container
		).focus();

		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				optionsRef.current.onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const active =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			if (
				optionsRef.current.allowPortalFocus &&
				(!active || !container.contains(active))
			) {
				return;
			}
			event.preventDefault();
			const available = controls();
			if (!available.length) {
				container.focus();
				return;
			}
			const index = active ? available.indexOf(active) : -1;
			const next =
				index < 0
					? event.shiftKey
						? available.length - 1
						: 0
					: (index + (event.shiftKey ? -1 : 1) + available.length) %
						available.length;
			available[next].focus();
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			if (trigger?.isConnected) trigger.focus();
		};
	}, [open]);

	return containerRef;
}

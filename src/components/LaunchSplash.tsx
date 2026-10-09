"use client";

import Image from "next/image";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import styles from "./LaunchSplash.module.css";

let launched = false;

/** The public landing page stays immediate; signed-in app entry gets the reveal. */
export default function LaunchSplash() {
	const { isSignedIn } = useUser();
	return isSignedIn ? <LaunchSplashPlayback /> : null;
}

/** Shared playback view, also used by the local visual QA harness. */
export function LaunchSplashPlayback() {
	const [visible, setVisible] = useState(false);
	const [generation, setGeneration] = useState(0);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const show = () => { setReady(false); setGeneration((value) => value + 1); setVisible(true); };
		if (!launched) { launched = true; show(); }
		let backgrounded = false;
		const visibility = () => {
			if (document.hidden) { backgrounded = true; setVisible(false); }
			else if (backgrounded) { backgrounded = false; show(); }
		};
		document.addEventListener("visibilitychange", visibility);
		return () => document.removeEventListener("visibilitychange", visibility);
	}, []);

	useEffect(() => {
		if (!visible) return;
		const timeout = setTimeout(() => setVisible(false), ready ? 1_870 : 3_000);
		const skip = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			setVisible(false);
		};
		// Consume the dismissal before a focused composer can submit a hidden draft.
		window.addEventListener("keydown", skip, true);
		return () => { clearTimeout(timeout); window.removeEventListener("keydown", skip, true); };
	}, [ready, visible, generation]);

	if (!visible) return null;
	return (
		<div key={generation} aria-hidden="true" className={`${styles.splash} ${ready ? styles.ready : ""}`}
			onClick={() => setVisible(false)}>
			<Image src="/splash/sureword-dawn.webp" alt="" fill priority sizes="100vw"
				onLoad={() => setReady(true)} onError={() => setVisible(false)} className={styles.art} />
			<div className={styles.shade} />
			<div className={styles.veil} />
			<p className={styles.brand}>SureWord</p>
			<div className={styles.message}>
				<p className={styles.headline}>Your walk with God.</p>
				<p className={styles.subtitle}>One step at a time.</p>
			</div>
		</div>
	);
}

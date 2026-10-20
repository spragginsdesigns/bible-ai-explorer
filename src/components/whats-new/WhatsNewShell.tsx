import Image from "next/image";
import Link from "next/link";
import { WHATS_NEW_BEGINNING, WHATS_NEW_ENTRIES } from "@/lib/whats-new";
import HeaderAction from "./HeaderAction";
import ReleaseJournal from "./ReleaseJournal";
import styles from "./whats-new.module.css";

/**
 * The public release notes page, for readers signed in or out. The iPhone app
 * opens it too, so it carries no price and no purchase link (the same rule as
 * /support and /privacy).
 */
export default function WhatsNewShell({ initialVersion }: { initialVersion: string }) {
	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<Link href="/" className={styles.brand}>
					<Image src="/favicon-96x96.png" alt="" width={32} height={32} unoptimized />
					SureWord
				</Link>
				<HeaderAction className={styles.headerAction} />
			</header>

			<div className={styles.heroWrap}>
				<div className={styles.heroArt} aria-hidden />
				<section className={styles.hero}>
					<p className={styles.crumbs}>SureWord / What&apos;s new</p>
					<h1 className={styles.title}>
						Every update. <em>All here.</em>
					</h1>
					<p className={styles.subtitle}>What changed, why, and what it means for your study.</p>
				</section>
			</div>

			<div className={styles.content}>
				<ReleaseJournal entries={WHATS_NEW_ENTRIES} beginning={WHATS_NEW_BEGINNING} initialVersion={initialVersion} />
			</div>

			<footer className={`${styles.content} ${styles.footer}`}>
				Version numbers are the Android app&apos;s, where SureWord&apos;s features arrive first. Questions?{" "}
				<Link href="/support">Contact support</Link>.
			</footer>
		</main>
	);
}

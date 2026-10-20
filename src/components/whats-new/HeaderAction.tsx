"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

/** Readers with an account go back into the app; everyone else meets SureWord. */
export default function HeaderAction({ className }: { className: string }) {
	const { isLoaded, isSignedIn } = useAuth();
	if (!isLoaded) return null;
	return isSignedIn ? (
		<Link href="/today" className={className}>
			Open SureWord
		</Link>
	) : (
		<Link href="/" className={className}>
			Try SureWord
		</Link>
	);
}

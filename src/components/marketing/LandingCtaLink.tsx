"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackLandingCta, type LandingCta } from "@/lib/analytics/client";

/**
 * A landing-page link that names itself to analytics on the way out. The
 * page is a server component, and an onClick needs a client boundary; this
 * is that boundary, one link wide, so the rest of the page stays static.
 */
export default function LandingCtaLink({
	cta,
	onClick,
	...props
}: ComponentProps<typeof Link> & { cta: LandingCta }) {
	return (
		<Link
			{...props}
			onClick={(event) => {
				trackLandingCta(cta);
				onClick?.(event);
			}}
		/>
	);
}

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
	"/sign-in(.*)",
	"/sign-up(.*)",
	"/api/webhooks(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

/**
 * Deny by default and send signed-out visitors to our own /sign-in.
 *
 * There is no Frontend API proxy any more. Clerk now runs on clerk.sureword.app
 * via ordinary CNAME records, which is its supported setup. The proxy only ever
 * existed because the app was served from a *.vercel.app host, which Clerk
 * refuses for production instances outright, and it cost five separate bugs
 * before being deleted.
 *
 * auth.protect() is deliberately not used: it resolves the sign-in destination
 * to the hosted Account Portal, and when that host was unreachable it fell back
 * to rewriting every page to /_not-found - a site-wide 404 with no error
 * anywhere. Redirecting explicitly keeps the destination a fact of this file.
 */
export default clerkMiddleware(
	async (auth, request) => {
		if (isPublicRoute(request)) return;

		const { userId } = await auth();
		if (userId) return;

		// API callers get a status they can act on rather than an HTML login
		// page. The mobile client depends on this: it retries once with a fresh
		// token on 401.
		if (isApiRoute(request)) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const signInUrl = new URL("/sign-in", request.url);
		signInUrl.searchParams.set("redirect_url", request.url);
		return NextResponse.redirect(signInUrl);
});

export const config = {
	matcher: [
		// Skip Next.js internals and all static files
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};

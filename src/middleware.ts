import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
	"/sign-in(.*)",
	"/sign-up(.*)",
	"/api/webhooks(.*)",
	// Clerk's built-in Frontend API proxy answers here and carries the sign-in
	// traffic itself, so protecting it would deadlock: you would need a session
	// to make the calls that create a session.
	"/__clerk(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

/**
 * Deny by default, send signed-out visitors to our own /sign-in, and proxy the
 * Clerk Frontend API through this origin.
 *
 * The proxy is required because the app is served from a *.vercel.app host,
 * where the CNAME records a normal Clerk production instance needs cannot be
 * created. This uses Clerk's own frontendApiProxy rather than a hand-written
 * route handler: the handshake, cookie rewriting and redirect handling are
 * fiddly enough that a bespoke version got five of them wrong in a row
 * (merged Set-Cookie headers, cookies scoped to Clerk's domain, relative
 * redirects losing the path prefix, an over-broad fix for that, and finally an
 * OAuth callback Clerk kept rejecting as authorization_invalid).
 *
 * auth.protect() is deliberately not used: on this instance it resolved the
 * sign-in destination to the hosted Account Portal at
 * accounts.bible-ai-explorer.vercel.app, which cannot exist, and then fell back
 * to rewriting every page to /_not-found.
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
	},
	{ frontendApiProxy: { enabled: true } }
);

export const config = {
	matcher: [
		// Skip Next.js internals and all static files
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
		// Always run for the Clerk proxy path
		"/__clerk/(.*)",
	],
};

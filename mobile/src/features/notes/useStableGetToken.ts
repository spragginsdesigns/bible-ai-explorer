import { useCallback, useRef } from "react";
import { useAuth } from "@clerk/clerk-expo";
import type { GetToken } from "@/lib/api";

/**
 * Clerk hands back a new `getToken` identity on most renders, which would churn
 * every useCallback/useMemo that depends on it. This keeps a stable reference.
 * `{ fresh: true }` skips the token cache (used by the API layer's 401 retry).
 */
export function useStableGetToken(): GetToken {
	const { getToken } = useAuth();
	const ref = useRef(getToken);
	ref.current = getToken;
	return useCallback<GetToken>(
		(opts) => ref.current(opts?.fresh ? { skipCache: true } : undefined),
		[]
	);
}

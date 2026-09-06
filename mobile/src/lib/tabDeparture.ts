type DepartureGuard = () => Promise<boolean>;
let activeGuard: DepartureGuard | null = null;

/** Only the focused editor may hold tab navigation while its document saves. */
export function registerTabDepartureGuard(guard: DepartureGuard): () => void {
	activeGuard = guard;
	return () => {
		if (activeGuard === guard) activeGuard = null;
	};
}

/** Run before tabPress: that event can itself pop a focused nested stack. */
export async function afterTabDepartureGuard(navigate: () => void): Promise<boolean> {
	const guard = activeGuard;
	if (guard) {
		try {
			if (!(await guard()) || activeGuard !== guard) return false;
		} catch {
			return false;
		}
	}
	navigate();
	return true;
}

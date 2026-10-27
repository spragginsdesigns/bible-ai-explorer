import { LIBRARY_MAP_SOURCES, compileLibraryMap } from "./library-data";
import { checkConceptMap, type ConceptMap } from "./map-rules";
import { MAP_BOOKS } from "./passages";

/**
 * The ready-made maps, checked and canonical. `tests/beta-maps.test.mjs`
 * checks the same sources verse by verse against the bundled KJV, so a bad
 * passage fails the test suite long before it could reach this throw.
 */
export const LIBRARY_MAPS: readonly (ConceptMap & { slug: string })[] = LIBRARY_MAP_SOURCES.map((source) => {
	const checked = checkConceptMap(compileLibraryMap(source), { books: MAP_BOOKS });
	if (!checked.ok) throw new Error(`Concept map "${source.slug}": ${checked.error}`);
	return { ...checked.value, slug: source.slug };
});

export function findLibraryMap(slug: string): (ConceptMap & { slug: string }) | null {
	return LIBRARY_MAPS.find((map) => map.slug === slug) ?? null;
}

import "server-only";

import { FOUNDATIONS_PATH } from "./content/foundations";
import { LIFE_OF_PAUL_PATH } from "./content/life-of-paul";
import { READING_SCRIPTURE_PATH } from "./content/reading-scripture";
import { ROMANS_PATH } from "./content/romans";
import type { PathDef } from "./paths-types";

/**
 * The written Learning Paths (LC-17648), in the order the hub lists them.
 * Server only: a page sends the browser the one lesson being taken, never the
 * whole bank of questions and answers.
 */
export const WRITTEN_PATHS: readonly PathDef[] = [FOUNDATIONS_PATH, ROMANS_PATH, READING_SCRIPTURE_PATH, LIFE_OF_PAUL_PATH];

export function writtenPath(id: string): PathDef | null {
	return WRITTEN_PATHS.find((path) => path.id === id) ?? null;
}

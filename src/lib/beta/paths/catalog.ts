import "server-only";

import { DOCTRINES_COURSE } from "./content/doctrines";
import { FOUNDATIONS_PATH } from "./content/foundations";
import { LIFE_OF_PAUL_PATH } from "./content/life-of-paul";
import { NT_SURVEY_COURSE } from "./content/nt-survey";
import { OT_SURVEY_COURSE } from "./content/ot-survey";
import { READING_SCRIPTURE_PATH } from "./content/reading-scripture";
import { ROMANS_PATH } from "./content/romans";
import type { PathDef } from "./paths-types";

/**
 * The written Learning Paths (LC-17648), in the order the hub lists them.
 * Server only: a page sends the browser the one lesson being taken, never the
 * whole bank of questions and answers.
 */
export const WRITTEN_PATHS: readonly PathDef[] = [FOUNDATIONS_PATH, ROMANS_PATH, READING_SCRIPTURE_PATH, LIFE_OF_PAUL_PATH];

/**
 * SureWord Academy's courses (LC-17660, docs/beta/academy.md): written paths
 * with a course part on every lesson and a final review. Paths serves their
 * sessions like any written path; Academy lists them, the hub here does not.
 */
export const WRITTEN_COURSES: readonly PathDef[] = [OT_SURVEY_COURSE, NT_SURVEY_COURSE, DOCTRINES_COURSE];

/** A written path or course by id. */
export function writtenPath(id: string): PathDef | null {
	return WRITTEN_PATHS.find((path) => path.id === id) ?? WRITTEN_COURSES.find((course) => course.id === id) ?? null;
}

/** A written course by id, or null for a path or anything else. */
export function writtenCourse(id: string): PathDef | null {
	return WRITTEN_COURSES.find((course) => course.id === id) ?? null;
}

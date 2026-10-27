import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProjectReader from "@/components/beta/projects/ProjectReader";
import { betaMetadata, currentBetaUserId, requireBetaPage } from "@/lib/beta/access";
import { bookByOrder } from "@/lib/bible/books";
import { bookName, kjvChapter, loadProject, projectView } from "@/lib/beta/projects/projects";
import { readHref, sectionAfter } from "@/lib/beta/projects/projects-rules";

type Props = {
	params: Promise<{ projectId: string }>;
	searchParams: Promise<{ section?: string; book?: string; chapter?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { projectId } = await params;
	const userId = await currentBetaUserId();
	const project = userId ? await loadProject(userId, projectId) : null;
	return betaMetadata({ title: project ? `Reading · ${project.item.title}` : "Study Projects" });
}

function positive(value: string | undefined): number | null {
	if (!value || !/^\d{1,3}$/.test(value)) return null;
	const n = Number(value);
	return n >= 1 ? n : null;
}

/**
 * A chapter read inside a project, from the bundled KJV: the section
 * "Continue study" opens, or any chapter the founder picks to choose verses
 * from. ?section=<id> and/or ?book=<1-66>&chapter=<n>.
 */
export default async function BetaStudyProjectReadPage({ params, searchParams }: Props) {
	const userId = await requireBetaPage();
	const { projectId } = await params;
	const query = await searchParams;
	const project = await projectView(userId, projectId);
	if (!project) notFound();

	const section = query.section ? project.sections.find((entry) => entry.id === query.section) ?? null : null;
	if (query.section && !section) notFound();
	let book = positive(query.book);
	let chapter = positive(query.chapter);
	if ((book === null) !== (chapter === null)) notFound();
	if (book === null && section?.ref) [book, chapter] = section.ref.split(".").map(Number);
	const meta = book === null ? null : bookByOrder(book);
	if (book !== null && (!meta || chapter === null || chapter > meta.chapters)) notFound();

	const verses = meta && chapter ? await kjvChapter(meta.order, chapter) : null;
	const gathered = meta && chapter
		? project.passages
				.filter((passage) => passage.book === meta.order && passage.chapter === chapter)
				.map((passage) => ({ start: passage.start ?? 1, end: passage.end ?? verses!.length, reference: passage.reference }))
		: [];
	const nextSection = section ? sectionAfter(project.sections, section.id) : null;

	// A book study steps through its own chapters; a picked chapter steps through its book.
	let prevHref: string | null = null;
	let nextHref: string | null = null;
	if (meta && chapter) {
		if (section && project.scope.type === "book") {
			const index = project.sections.findIndex((entry) => entry.id === section.id);
			const prev = project.sections[index - 1];
			const after = project.sections[index + 1];
			prevHref = prev ? readHref(project.id, { section: prev.id }) : null;
			nextHref = after ? readHref(project.id, { section: after.id }) : null;
		} else if (!section) {
			prevHref = chapter > 1 ? readHref(project.id, { book: meta.order, chapter: chapter - 1 }) : null;
			nextHref = chapter < meta.chapters ? readHref(project.id, { book: meta.order, chapter: chapter + 1 }) : null;
		}
	}

	return (
		<ProjectReader
			key={`${section?.id ?? ""}:${book}:${chapter}`}
			projectId={project.id}
			projectTitle={project.title}
			section={section ? { id: section.id, title: section.title, done: section.done } : null}
			next={nextSection ? { id: nextSection.id, title: nextSection.title } : null}
			chapter={meta && chapter && verses ? { book: meta.order, bookName: bookName(meta.order), chapter, chapters: meta.chapters, verses } : null}
			gathered={gathered}
			prevHref={prevHref}
			nextHref={nextHref}
		/>
	);
}

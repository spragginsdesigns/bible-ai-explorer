export type LearnStage = 0 | 1 | 2 | 3;
export interface LearnCard {
 id: string; book: number; chapter: number; verse: number;
 translation: "KJV" | "NKJV"; reference: string; text: string;
 stage: LearnStage; intervalDays: number; dueAt: string; knownAt: string | null;
}
export interface LearnToday { cards: LearnCard[]; knownCount: number; queueCount: number }
export interface VerseWord { text: string; hidden: boolean; blank: string }
/** Whitespace defines a word; punctuation surrounding a blank remains visible. */
export function verseWords(text: string, stage: LearnStage): VerseWord[] {
 return text.trim().split(/\s+/).filter(Boolean).map((word, index) => {
  const prefix = word.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
  const suffix = word.slice(prefix.length).match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
  return { text: word, hidden: stage === 3 || (stage === 1 && index % 4 === 3) || (stage === 2 && index % 2 === 1), blank: prefix + "____" + suffix };
 });
}
export function maskVerse(text: string, stage: LearnStage): string {
 return verseWords(text, stage).map(word => word.hidden ? word.blank : word.text).join(" ");
}
export function parseCard(value: unknown): LearnCard {
 const card = value as Partial<LearnCard> | null;
 if (!card || typeof card.id !== "string" || !card.id ||
  !Number.isInteger(card.book) || card.book! < 1 || card.book! > 66 ||
  !Number.isInteger(card.chapter) || card.chapter! < 1 ||
  !Number.isInteger(card.verse) || card.verse! < 1 ||
  !["KJV", "NKJV"].includes(card.translation!) ||
  typeof card.reference !== "string" || typeof card.text !== "string" || !card.text.trim() ||
  ![0,1,2,3].includes(card.stage!) || !Number.isInteger(card.intervalDays) || card.intervalDays! < 0 ||
  typeof card.dueAt !== "string" || !Number.isFinite(Date.parse(card.dueAt)) ||
  !(card.knownAt === null || (typeof card.knownAt === "string" && Number.isFinite(Date.parse(card.knownAt))))) {
  throw new Error("Learn returned an invalid verse. Please reload.");
 }
 return card as LearnCard;
}
export function parseToday(value: unknown): LearnToday {
 const today = value as Partial<LearnToday> | null;
 if (!today || !Array.isArray(today.cards) || today.cards.length > 3 ||
  !Number.isInteger(today.knownCount) || today.knownCount! < 0 ||
  !Number.isInteger(today.queueCount) || today.queueCount! < 0) {
  throw new Error("Learn returned an invalid queue. Please reload.");
 }
 const cards = today.cards.map(parseCard);
 if (new Set(cards.map(card => card.id)).size !== cards.length) throw new Error("Learn returned duplicate verses.");
 return { cards, knownCount: today.knownCount!, queueCount: today.queueCount! };
}
/** Keep same-day ladder stages on screen; a completed stage-3 review leaves today. */
export function applyReview(today: LearnToday, before: LearnCard, updated: LearnCard, result: "again" | "good"): LearnToday {
 if (updated.id !== before.id) throw new Error("The review returned a different verse. Please reload.");
 const finished = result === "good" && before.stage === 3 && updated.intervalDays > 0;
 return {
  ...today,
  knownCount: today.knownCount + (!before.knownAt && updated.knownAt ? 1 : 0),
  cards: finished ? today.cards.filter(card => card.id !== before.id) : today.cards.map(card => card.id === before.id ? updated : card),
 };
}


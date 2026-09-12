import { parseCard, type LearnCard } from "./learn";

export interface LearnVerseInput {
  book: number;
  chapter: number;
  verse: number;
  translation: "KJV" | "NKJV";
  source: "sheet" | "highlight" | "chat";
}

export async function addLearnVerse(input: LearnVerseInput): Promise<LearnCard> {
  const response = await fetch("/api/learn", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("The verse could not be added. Check your connection and try again.");
  return parseCard(await response.json());
}

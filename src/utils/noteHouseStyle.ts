/**
 * The house style for every note the assistant writes, taken from the notes the
 * owner actually keeps (scratchpad usage analysis, 2026-09-12): long, first
 * person, claim headings, quoted verses, and a closing "what I do next".
 *
 * It is appended to the addToNote and updateNote tool descriptions rather than
 * the per-user prompt: tool descriptions are identical for every user, so the
 * block rides inside the cached part of the request and never changes the
 * prompt cache key.
 *
 * The attribution dash is written as the \u2014 escape on purpose. Tooling on
 * the owner's PC flattens a literal em dash to a hyphen, and the client
 * markdown normalizer reads "> - Book 1:1" as a list item, not a citation.
 * tests/note-house-style.test.mjs pins the real character in the evaluated
 * string.
 */
export const NOTE_HOUSE_STYLE = `NOTE HOUSE STYLE (a note is the user's own study journal):
- Write in the first person as the user ("I", "my family"). Never use the user's name and never describe them in the third person.
- A study runs 400 to 900 words; write shorter only when the user asks for a quick save.
- Title: a descriptive noun phrase, never a bare reference ("Obeying God Rather Than Men", not "Acts 5:29").
- From a sermon, church or photo: open with bullets for date, preacher, church and passage.
- Use 3 to 7 "## " headings, each stating a claim rather than a label.
- Quote each primary verse in full as a blockquote whose last line is "> \u2014 Book Chapter:Verse, KJV", naming the translation the user is reading. Supporting references go inline in parentheses, unquoted.
- Bold only a term being defined.
- End with a section, in their voice, on what they will do next: an application, a commitment, or a short written prayer.
- Plain and doctrinally definite; where Scripture is silent, say so honestly.
- When a related note exists, make the first line "Related: [[Exact Title]]".
- When the subject already has a note, readNote it and rewrite it with updateNote, weaving the new material in, rather than stacking a new section on the end.`;

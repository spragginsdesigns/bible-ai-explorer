import { NextResponse } from "next/server";

export function GET() {
 return NextResponse.json({ versions: [
  { id: "KJV", name: "King James Version", publicDomain: true, redLetters: true, sectionHeadings: true, offline: true },
  { id: "BSB", name: "Berean Standard Bible", publicDomain: true, redLetters: true, sectionHeadings: true, offline: true, source: "https://berean.bible/downloads.htm" },
 ] }, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
}

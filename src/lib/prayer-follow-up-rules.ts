/** A loaded request is not a delivered follow-up. Match the actual question. */
export function deliveredPrayerFollowUps(text: string, prayers: readonly { id: string; content: string }[]): string[] {
  const stop=new Set(["pray","prayer","please","about","with","that","the","for","and","your","have","this","you","asked","request","their","her","his","next"]);
  const words=(value:string)=>[...new Set(value.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]/g," ").split(/\s+/).map(word=>["mom","mum","mother"].includes(word)?"mother":["dad","father"].includes(word)?"father":word).filter(word=>word.length>2&&!stop.has(word)))];
  const sentences=text.split(/(?<=[.!?])\s+|\n/).map(part=>part.trim());
  const questions=sentences.flatMap((sentence,index)=>{
    if(!sentence.endsWith("?")||!/how.{0,50}(?:go|doing|been|\bis\b|\bare\b)|how(?:'s| is| are)|any news|did.{0,50}go|what happened/i.test(sentence))return [];
    const previous=sentences[index-1]??"";
    const referential=/^how did (?:it|that) go|^any news|^how (?:is|are) (?:it|that|things|they)/i.test(sentence);
    return [referential&&/you asked.{0,30}pray|prayer request|checking in/i.test(previous)?previous+" "+sentence:sentence];
  });
  for(const prayer of prayers){
    const needles=words(prayer.content).slice(0,8);
    if(needles.length&&questions.some(question=>{const haystack=new Set(words(question));return needles.filter(word=>haystack.has(word)).length>=Math.min(2,needles.length);}))return [prayer.id];
  }
  return [];
}

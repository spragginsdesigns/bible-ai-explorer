/** Remove question scaffolding before consulting the exact-word index. */
const STOPWORDS = new Set("a an and are as at be but by for from has have he her his i in is it its me my of on or our shall she that the their them they this to unto us was we what when who will with you your thou thee thy ye him verse verses bible say says said about does scripture scriptures teach teaches meaning explain".split(" "));

export function searchWords(query: string): string {
	return [...new Set(query.toLowerCase().replace(/[^a-z0-9'" -]/g, " ").split(/\s+/).filter(word => word && !STOPWORDS.has(word)))].slice(0, 16).join(" ");
}

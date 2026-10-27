import BetaHome from "@/components/beta/BetaHome";
import { requireBetaPage } from "@/lib/beta/access";

export default async function BetaHomePage() {
	await requireBetaPage();
	return <BetaHome />;
}

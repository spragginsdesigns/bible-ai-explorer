/** Run with tsx and React's server condition after deploying the schema:
 * NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/backfill-reading-history.ts
 * Use --user=<Clerk ID> to limit the run. Each 50-row transaction stores its
 * durable cursor. Interrupting and rerunning is safe. Never deletes old rows.
 */
import { prisma } from "../src/lib/prisma";
import { backfillReadingHistoryBatch } from "../src/lib/reading-log";

async function main() {
	const userArg = process.argv.find((arg) => arg.startsWith("--user="))?.slice(7);
	let after: string | undefined;
	let accounts = 0;
	let entries = 0;
	do {
		const users = await prisma.user.findMany({
			where: userArg ? { id: userArg } : after ? { id: { gt: after } } : {},
			orderBy: { id: "asc" },
			take: 100,
			select: { id: true },
		});
		if (!users.length) break;
		for (const user of users) {
			let result;
			do {
				result = await backfillReadingHistoryBatch(user.id, 50);
				entries += result.migrated;
			} while (!result.complete);
			accounts++;
		}
		after = users[users.length - 1].id;
		console.info(JSON.stringify({ accounts, entries, lastAccount: after }));
		if (userArg) break;
	} while (true);
}
main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());

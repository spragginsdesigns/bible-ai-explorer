import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A real server-side SQL deadline; a timed-out caller must not leave an expensive query running. */
export function searchQuery<T>(query: Prisma.Sql): Promise<T[]> {
	return prisma.$transaction(async tx => {
		await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
		return tx.$queryRaw<T[]>(query);
	}, { maxWait: 1000, timeout: 6000 });
}

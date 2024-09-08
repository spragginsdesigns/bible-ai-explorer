import { DataAPIClient } from "@datastax/astra-db-ts";

// Initialize the client
const client = new DataAPIClient(process.env.ASTRA_DB_TOKEN as string);
const db = client.db(process.env.ASTRA_DB_ENDPOINT as string, {
	namespace: "default_keyspace"
});

export const astraDb = db;

export async function testAstraDbConnection() {
	try {
		const colls = await db.listCollections();
		console.log("Connected to AstraDB:", colls);
		return true;
	} catch (error) {
		console.error("Failed to connect to AstraDB:", error);
		return false;
	}
}

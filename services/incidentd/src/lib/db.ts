import { relations } from "@fire/db/relations";
import * as schema from "@fire/db/schema";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

type DBSchema = typeof schema;
type DBRelations = typeof relations;

let db: NodePgDatabase<DBSchema, DBRelations>;
export function getDB(hyperdrive: Hyperdrive): NodePgDatabase<DBSchema, DBRelations> {
	if (db) {
		return db;
	}
	// requires pg being installed
	db = drizzle(hyperdrive.connectionString, { schema, relations });
	return db;
}

import { relations } from "@fire/db/relations";
import * as schema from "@fire/db/schema";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

type DBSchema = typeof schema;
type DBRelations = typeof relations;

export function getDB(hyperdrive: Hyperdrive): NodePgDatabase<DBSchema, DBRelations> {
	// requires pg being installed
	return drizzle(hyperdrive.connectionString, { schema, relations });
}

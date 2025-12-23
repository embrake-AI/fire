import * as schema from "@fire/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";

export function getDB(hyperdrive: Hyperdrive) {
	// requires pg being installed
	return drizzle(hyperdrive.connectionString, { schema });
}

import * as schema from "@fire/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Creates a database connection using Hyperdrive.
 *
 * Note: We create a new client per request because Hyperdrive handles
 * connection pooling on the edge. The postgres-js client is lightweight
 * and designed for this pattern.
 *
 * @see https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
 */
export function getDB(hyperdrive: Hyperdrive) {
	const client = postgres(hyperdrive.connectionString, {
		// Limit connections per Worker request due to Workers' limits on concurrent external connections
		max: 5,
	});
	return drizzle(client, { schema });
}

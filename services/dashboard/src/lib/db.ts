import { relations } from "@fire/db/relations";
import * as schema from "@fire/db/schema";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import ca from "~/certs/tigerdata-chain.pem?raw" with { type: "text" };

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		ca,
		rejectUnauthorized: true,
	},
	max: 2,
	connectionTimeoutMillis: 2_000,
	allowExitOnIdle: true,
	query_timeout: 2_000,
	statement_timeout: 2_000,
});

attachDatabasePool(pool);
export const db = drizzle({
	schema,
	relations,
	client: pool,
});

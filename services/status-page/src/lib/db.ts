import { relations } from "@fire/db/relations";
import * as schema from "@fire/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 1,
	connectionTimeoutMillis: 15_000,
	allowExitOnIdle: true,
	query_timeout: 30_000,
	statement_timeout: 30_000,
});

export const db = drizzle({
	schema,
	relations,
	client: pool,
});

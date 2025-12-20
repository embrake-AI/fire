import * as schema from "@fire/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import ca from "~/certs/tigerdata-chain.pem?raw" with { type: "text" };

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		ca,
		rejectUnauthorized: true,
	},
});

export const db = drizzle(pool, { schema });

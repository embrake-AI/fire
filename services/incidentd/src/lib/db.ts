import * as schema from "@fire/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
// import ca from "~/certs/tigerdata-chain.pem?raw" with { type: "text" }; TODO: think how to do this

let drizzleClient: ReturnType<typeof drizzle<typeof schema, Client>> | null = null;

export async function createConnection() {
    if (drizzleClient) return drizzleClient;
    const connection = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: true,
        },
    });
    drizzleClient = drizzle(connection, { schema });
    return drizzleClient;
}
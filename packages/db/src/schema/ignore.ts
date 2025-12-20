import { pgView } from "drizzle-orm/pg-core";

export const pgBuffercache = pgView("pg_buffercache", {}).existing();
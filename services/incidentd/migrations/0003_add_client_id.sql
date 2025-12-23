-- Migration number: 0003 	 2025-12-23T10:00:00.000Z
-- Step 1: Add client_id as nullable
ALTER TABLE incident ADD COLUMN client_id TEXT;

-- Step 2: Set default value for existing rows
UPDATE incident SET client_id = 'genesy' WHERE client_id IS NULL;

-- Step 3: Recreate table with NOT NULL constraint (SQLite doesn't support ALTER COLUMN)
CREATE TABLE incident_new (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'mitigating', 'resolved')),
    assignee TEXT,
    severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    client_id TEXT NOT NULL
);

INSERT INTO incident_new SELECT id, identifier, status, assignee, severity, createdAt, title, description, client_id FROM incident;
DROP TABLE incident;
ALTER TABLE incident_new RENAME TO incident;

-- Step 4: Create index for efficient tenant queries
CREATE INDEX idx_incident_client_id ON incident(client_id);


-- Migration number: 0001 	 2025-12-20T22:00:00.000Z
CREATE TABLE incident (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'mitigating', 'resolved')),
    assignee TEXT,
    severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

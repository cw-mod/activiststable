-- Idempotent schema for /opt/activiststable/data/activists.db.
-- Applied on every deploy. Does not drop or rewrite existing rows.
CREATE TABLE IF NOT EXISTS "Activist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "extId" TEXT NOT NULL,
    "categories" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Activist_extId_key" ON "Activist"("extId");

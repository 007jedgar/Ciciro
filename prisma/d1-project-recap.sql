-- "Previously on" recap cache (ProjectRecap). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-project-recap.sql
--
-- Until this runs, everything else works as before; only the recap errors
-- (the clients hide it quietly).

CREATE TABLE IF NOT EXISTS "ProjectRecap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectRecap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectRecap_projectId_key" ON "ProjectRecap"("projectId");

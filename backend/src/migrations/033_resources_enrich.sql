-- Add type and verified columns to resources table
ALTER TABLE resources ADD COLUMN IF NOT EXISTS type TEXT DEFAULT "resource";
ALTER TABLE resources ADD COLUMN IF NOT EXISTS verified INTEGER DEFAULT 0;

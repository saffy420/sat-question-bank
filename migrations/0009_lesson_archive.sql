-- Soft-delete templates without touching any session history or foreign key.
ALTER TABLE lessons ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));

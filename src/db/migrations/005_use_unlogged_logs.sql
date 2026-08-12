-- The benchmark contract does not require crash durability. UNLOGGED storage
-- removes WAL work from the single PostgreSQL CPU while preserving atomic
-- transactions, immediate query visibility, and clean-restart persistence.
ALTER TABLE logs SET UNLOGGED;

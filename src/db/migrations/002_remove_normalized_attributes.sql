DROP INDEX IF EXISTS logs_attributes_text_gin_idx;

ALTER TABLE logs
    DROP COLUMN attributes_text;

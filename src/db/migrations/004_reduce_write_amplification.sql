-- Aggregation no longer depends on the service paging index. Recent service
-- pages use the time-ordered primary key, avoiding one B-tree update per log.
DROP INDEX IF EXISTS logs_service_page_idx;

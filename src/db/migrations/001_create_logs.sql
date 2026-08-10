CREATE TABLE logs (
    id              uuid        NOT NULL,
    timestamp       timestamptz NOT NULL,
    level           text        NOT NULL
                    CHECK (level IN ('debug', 'info', 'warn', 'error')),
    service         text        NOT NULL CHECK (length(service) > 0),
    message         text        NOT NULL CHECK (length(message) > 0),
    attributes      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    attributes_text jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ingested_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (timestamp, id),
    CHECK (jsonb_typeof(attributes) = 'object'),
    CHECK (jsonb_typeof(attributes_text) = 'object')
);

CREATE INDEX logs_service_page_idx
    ON logs (service, timestamp DESC, id DESC);

CREATE INDEX logs_attributes_text_gin_idx
    ON logs USING gin (attributes_text jsonb_path_ops);

ALTER TABLE logs SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.01
);

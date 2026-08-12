-- The benchmark and common read-after-write clients use a unique marker for
-- visibility checks. Keep arbitrary attribute filtering correct via JSONB,
-- while giving this high-frequency equality shape a narrow index.
CREATE INDEX logs_attr_marker_hash_idx
    ON logs USING hash ((attributes ->> 'marker'))
    WHERE attributes ? 'marker';

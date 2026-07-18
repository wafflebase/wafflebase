-- Wafflebase view-analytics warehouse schema (local smoke-test stack).
-- Mirrors docs/design/share-link-analytics.md. A single flat append-only
-- event table; the backend aggregates at query time.
CREATE DATABASE IF NOT EXISTS wafflebase;

USE wafflebase;

-- StarRocks requires the DUPLICATE KEY columns to be the leading columns of
-- the schema, in order — so document_id/session_id/timestamp come first. The
-- JSON routine load maps by field name, so column order is free here.
CREATE TABLE IF NOT EXISTS view_events (
    document_id   VARCHAR(64),
    session_id    VARCHAR(64),
    timestamp     DATETIME,
    share_link_id VARCHAR(64),
    visitor_id    VARCHAR(64),
    user_id       VARCHAR(64),
    role          VARCHAR(16),
    event_type    VARCHAR(32),
    target        VARCHAR(128),
    doc_type      VARCHAR(16),
    user_agent    VARCHAR(64)
) ENGINE = OLAP
DUPLICATE KEY(document_id, session_id, timestamp)
DISTRIBUTED BY HASH(document_id) BUCKETS 16
PROPERTIES ("replication_num" = "1");

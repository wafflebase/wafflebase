-- Continuously ingest the wafflebase-view-events Kafka topic into
-- wafflebase.view_events. Broker uses the in-network listener (kafka:9092),
-- since StarRocks runs inside the compose network.
CREATE ROUTINE LOAD wafflebase.view_events ON view_events
PROPERTIES
(
    "format" = "JSON",
    "desired_concurrent_number" = "1"
)
FROM KAFKA
(
    "kafka_broker_list" = "kafka:9092",
    "kafka_topic" = "wafflebase-view-events",
    "property.group.id" = "wafflebase_view_events_group",
    "property.kafka_default_offsets" = "OFFSET_BEGINNING"
);

#!/bin/bash
# Create the wafflebase view-event topic (idempotent).
set -e

echo "Waiting for Kafka..."
until /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list >/dev/null 2>&1; do
  sleep 2
done

echo "Creating topic wafflebase-view-events"
/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
  --create --if-not-exists \
  --topic wafflebase-view-events \
  --replication-factor 1 --partitions 1

/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list

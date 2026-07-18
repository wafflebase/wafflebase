#!/bin/bash
# Create the wafflebase database + view_events table + Kafka routine load in
# StarRocks, then resume the routine load if it landed in PAUSED. Idempotent.
set -e

FE=starrocks
PORT=9030

echo "Waiting for StarRocks backend to be alive..."
until mysql -h "$FE" -P "$PORT" -u root -e "SHOW BACKENDS\G" 2>/dev/null | grep -q "Alive: true"; do
  sleep 3
done

echo "Creating wafflebase database + view_events table"
mysql -h "$FE" -P "$PORT" -u root < /sql/create-table.sql

echo "Creating routine load"
# Tolerate a pre-existing job, but surface any other failure: verify the job
# actually exists afterward and fail loudly if it does not (a genuine DDL or
# connectivity error must not masquerade as "already exists").
create_out=$(mysql -h "$FE" -P "$PORT" -u root < /sql/create-routine-load.sql 2>&1) \
  || echo "create returned non-zero (may already exist): $create_out"

sleep 5
state=$(mysql -h "$FE" -P "$PORT" -u root \
  -e "SHOW ROUTINE LOAD FOR wafflebase.view_events\G" 2>/dev/null \
  | grep "State:" | sed 's/.*State: //')
if [ -z "$state" ]; then
  echo "ERROR: routine load wafflebase.view_events was not created"
  echo "create output was: $create_out"
  exit 1
fi
echo "routine load state: $state"
if [ "$state" = "PAUSED" ]; then
  echo "Resuming routine load"
  mysql -h "$FE" -P "$PORT" -u root \
    -e "RESUME ROUTINE LOAD FOR wafflebase.view_events;"
fi

echo "Final routine load status:"
mysql -h "$FE" -P "$PORT" -u root -e "SHOW ROUTINE LOAD FROM wafflebase\G"
echo "Analytics stack ready. Point the backend at:"
echo "  WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092"
echo "  WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events"
echo "  WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase"

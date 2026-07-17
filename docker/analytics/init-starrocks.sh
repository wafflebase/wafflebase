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
mysql -h "$FE" -P "$PORT" -u root < /sql/create-routine-load.sql 2>/dev/null \
  || echo "routine load may already exist, continuing"

sleep 5
state=$(mysql -h "$FE" -P "$PORT" -u root \
  -e "SHOW ROUTINE LOAD FOR wafflebase.view_events\G" 2>/dev/null \
  | grep "State:" | sed 's/.*State: //')
echo "routine load state: ${state:-unknown}"
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

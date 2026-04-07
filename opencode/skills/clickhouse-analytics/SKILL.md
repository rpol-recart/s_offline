---
name: clickhouse-analytics
description: "ClickHouse schema design, queries, MergeTree engines, materialized views, Python integration"
---

# ClickHouse Analytics Skill

## When to Use

When designing analytical data storage, time-series databases, OLAP queries, real-time aggregations, or any high-volume insert/query workloads.

## Schema Design

### Table Engines

| Engine | Use Case | Key Feature |
|--------|----------|-------------|
| `MergeTree` | Default analytical table | Fast inserts, columnar storage |
| `ReplacingMergeTree(ver)` | Deduplication by ORDER BY key | Keeps latest version |
| `AggregatingMergeTree` | Pre-aggregated data | Materialized view target |
| `SummingMergeTree(cols)` | Auto-sum on merge | Counter metrics |
| `Buffer(db, table, ...)` | High-throughput write buffer | Flushes to target table |
| `Kafka(...)` | Direct Kafka consumption | Stream ingestion |
| `Distributed(...)` | Multi-shard queries | Cluster-wide reads |

### Time-Series Table Pattern

```sql
CREATE TABLE events (
    timestamp DateTime64(3),      -- millisecond precision
    camera_id LowCardinality(String),
    event_type LowCardinality(String),
    object_class LowCardinality(String),
    confidence Float32,
    bbox_x UInt16,
    bbox_y UInt16,
    bbox_w UInt16,
    bbox_h UInt16,
    tracker_id UInt64,
    metadata String                -- JSON for flexible fields
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (camera_id, timestamp)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
```

### Metrics Table Pattern

```sql
CREATE TABLE metrics (
    timestamp DateTime,
    host LowCardinality(String),
    metric_name LowCardinality(String),
    value Float64,
    tags Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (metric_name, host, timestamp)
TTL timestamp + INTERVAL 365 DAY;
```

### Materialized View (Real-time Aggregation)

```sql
-- Hourly aggregation view
CREATE MATERIALIZED VIEW events_hourly_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (camera_id, event_type, hour)
AS SELECT
    toStartOfHour(timestamp) AS hour,
    camera_id,
    event_type,
    count() AS event_count,
    avg(confidence) AS avg_confidence
FROM events
GROUP BY hour, camera_id, event_type;
```

### Kafka Engine (Direct Ingestion)

```sql
CREATE TABLE events_kafka (
    timestamp DateTime64(3),
    camera_id String,
    event_type String,
    confidence Float32
)
ENGINE = Kafka()
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'deepstream-events',
    kafka_group_name = 'clickhouse-consumer',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 2;

-- Materialized view to persist Kafka data
CREATE MATERIALIZED VIEW events_kafka_mv TO events AS
SELECT * FROM events_kafka;
```

## Python Integration

### clickhouse-connect

```python
import clickhouse_connect

client = clickhouse_connect.get_client(
    host='localhost',
    port=8123,
    username='default',
    password='',
    database='analytics',
)

# Query
result = client.query("SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 HOUR")
print(result.result_rows)

# Batch insert (preferred — always batch!)
data = [
    (datetime.now(), 'cam-01', 'detection', 'person', 0.95),
    (datetime.now(), 'cam-01', 'detection', 'car', 0.87),
]
client.insert(
    'events',
    data,
    column_names=['timestamp', 'camera_id', 'event_type', 'object_class', 'confidence'],
)
```

### clickhouse-driver (native protocol)

```python
from clickhouse_driver import Client

client = Client(host='localhost', port=9000, database='analytics')

# Query with parameters
result = client.execute(
    "SELECT * FROM events WHERE camera_id = %(cam)s AND timestamp > %(ts)s",
    {'cam': 'cam-01', 'ts': datetime(2025, 1, 1)},
)

# Batch insert
client.execute(
    "INSERT INTO events (timestamp, camera_id, event_type) VALUES",
    data_list,
)
```

## Common Queries

```sql
-- Events per camera per hour (last 24h)
SELECT
    toStartOfHour(timestamp) AS hour,
    camera_id,
    count() AS events
FROM events
WHERE timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour, camera_id
ORDER BY hour DESC;

-- Top detected objects
SELECT
    object_class,
    count() AS detections,
    avg(confidence) AS avg_conf
FROM events
WHERE timestamp > today()
GROUP BY object_class
ORDER BY detections DESC
LIMIT 20;

-- Running average (window function)
SELECT
    timestamp,
    value,
    avg(value) OVER (ORDER BY timestamp ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) AS moving_avg
FROM metrics
WHERE metric_name = 'cpu_usage';
```

## Docker Compose

```yaml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    ports:
      - "8123:8123"   # HTTP
      - "9000:9000"   # Native
    volumes:
      - clickhouse-data:/var/lib/clickhouse
      - ./clickhouse/config.xml:/etc/clickhouse-server/config.d/custom.xml
      - ./clickhouse/init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      CLICKHOUSE_DB: analytics
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: ""
    ulimits:
      nofile:
        soft: 262144
        hard: 262144

volumes:
  clickhouse-data:
```

## Best Practices

1. **Batch inserts** — minimum 1000 rows per insert, never single-row
2. **LowCardinality** — use for string columns with < 10k unique values
3. **Partition by month** — `PARTITION BY toYYYYMM(timestamp)` for time-series
4. **ORDER BY = query pattern** — ORDER BY columns should match WHERE/GROUP BY clauses
5. **TTL for retention** — auto-delete old data: `TTL timestamp + INTERVAL 90 DAY`
6. **Materialized views** — pre-aggregate for dashboard queries
7. **Avoid UPDATEs** — ClickHouse is append-optimized; use ReplacingMergeTree for updates
8. **Use `FINAL`** — `SELECT ... FROM table FINAL` forces merge for ReplacingMergeTree reads

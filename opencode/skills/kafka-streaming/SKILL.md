---
name: kafka-streaming
description: "kafka-python patterns — producers, consumers, serialization, error handling"
---

# Kafka Streaming Skill (kafka-python)

## When to Use

When implementing event streaming, message queues, or real-time data pipelines with Apache Kafka using the `kafka-python` library.

## Core Patterns

### Producer

```python
from kafka import KafkaProducer
import json

producer = KafkaProducer(
    bootstrap_servers=['kafka:9092'],
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    key_serializer=lambda k: k.encode('utf-8') if k else None,
    acks='all',                    # Wait for all replicas
    retries=3,
    retry_backoff_ms=500,
    max_in_flight_requests_per_connection=1,  # Ordering guarantee
    linger_ms=10,                  # Batch small messages
    batch_size=16384,
    compression_type='gzip',       # gzip, snappy, lz4, zstd
)

# Send message
future = producer.send(
    topic='events',
    key='user-123',
    value={'event': 'login', 'timestamp': '2025-01-01T00:00:00Z'},
    headers=[('source', b'auth-service')],
)
record_metadata = future.get(timeout=10)  # Block for confirmation

# Always flush before shutdown
producer.flush()
producer.close()
```

### Consumer

```python
from kafka import KafkaConsumer
import json

consumer = KafkaConsumer(
    'events',
    bootstrap_servers=['kafka:9092'],
    group_id='my-consumer-group',
    auto_offset_reset='earliest',      # 'earliest' or 'latest'
    enable_auto_commit=False,           # Manual commit for reliability
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    max_poll_records=100,
    session_timeout_ms=30000,
    heartbeat_interval_ms=10000,
    max_poll_interval_ms=300000,
)

try:
    for message in consumer:
        topic = message.topic
        partition = message.partition
        offset = message.offset
        key = message.key
        value = message.value
        timestamp = message.timestamp

        # Process message
        process(value)

        # Manual commit after successful processing
        consumer.commit()
except Exception as e:
    logger.error(f"Consumer error: {e}")
finally:
    consumer.close()
```

### Batch Consumer with Graceful Shutdown

```python
import signal
import threading

shutdown_event = threading.Event()

def signal_handler(signum, frame):
    shutdown_event.set()

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

consumer = KafkaConsumer(
    'events',
    bootstrap_servers=['kafka:9092'],
    group_id='batch-processor',
    enable_auto_commit=False,
    auto_offset_reset='earliest',
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    max_poll_records=500,
)

while not shutdown_event.is_set():
    records = consumer.poll(timeout_ms=1000)

    if not records:
        continue

    batch = []
    for tp, messages in records.items():
        for msg in messages:
            batch.append(msg.value)

    if batch:
        process_batch(batch)      # Bulk insert to ClickHouse, etc.
        consumer.commit()

consumer.close()
```

### Multiple Topics

```python
consumer = KafkaConsumer(
    bootstrap_servers=['kafka:9092'],
    group_id='multi-topic',
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
)

# Subscribe to multiple topics
consumer.subscribe(['events', 'metrics', 'alerts'])

# Or use pattern
consumer.subscribe(pattern='^deepstream-.*')
```

## Topic Design

| Pattern | Topic Naming | Example |
|---------|-------------|---------|
| By entity | `{domain}.{entity}.{event}` | `video.detection.created` |
| By source | `{source}-{type}` | `deepstream-events` |
| By priority | `{domain}.{priority}` | `alerts.critical` |

## Schema Management

```python
from dataclasses import dataclass, asdict
from datetime import datetime

@dataclass
class DetectionEvent:
    camera_id: str
    timestamp: str
    object_class: str
    confidence: float
    bbox: dict          # {"x": 0, "y": 0, "w": 100, "h": 100}
    tracker_id: int

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        return cls(**data)
```

## Error Handling

```python
from kafka.errors import (
    KafkaError,
    NoBrokersAvailable,
    KafkaTimeoutError,
    CommitFailedError,
)

# Producer with error callback
def on_send_error(exc):
    logger.error(f"Failed to send message: {exc}")

future = producer.send('topic', value=data)
future.add_errback(on_send_error)

# Consumer retry pattern
MAX_RETRIES = 3

for message in consumer:
    for attempt in range(MAX_RETRIES):
        try:
            process(message.value)
            consumer.commit()
            break
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                # Send to dead-letter topic
                producer.send('events.dlq', value={
                    'original': message.value,
                    'error': str(e),
                    'attempts': MAX_RETRIES,
                })
                consumer.commit()
```

## Docker Compose

```yaml
services:
  kafka:
    image: confluentinc/cp-kafka:7.6.0
    ports:
      - "9092:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LOG_RETENTION_HOURS: 168
      CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qk"
    volumes:
      - kafka-data:/var/lib/kafka/data

volumes:
  kafka-data:
```

## Best Practices

1. **Manual commits** — `enable_auto_commit=False` + commit after processing
2. **Idempotent consumers** — handle duplicate messages gracefully
3. **Dead-letter queue** — route failed messages to `.dlq` topic
4. **Key-based partitioning** — use message keys for ordering guarantees within partition
5. **Batch processing** — use `poll()` + batch insert for throughput
6. **Graceful shutdown** — handle SIGTERM, flush producer, close consumer
7. **Monitor lag** — track consumer group lag for backpressure detection

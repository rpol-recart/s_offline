---
name: monitoring-stack
description: "Grafana dashboards and Zabbix monitoring — provisioning, panels, templates, alerts"
---

# Monitoring Stack Skill (Grafana + Zabbix)

## When to Use

When setting up observability: dashboards for metrics visualization (Grafana), infrastructure/service monitoring with alerting (Zabbix).

## Grafana

### Dashboard Provisioning

```
provisioning/
├── dashboards/
│   ├── dashboard.yml          # Dashboard provider config
│   └── dashboards/
│       ├── overview.json      # Dashboard JSON models
│       └── kafka.json
└── datasources/
    └── datasource.yml         # Datasource definitions
```

**datasource.yml:**
```yaml
apiVersion: 1
datasources:
  - name: ClickHouse
    type: grafana-clickhouse-datasource
    access: proxy
    url: http://clickhouse:8123
    jsonData:
      defaultDatabase: analytics
    isDefault: true

  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090

  - name: Zabbix
    type: alexanderzobnin-zabbix-datasource
    access: proxy
    jsonData:
      zbxUrl: http://zabbix-web/api_jsonrpc.php
      username: Admin
    secureJsonData:
      password: zabbix
```

**dashboard.yml:**
```yaml
apiVersion: 1
providers:
  - name: 'default'
    folder: ''
    type: file
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true
```

### Dashboard JSON Structure

```json
{
  "dashboard": {
    "title": "Service Overview",
    "uid": "service-overview",
    "tags": ["production", "overview"],
    "timezone": "browser",
    "refresh": "30s",
    "time": { "from": "now-6h", "to": "now" },
    "templating": {
      "list": [
        {
          "name": "camera",
          "type": "query",
          "datasource": "ClickHouse",
          "query": "SELECT DISTINCT camera_id FROM events",
          "multi": true,
          "includeAll": true
        }
      ]
    },
    "panels": [
      {
        "title": "Events per Hour",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
        "datasource": "ClickHouse",
        "targets": [
          {
            "rawSql": "SELECT toStartOfHour(timestamp) AS time, count() AS events FROM events WHERE camera_id IN ($camera) AND $__timeFilter(timestamp) GROUP BY time ORDER BY time",
            "format": "time_series"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "short",
            "color": { "mode": "palette-classic" }
          }
        }
      },
      {
        "title": "Detection Count",
        "type": "stat",
        "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
        "targets": [
          {
            "rawSql": "SELECT count() AS value FROM events WHERE $__timeFilter(timestamp)"
          }
        ]
      }
    ]
  }
}
```

### Panel Types Cheat Sheet

| Type | Use For | Key Options |
|------|---------|-------------|
| `timeseries` | Time-based metrics | thresholds, fill, gradient |
| `stat` | Single big number | colorMode, graphMode |
| `gauge` | Progress/percentage | min, max, thresholds |
| `table` | Tabular data | column filters, sorting |
| `barchart` | Comparisons | orientation, stacking |
| `heatmap` | Density over time | color scheme, bucket size |
| `logs` | Log viewer | datasource: Loki |
| `alertlist` | Active alerts | filter by dashboard/folder |

### Grafana Alerting

```json
{
  "alert": {
    "name": "High detection rate",
    "conditions": [
      {
        "evaluator": { "type": "gt", "params": [1000] },
        "operator": { "type": "and" },
        "query": { "params": ["A", "5m", "now"] },
        "reducer": { "type": "avg" }
      }
    ],
    "frequency": "1m",
    "for": "5m",
    "notifications": [{ "uid": "slack-channel" }]
  }
}
```

## Zabbix

### Template Structure (YAML export)

```yaml
zabbix_export:
  version: '6.0'
  templates:
    - template: "Kafka Monitoring"
      name: "Kafka Monitoring"
      groups:
        - name: "Templates/Applications"
      items:
        - name: "Kafka broker status"
          type: HTTP_AGENT
          key: "kafka.broker.status"
          url: "http://{HOST.CONN}:9092"
          value_type: UNSIGNED
          triggers:
            - name: "Kafka broker is down"
              expression: "last(/Kafka Monitoring/kafka.broker.status)=0"
              priority: HIGH

        - name: "Consumer lag"
          type: EXTERNAL_CHECK
          key: "kafka.consumer.lag[{$CONSUMER_GROUP},{$TOPIC}]"
          delay: "30s"
          value_type: UNSIGNED
          triggers:
            - name: "Consumer lag is high (>{$MAX_LAG})"
              expression: "last(/Kafka Monitoring/kafka.consumer.lag[{$CONSUMER_GROUP},{$TOPIC}])>{$MAX_LAG}"
              priority: WARNING

      discovery_rules:
        - name: "Kafka topics discovery"
          type: EXTERNAL_CHECK
          key: "kafka.topics.discovery"
          delay: "5m"
          item_prototypes:
            - name: "Messages in topic {#TOPIC}"
              type: EXTERNAL_CHECK
              key: "kafka.topic.messages[{#TOPIC}]"
              delay: "30s"
              value_type: UNSIGNED
          trigger_prototypes:
            - name: "No messages in {#TOPIC} for 10m"
              expression: "nodata(/Kafka Monitoring/kafka.topic.messages[{#TOPIC}],10m)=1"
              priority: WARNING

      macros:
        - macro: "{$CONSUMER_GROUP}"
          value: "default"
        - macro: "{$TOPIC}"
          value: "events"
        - macro: "{$MAX_LAG}"
          value: "10000"
```

### Zabbix Trigger Expressions

```
# Basic threshold
last(/Template/item.key) > 90

# Average over period
avg(/Template/item.key,5m) > 80

# No data received
nodata(/Template/item.key,10m) = 1

# Change detection
change(/Template/item.key) > 100

# Percentage change
(last(/Template/item.key) - prev(/Template/item.key)) / prev(/Template/item.key) * 100 > 50

# Multiple conditions
last(/Template/cpu.usage) > 90 and last(/Template/mem.usage) > 85
```

### Zabbix API (Python)

```python
from pyzabbix import ZabbixAPI

zapi = ZabbixAPI("http://zabbix-web/")
zapi.login("Admin", "zabbix")

# Get hosts
hosts = zapi.host.get(output=["hostid", "host", "name"], filter={"status": 0})

# Get latest metrics
items = zapi.item.get(
    hostids=[host['hostid']],
    output=["itemid", "name", "lastvalue"],
    search={"key_": "kafka"},
)

# Create trigger
zapi.trigger.create(
    description="High CPU on {HOST.NAME}",
    expression="last(/Template/system.cpu.util) > 90",
    priority=4,  # HIGH
)
```

## Docker Compose (Full Monitoring Stack)

```yaml
services:
  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_INSTALL_PLUGINS: grafana-clickhouse-datasource,alexanderzobnin-zabbix-app
    volumes:
      - grafana-data:/var/lib/grafana
      - ./provisioning:/etc/grafana/provisioning

  zabbix-server:
    image: zabbix/zabbix-server-pgsql:7.0-alpine
    environment:
      DB_SERVER_HOST: zabbix-db
      POSTGRES_USER: zabbix
      POSTGRES_PASSWORD: zabbix
    depends_on:
      - zabbix-db

  zabbix-web:
    image: zabbix/zabbix-web-nginx-pgsql:7.0-alpine
    ports:
      - "8080:8080"
    environment:
      ZBX_SERVER_HOST: zabbix-server
      DB_SERVER_HOST: zabbix-db
      POSTGRES_USER: zabbix
      POSTGRES_PASSWORD: zabbix

  zabbix-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: zabbix
      POSTGRES_PASSWORD: zabbix
      POSTGRES_DB: zabbix
    volumes:
      - zabbix-db-data:/var/lib/postgresql/data

volumes:
  grafana-data:
  zabbix-db-data:
```

## Best Practices

1. **Provisioning over manual setup** — all Grafana dashboards and datasources as code
2. **Variables in dashboards** — `$host`, `$interval` for interactive filtering
3. **Zabbix macros** — `{$THRESHOLD}` for configurable thresholds across hosts
4. **LLD for dynamic monitoring** — auto-discover Kafka topics, Docker containers, etc.
5. **Alert escalation** — Warning (5m) → High (15m) → Disaster (30m)
6. **Dashboard hierarchy** — Overview → Service → Instance drill-down
7. **Retention policies** — ClickHouse TTL for metrics, Zabbix housekeeper for history

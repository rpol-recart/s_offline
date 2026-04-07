---
name: fastapi-backend
description: "FastAPI application patterns — endpoints, Pydantic models, middleware, async, deployment"
---

# FastAPI Backend Skill

## When to Use

When building REST API backends, async web services, or API layers for ML/data applications.

## Application Structure

```
app/
├── main.py                # FastAPI app, lifespan, middleware
├── config.py              # Settings via pydantic-settings
├── models/
│   ├── __init__.py
│   ├── detection.py       # Pydantic models for detection events
│   └── metrics.py         # Pydantic models for metrics
├── routers/
│   ├── __init__.py
│   ├── detections.py      # /api/detections endpoints
│   ├── cameras.py         # /api/cameras endpoints
│   └── health.py          # /api/health endpoint
├── services/
│   ├── __init__.py
│   ├── clickhouse.py      # ClickHouse client
│   ├── kafka.py           # Kafka producer
│   └── inference.py       # ML inference service
├── dependencies.py        # Dependency injection
└── middleware.py           # Custom middleware
```

## Core Application

```python
# main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import detections, cameras, health
from app.services.clickhouse import ch_client
from app.services.kafka import kafka_producer

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await ch_client.connect()
    await kafka_producer.start()
    yield
    # Shutdown
    await kafka_producer.stop()
    await ch_client.close()

app = FastAPI(
    title="Video Analytics API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(detections.router, prefix="/api/detections", tags=["detections"])
app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
```

## Configuration

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # ClickHouse
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_database: str = "analytics"

    # Kafka
    kafka_brokers: str = "localhost:9092"
    kafka_topic: str = "events"

    # CORS
    cors_origins: list[str] = ["*"]

    model_config = {"env_prefix": "APP_", "env_file": ".env"}

settings = Settings()
```

## Pydantic Models

```python
# models/detection.py
from pydantic import BaseModel, Field
from datetime import datetime

class BBox(BaseModel):
    x: float = Field(ge=0, description="Top-left X")
    y: float = Field(ge=0, description="Top-left Y")
    w: float = Field(gt=0, description="Width")
    h: float = Field(gt=0, description="Height")

class Detection(BaseModel):
    camera_id: str
    timestamp: datetime
    object_class: str
    confidence: float = Field(ge=0, le=1)
    bbox: BBox
    tracker_id: int | None = None

class DetectionResponse(BaseModel):
    total: int
    items: list[Detection]

class DetectionQuery(BaseModel):
    camera_id: str | None = None
    object_class: str | None = None
    min_confidence: float = 0.0
    start_time: datetime | None = None
    end_time: datetime | None = None
    limit: int = Field(default=100, le=10000)
    offset: int = 0
```

## Router Endpoints

```python
# routers/detections.py
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime

from app.models.detection import Detection, DetectionResponse, DetectionQuery
from app.dependencies import get_ch_client, get_kafka_producer

router = APIRouter()

@router.get("/", response_model=DetectionResponse)
async def list_detections(
    camera_id: str | None = None,
    object_class: str | None = None,
    min_confidence: float = Query(default=0.0, ge=0, le=1),
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    limit: int = Query(default=100, le=10000),
    offset: int = 0,
    ch=Depends(get_ch_client),
):
    """List detections with filtering."""
    conditions = ["1=1"]
    params = {}

    if camera_id:
        conditions.append("camera_id = %(camera_id)s")
        params["camera_id"] = camera_id
    if object_class:
        conditions.append("object_class = %(object_class)s")
        params["object_class"] = object_class
    if min_confidence:
        conditions.append("confidence >= %(min_conf)s")
        params["min_conf"] = min_confidence
    if start_time:
        conditions.append("timestamp >= %(start)s")
        params["start"] = start_time
    if end_time:
        conditions.append("timestamp <= %(end)s")
        params["end"] = end_time

    where = " AND ".join(conditions)

    total = ch.query(f"SELECT count() FROM events WHERE {where}", params).result_rows[0][0]
    rows = ch.query(
        f"SELECT * FROM events WHERE {where} ORDER BY timestamp DESC LIMIT {limit} OFFSET {offset}",
        params,
    ).result_rows

    return DetectionResponse(total=total, items=[Detection(**r) for r in rows])

@router.post("/", status_code=201)
async def create_detection(
    detection: Detection,
    kafka=Depends(get_kafka_producer),
):
    """Ingest a new detection event via Kafka."""
    await kafka.send(detection.model_dump_json().encode())
    return {"status": "accepted"}

@router.get("/stats")
async def detection_stats(
    period: str = Query(default="1h", regex="^[0-9]+[mhd]$"),
    ch=Depends(get_ch_client),
):
    """Get detection statistics for the given period."""
    result = ch.query(f"""
        SELECT object_class, count() AS cnt, avg(confidence) AS avg_conf
        FROM events
        WHERE timestamp > now() - INTERVAL {period}
        GROUP BY object_class
        ORDER BY cnt DESC
    """)
    return [{"class": r[0], "count": r[1], "avg_confidence": r[2]} for r in result.result_rows]
```

## Dependency Injection

```python
# dependencies.py
from app.config import settings
from app.services.clickhouse import ClickHouseService
from app.services.kafka import KafkaService

_ch_client = None
_kafka_producer = None

async def get_ch_client() -> ClickHouseService:
    return _ch_client

async def get_kafka_producer() -> KafkaService:
    return _kafka_producer
```

## WebSocket (Real-time)

```python
from fastapi import WebSocket, WebSocketDisconnect

@router.websocket("/ws/detections")
async def websocket_detections(websocket: WebSocket, camera_id: str | None = None):
    await websocket.accept()
    try:
        async for event in kafka_consumer.stream("events"):
            if camera_id and event["camera_id"] != camera_id:
                continue
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
```

## Background Tasks

```python
from fastapi import BackgroundTasks

@router.post("/batch-process")
async def batch_process(
    file: UploadFile,
    background_tasks: BackgroundTasks,
):
    """Process uploaded file in background."""
    content = await file.read()
    background_tasks.add_task(process_file, content, file.filename)
    return {"status": "processing", "filename": file.filename}
```

## Deployment

```python
# Run with uvicorn
# uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# Dockerfile
"""
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
"""
```

## Mounting Gradio

```python
import gradio as gr
from app.main import app

demo = gr.Blocks()
with demo:
    gr.Markdown("# Dashboard")
    # ... Gradio UI ...

app = gr.mount_gradio_app(app, demo, path="/ui")
```

## Best Practices

1. **Pydantic v2 models** — use for all request/response validation
2. **Async everywhere** — `async def` for I/O-bound endpoints
3. **Dependency injection** — `Depends()` for DB clients, auth, config
4. **Lifespan** — use `@asynccontextmanager` for startup/shutdown
5. **Response models** — always specify `response_model=` for auto-docs
6. **Error handling** — `HTTPException` with proper status codes
7. **Pagination** — always support `limit` + `offset` for list endpoints
8. **Health endpoint** — `/health` returning DB/Kafka connection status

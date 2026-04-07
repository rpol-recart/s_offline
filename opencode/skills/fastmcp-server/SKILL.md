---
name: fastmcp-server
description: "FastMCP server creation — tools, resources, prompts, transport configuration"
---

# FastMCP Server Skill

## When to Use

When creating Model Context Protocol (MCP) servers that expose tools, resources, and prompts to LLM-based applications (Claude, OpenCode, etc.).

## Basic Server

```python
from fastmcp import FastMCP

mcp = FastMCP("My Server", description="Server description")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers together."""
    return a + b

@mcp.tool()
def search_database(query: str, limit: int = 10) -> list[dict]:
    """Search the database for matching records."""
    results = db.search(query, limit=limit)
    return [r.to_dict() for r in results]

if __name__ == "__main__":
    mcp.run()  # stdio transport (default)
```

## Tools

```python
from fastmcp import FastMCP, Context
from pydantic import Field

mcp = FastMCP("Tools Server")

# Simple tool
@mcp.tool()
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    return f"Weather in {city}: 22°C, sunny"

# Tool with rich parameter descriptions
@mcp.tool()
def query_clickhouse(
    sql: str = Field(description="SQL query to execute"),
    database: str = Field(default="analytics", description="Target database"),
    limit: int = Field(default=100, description="Max rows to return"),
) -> str:
    """Execute a ClickHouse SQL query and return results as JSON."""
    client = get_clickhouse_client()
    result = client.query(sql)
    return json.dumps(result.result_rows[:limit])

# Tool with context (logging, progress)
@mcp.tool()
async def process_video(url: str, ctx: Context) -> str:
    """Process a video stream and return detection results."""
    await ctx.info(f"Processing video: {url}")
    await ctx.report_progress(0, 100)

    results = await run_detection(url)

    await ctx.report_progress(100, 100)
    return json.dumps(results)

# Async tool
@mcp.tool()
async def fetch_metrics(
    host: str,
    metric: str,
    period: str = "1h",
) -> str:
    """Fetch metrics from monitoring system."""
    async with aiohttp.ClientSession() as session:
        data = await fetch_from_prometheus(session, host, metric, period)
        return json.dumps(data)
```

## Resources

```python
# Static resource
@mcp.resource("config://app")
def get_config() -> str:
    """Application configuration."""
    return json.dumps(load_config())

# Dynamic resource with URI parameter
@mcp.resource("camera://{camera_id}/status")
def camera_status(camera_id: str) -> str:
    """Get camera status by ID."""
    status = get_camera(camera_id)
    return json.dumps(status)

# File resource
@mcp.resource("file://logs/app.log")
def get_logs() -> str:
    """Recent application logs."""
    with open("logs/app.log") as f:
        return f.read()[-10000:]  # Last 10KB
```

## Prompts

```python
from fastmcp.prompts import Message

@mcp.prompt()
def analyze_metrics(host: str, timeframe: str = "1h") -> list[Message]:
    """Analyze system metrics for anomalies."""
    metrics_data = fetch_latest_metrics(host, timeframe)
    return [
        Message(
            role="user",
            content=f"Analyze these metrics for {host} over the last {timeframe} "
                    f"and identify any anomalies:\n\n{json.dumps(metrics_data, indent=2)}"
        )
    ]

@mcp.prompt()
def debug_pipeline(pipeline_name: str) -> list[Message]:
    """Help debug a DeepStream pipeline issue."""
    config = read_pipeline_config(pipeline_name)
    logs = get_recent_logs(pipeline_name)
    return [
        Message(role="user", content=f"Debug this DeepStream pipeline:\n\nConfig:\n{config}\n\nRecent logs:\n{logs}")
    ]
```

## Transport Options

```python
# stdio (default) — for CLI tools and local MCP clients
mcp.run()

# SSE (Server-Sent Events) — for HTTP-based clients
mcp.run(transport="sse", host="0.0.0.0", port=8000)

# Streamable HTTP — new transport
mcp.run(transport="streamable-http", host="0.0.0.0", port=8000)
```

## Integration with FastAPI

```python
from fastapi import FastAPI
from fastmcp import FastMCP

app = FastAPI()
mcp = FastMCP("API Server")

@mcp.tool()
def query_data(sql: str) -> str:
    """Query analytics database."""
    return execute_query(sql)

# Mount MCP server at /mcp
app = mcp.streamable_http_app()

# Or combine with existing FastAPI app
@app.get("/health")
def health():
    return {"status": "ok"}
```

## Project Structure

```
mcp-server/
├── server.py              # Main MCP server
├── tools/
│   ├── __init__.py
│   ├── database.py        # DB query tools
│   ├── monitoring.py      # Monitoring tools
│   └── video.py           # Video analytics tools
├── resources/
│   ├── __init__.py
│   └── config.py          # Configuration resources
├── prompts/
│   ├── __init__.py
│   └── analysis.py        # Analysis prompts
├── requirements.txt
└── README.md
```

### Modular Server

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("Analytics MCP Server")

# Import tools from modules
from tools.database import register_db_tools
from tools.monitoring import register_monitoring_tools

register_db_tools(mcp)
register_monitoring_tools(mcp)

if __name__ == "__main__":
    mcp.run()
```

```python
# tools/database.py
def register_db_tools(mcp):
    @mcp.tool()
    def query_clickhouse(sql: str) -> str:
        """Execute ClickHouse query."""
        ...

    @mcp.tool()
    def list_tables(database: str = "analytics") -> str:
        """List tables in database."""
        ...
```

## Client Configuration

### OpenCode (`opencode.json`)
```json
{
  "mcp": {
    "analytics": {
      "command": "python",
      "args": ["mcp-server/server.py"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "analytics": {
      "command": "python",
      "args": ["/path/to/server.py"]
    }
  }
}
```

## Best Practices

1. **Clear tool descriptions** — LLMs use descriptions to decide when to call tools
2. **Type hints everywhere** — automatic schema generation from Python types
3. **Use Field()** for parameter descriptions when names aren't self-explanatory
4. **Return strings** — tools should return human-readable text (JSON formatted if structured)
5. **Error messages** — return descriptive errors, not tracebacks
6. **Modular structure** — split tools into logical modules
7. **Context for long operations** — use `Context` for progress reporting and logging

# Offline Mode Rules

## Network Restrictions

This system operates with **limited network access**:
- **No external APIs** — use local models via Ollama
- **No `webfetch`** — tool disabled globally
- **pip install works** — use normally
- **Local git operations** — no remote fetch/pull/clone (unless VPN/proxy configured)

### What Does NOT Work

- `webfetch` tool — disabled globally
- External LLM APIs (Anthropic, OpenAI, etc.) — use local Ollama models
- `git clone/pull/fetch` from remote — unless network configured

### What DOES Work

- All file operations (read, write, edit)
- All bash commands
- `pip install` — works normally
- `pip install -e .` (local editable install)
- `pip install ./package.whl` (local wheel)
- Local git operations (commit, branch, log, diff, merge)
- Python scripts

### Local Model Configuration

Models run via **Ollama** on localhost:

#### Recommended Local Models

| Model | Context | Use Case | Pull Command |
|-------|---------|----------|--------------|
| Qwen3.5 | 128k | Latest, best reasoning | `ollama pull qwen3.5-coder` |
| Qwen 2.5 Coder 32B | 128k | General development | `ollama pull qwen2.5-coder:32b` |
| Qwen 2.5 Coder 7B | 32k | Fast iteration | `ollama pull qwen2.5-coder:7b` |
| DeepSeek Coder V2 | 128k | Complex refactoring | `ollama pull deepseek-coder-v2:16b` |
| Llama 3.1 | 128k | General purpose | `ollama pull llama3.1:8b` |

```bash
# Pull ALL models needed before going offline
ollama pull qwen2.5-coder:32b
ollama pull qwen2.5-coder:7b

# Verify and test
ollama list
ollama run qwen2.5-coder:32b "ping"  # Quick connectivity check
```

Ollama API: `http://localhost:11434`

#### Permission Considerations for Offline Mode

In offline mode, consider these permission defaults:

```json
{
  "permission": {
    "*": "allow",
    "webfetch": "deny",      /* No internet - block explicitly */
    "bash": {                /* Allow common offline ops */
      "*": "allow",
      "git fetch*": "ask",   /* May try remote - prompt first */
      "git pull*": "ask"
    }
  }
}
```

⚠️ **Important**: Always set `webfetch`, `websearch` to `"deny"` when offline to avoid hangs.

### Required Pre-Installation

Before going offline, ensure:

```bash
# Python packages (install to system or venv)
pip install langchain langchain-community faiss-cpu chromadb
pip install ultralytics opencv-python open3d
pip install fastapi uvicorn pydantic
pip install kafka-python clickhouse-connect

# Or use requirements.txt
pip install -r requirements.txt
```

### Caching Strategies

Before going offline:

```bash
# 1. Download PyPI package wheels to cache directory
mkdir -p $HOME/.cache/pip/wheels
pip download -d $HOME/.cache/pip/wheels $(cat requirements.txt | grep -v '^--')

# 2. Pre-download npm packages (if working with JS)
npm install --prefer-offline --no-audit

# 3. Cache common Python packages commonly needed
pip cache info                           # Check available space
pip install -r requirements.txt          # Full pre-cache

# 4. Download API documentation locally
# Use tools like mkdocs, sphinx, or save HTML pages to /docs/ folder
```

### Offline-Compatible Workflows

| Task | Offline Alternative |
|------|---------------------|
| Web research | Use locally cached `/docs/` or pre-downloaded knowledge base |
| Package lookup | Rely on `requirements.txt` + pip cache |
| Git sync | Local commits only; queue changes for when online again |
| Documentation | Read from locally saved markdown/HTML |

### Error Handling

If an agent attempts internet access:
1. Tool will return "offline" error
2. Agent should adapt and use local alternatives
3. If stuck after 1 retry, report to orchestrator as "requires network"

## Recommendations

1. **Cache documentation locally** — download docs to `/docs/` before going offline
2. **Pre-install dependencies** — full requirements.txt installed + pip wheel cache
3. **Use local models** — Ollama with ALL model weights downloaded (`ollama list`)
4. **Work with local code only** — no external repos or packages unless cached
5. **Set permissions to deny web tools** — `webfetch: deny`, `websearch: deny`

# Timeout Resilience Rules

## Problem

Model inference can be slow (especially on long context), causing:
- Request timeouts (default 5min)
- Chunk timeouts (stalled streaming)
- Agent stops mid-task with no recovery

## Configuration

Timeouts are set in `opencode.json` under `provider.*.options`:
- `timeout: 600000` — 10 minutes per request (default: 300000)
- `chunkTimeout: 120000` — 2 minutes between stream chunks (generous for slow models)

SSE retry settings (top-level in `opencode.json`):
- `sseDefaultRetryDelay: 5000` — initial retry after 5 seconds
- `sseMaxRetryDelay: 60000` — max backoff 60 seconds
- `sseMaxRetryAttempts: 5` — give up after 5 retries

## Agent Rules for Timeout Prevention

### 1. Break Work Into Small Steps
- **NEVER** attempt to process more than 3 files in a single response
- Split large tasks into sequential steps with intermediate saves
- After each significant action, write progress to `project/PLAN.md`

### 2. Minimize Context Per Request
- Do NOT paste entire file contents into prompts — reference paths instead
- Use `offset` and `limit` when reading large files
- Keep delegation prompts under 2000 tokens

### 3. Checkpoint Frequently
- After every completed subtask, update plan status
- Before long operations (builds, tests), save current state
- If using session store, call `saveSession` before risky operations

### 4. Recovery After Timeout
If an agent was interrupted mid-task:
1. Read `project/PLAN.md` to find last completed step
2. Check file system for partially written files
3. Resume from last known good state — do NOT restart from scratch
4. Log the timeout in append-log for monitoring

### 5. Orchestrator Timeout Handling
When a delegated task times out:
1. Check if the agent produced partial output
2. If partial output is usable, mark task as partial and continue
3. If no output, retry with a **simpler** prompt (split the task further)
4. After 2 consecutive timeouts on the same task, escalate to user

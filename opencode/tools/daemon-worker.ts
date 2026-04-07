import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { ChildProcess } from "child_process"

// ============================================================================
// Types
// ============================================================================

type TaskPriority = "low" | "normal" | "high" | "critical"

interface Task {
  id: string
  name: string
  description: string
  priority: TaskPriority
  status: "queued" | "running" | "completed" | "failed" | "timeout"
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: string
  error?: string
  retries: number
  maxRetries: number
  timeout: number
}

interface DaemonConfig {
  heartbeatInterval: number
  maxRetries: number
  taskTimeout: number
  concurrentTaskLimit: number
  stateFile: string
}

type WorkerState = "idle" | "running" | "paused" | "stopping"

interface WorkerMessage {
  type:
    | "config"
    | "start"
    | "stop"
    | "heartbeat"
    | "task:queued"
    | "pause"
    | "resume"
    | "task:result"
    | "task:failed"
    | "restart"
  payload?: unknown
}

// ============================================================================
// Constants
// ============================================================================

const DAEMON_STATE_FILE = ".opencode/daemon-state.json"

// ============================================================================
// State
// ============================================================================

let config: DaemonConfig = {
  heartbeatInterval: 30000,
  maxRetries: 3,
  taskTimeout: 300000,
  concurrentTaskLimit: 5,
  stateFile: DAEMON_STATE_FILE,
}

let workerState: WorkerState = "idle"
let currentDirectory: string = process.cwd()
let runningTasks: Map<string, NodeJS.Timeout> = new Map()
let heartbeatTimer: NodeJS.Timeout | null = null
let taskProcessorTimer: NodeJS.Timeout | null = null

// ============================================================================
// Persistence
// ============================================================================

interface PersistedDaemonState {
  config: DaemonConfig
  tasks: Task[]
  status: {
    state: string
    uptime: number
    startTime: string | null
    pid: number | null
    workerPid: number | null
    restartCount: number
    lastHeartbeat: string | null
  }
  events: Array<{ event: string; timestamp: string; data?: unknown }>
}

function loadDaemonState(): PersistedDaemonState | null {
  const path = join(currentDirectory, DAEMON_STATE_FILE)
  if (!existsSync(path)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function saveDaemonState(state: PersistedDaemonState): void {
  const path = join(currentDirectory, DAEMON_STATE_FILE)
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8")
}

function logEvent(state: PersistedDaemonState, event: string, data?: unknown): void {
  state.events.push({
    event,
    timestamp: new Date().toISOString(),
    data,
  })
  // Keep last 1000 events
  if (state.events.length > 1000) {
    state.events = state.events.slice(-1000)
  }
}

function updateTaskStatus(taskId: string, updates: Partial<Task>): void {
  const state = loadDaemonState()
  if (!state) return

  const taskIndex = state.tasks.findIndex((t) => t.id === taskId)
  if (taskIndex === -1) return

  state.tasks[taskIndex] = { ...state.tasks[taskIndex], ...updates }
  saveDaemonState(state)
}

// ============================================================================
// Task Processing
// ============================================================================

function getNextTask(): Task | null {
  const state = loadDaemonState()
  if (!state) return null

  // Get queued tasks sorted by priority
  const queuedTasks = state.tasks
    .filter((t) => t.status === "queued")
    .sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = {
        critical: 0,
        high: 1,
        normal: 2,
        low: 3,
      }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

  return queuedTasks[0] || null
}

function getRunningTaskCount(): number {
  const state = loadDaemonState()
  if (!state) return 0
  return state.tasks.filter((t) => t.status === "running").length
}

async function executeTask(task: Task): Promise<void> {
  workerState = "running"

  // Update task status
  updateTaskStatus(task.id, { status: "running", startedAt: new Date().toISOString() })

  // Set up task timeout
  const timeoutId = setTimeout(() => {
    handleTaskTimeout(task)
  }, task.timeout)

  runningTasks.set(task.id, timeoutId)

  try {
    // Simulate task execution
    // In a real implementation, this would execute the actual task
    // For now, we'll just mark it as completed after a delay
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Clear timeout
    clearTimeout(timeoutId)
    runningTasks.delete(task.id)

    // Mark as completed
    updateTaskStatus(task.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: `Task ${task.id} completed successfully`,
    })

    // Notify parent process
    process.send?.({ type: "task:completed", payload: { taskId: task.id } })
  } catch (error: any) {
    clearTimeout(timeoutId)
    runningTasks.delete(task.id)

    // Check if we should retry
    if (task.retries < task.maxRetries) {
      updateTaskStatus(task.id, {
        status: "queued",
        retries: task.retries + 1,
      })
      process.send?.({
        type: "task:failed",
        payload: { taskId: task.id, error: error.message, willRetry: true },
      })
    } else {
      updateTaskStatus(task.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error.message,
      })
      process.send?.({
        type: "task:failed",
        payload: { taskId: task.id, error: error.message, willRetry: false },
      })
    }
  }

  workerState = "idle"
}

function handleTaskTimeout(task: Task): void {
  clearTimeout(runningTasks.get(task.id))
  runningTasks.delete(task.id)

  if (task.retries < task.maxRetries) {
    updateTaskStatus(task.id, {
      status: "queued",
      retries: task.retries + 1,
    })
    process.send?.({
      type: "task:failed",
      payload: { taskId: task.id, error: "Task timeout", willRetry: true },
    })
  } else {
    updateTaskStatus(task.id, {
      status: "timeout",
      completedAt: new Date().toISOString(),
      error: "Task timeout - max retries exceeded",
    })
    process.send?.({
      type: "task:failed",
      payload: { taskId: task.id, error: "Task timeout", willRetry: false },
    })
  }
}

function processTaskQueue(): void {
  if (workerState === "paused" || workerState === "stopping") {
    return
  }

  const runningCount = getRunningTaskCount()

  // Start new tasks if we have capacity
  while (runningCount + runningTasks.size < config.concurrentTaskLimit) {
    const nextTask = getNextTask()
    if (!nextTask) break

    executeTask(nextTask)
  }
}

// ============================================================================
// Heartbeat
// ============================================================================

function startHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
  }

  heartbeatTimer = setInterval(() => {
    const state = loadDaemonState()
    if (state) {
      state.status.lastHeartbeat = new Date().toISOString()
      logEvent(state, "daemon:heartbeat", { pid: process.pid, runningTasks: runningTasks.size })
      saveDaemonState(state)
    }

    process.send?.({ type: "heartbeat" })
  }, config.heartbeatInterval)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(): void {
  workerState = "stopping"

  // Stop heartbeat
  stopHeartbeat()

  // Stop task processor
  if (taskProcessorTimer) {
    clearInterval(taskProcessorTimer)
    taskProcessorTimer = null
  }

  // Clear all running task timeouts
  for (const [taskId, timeoutId] of runningTasks) {
    clearTimeout(timeoutId)
    updateTaskStatus(taskId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: "Daemon shutdown",
    })
  }
  runningTasks.clear()

  // Update state
  const state = loadDaemonState()
  if (state) {
    state.status.state = "stopped"
    state.status.workerPid = null
    logEvent(state, "stop", { reason: "graceful shutdown" })
    saveDaemonState(state)
  }

  process.exit(0)
}

// Register signal handlers for graceful shutdown
process.on("SIGTERM", gracefulShutdown)
process.on("SIGINT", gracefulShutdown)

// ============================================================================
// Message Handler
// ============================================================================

process.on("message", (message: WorkerMessage) => {
  switch (message.type) {
    case "config":
      config = { ...config, ...(message.payload as Partial<DaemonConfig>) }
      // Restart heartbeat with new interval
      if (workerState === "running") {
        startHeartbeat()
      }
      break

    case "start":
      workerState = "idle"
      startHeartbeat()
      // Start task processor loop
      taskProcessorTimer = setInterval(processTaskQueue, 1000)
      processTaskQueue()
      break

    case "stop":
      gracefulShutdown()
      break

    case "heartbeat":
      const state = loadDaemonState()
      if (state) {
        state.status.lastHeartbeat = new Date().toISOString()
        saveDaemonState(state)
      }
      process.send?.({ type: "heartbeat" })
      break

    case "task:queued":
      processTaskQueue()
      break

    case "pause":
      workerState = "paused"
      break

    case "resume":
      workerState = "idle"
      processTaskQueue()
      break

    case "restart":
      // Restart worker
      gracefulShutdown()
      break
  }
})

// ============================================================================
// Initialize
// ============================================================================

console.log(`Daemon worker started: PID ${process.pid}`)

// Signal to parent that we're ready
process.send?.({ type: "started", payload: { pid: process.pid } })

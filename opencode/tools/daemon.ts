import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { fork, ChildProcess } from "child_process"

// ============================================================================
// Types
// ============================================================================

export type DaemonState = "stopped" | "starting" | "running" | "paused" | "stopping"

export type DaemonEvent =
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "heartbeat"
  | "task:queued"
  | "task:completed"
  | "task:failed"
  | "daemon:heartbeat"
  | "daemon:error"

export type TaskPriority = "low" | "normal" | "high" | "critical"

export interface Task {
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

export interface DaemonStatus {
  state: DaemonState
  uptime: number
  pid?: number
  tasks: {
    total: number
    queued: number
    running: number
    completed: number
    failed: number
  }
  lastHeartbeat: string | null
  nextHeartbeat: string | null
  restartCount: number
  workerPid?: number
}

export interface DaemonConfig {
  heartbeatInterval: number
  maxRetries: number
  taskTimeout: number
  concurrentTaskLimit: number
  stateFile: string
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: DaemonConfig = {
  heartbeatInterval: 30000,
  maxRetries: 3,
  taskTimeout: 300000,
  concurrentTaskLimit: 5,
  stateFile: ".opencode/daemon-state.json",
}

const DAEMON_STATE_FILE = ".opencode/daemon-state.json"
const DAEMON_WORKER_PATH = join(__dirname, "daemon-worker.ts")

// ============================================================================
// Persistence
// ============================================================================

interface PersistedDaemonState {
  config: DaemonConfig
  tasks: Task[]
  status: {
    state: DaemonState
    uptime: number
    startTime: string | null
    pid: number | null
    workerPid: number | null
    restartCount: number
    lastHeartbeat: string | null
  }
  events: Array<{ event: DaemonEvent; timestamp: string; data?: unknown }>
}

function loadDaemonState(directory: string): PersistedDaemonState | null {
  const path = join(directory, DAEMON_STATE_FILE)
  if (!existsSync(path)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function saveDaemonState(directory: string, state: PersistedDaemonState): void {
  const path = join(directory, DAEMON_STATE_FILE)
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8")
}

function createInitialState(directory: string, config: DaemonConfig): PersistedDaemonState {
  return {
    config,
    tasks: [],
    status: {
      state: "stopped",
      uptime: 0,
      startTime: null,
      pid: null,
      workerPid: null,
      restartCount: 0,
      lastHeartbeat: null,
    },
    events: [],
  }
}

// ============================================================================
// Event Logger
// ============================================================================

function logEvent(
  state: PersistedDaemonState,
  event: DaemonEvent,
  data?: unknown
): PersistedDaemonState {
  state.events.push({
    event,
    timestamp: new Date().toISOString(),
    data,
  })
  // Keep last 1000 events
  if (state.events.length > 1000) {
    state.events = state.events.slice(-1000)
  }
  return state
}

// ============================================================================
// Daemon Control
// ============================================================================

let workerProcess: ChildProcess | null = null
let heartbeatTimer: NodeJS.Timeout | null = null

function startWorker(directory: string, config: DaemonConfig): ChildProcess {
  if (workerProcess) {
    workerProcess.kill("SIGTERM")
  }

  const worker = fork(DAEMON_WORKER_PATH, [], {
    cwd: directory,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  })

  // Send initial config to worker
  worker.send({ type: "config", payload: config })
  worker.send({ type: "start" })

  return worker
}

function stopWorker(): void {
  if (workerProcess) {
    workerProcess.send({ type: "stop" })
    workerProcess.kill("SIGTERM")
    workerProcess = null
  }
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Start the daemon
 */
export const daemonStart = tool({
  description: "Start the daemon in background mode. The daemon will run as a persistent process that can execute tasks asynchronously.",
  args: {},
  async execute(_args, context) {
    const state = loadDaemonState(context.directory) || createInitialState(context.directory, DEFAULT_CONFIG)

    if (state.status.state === "running" || state.status.state === "starting") {
      return JSON.stringify({
        success: false,
        message: "Daemon is already running or starting",
        state: state.status.state,
        pid: state.status.pid,
      })
    }

    // Update state to starting
    state.status.state = "starting"
    state.status.startTime = new Date().toISOString()
    state.status.pid = process.pid
    state.status.restartCount = 0
    state.status.lastHeartbeat = new Date().toISOString()
    logEvent(state, "start")
    saveDaemonState(context.directory, state)

    // Start the worker process
    try {
      workerProcess = startWorker(context.directory, state.config)
      state.status.workerPid = workerProcess.pid ?? null
      state.status.state = "running"
      logEvent(state, "daemon:heartbeat", { pid: workerProcess.pid })
      saveDaemonState(context.directory, state)

      // Set up heartbeat monitoring
      heartbeatTimer = setInterval(() => {
        if (workerProcess && workerProcess.connected) {
          workerProcess.send({ type: "heartbeat" })
        }
      }, state.config.heartbeatInterval)

      return JSON.stringify({
        success: true,
        message: "Daemon started successfully",
        state: "running",
        pid: workerProcess.pid,
        config: {
          heartbeatInterval: state.config.heartbeatInterval,
          maxRetries: state.config.maxRetries,
          concurrentTaskLimit: state.config.concurrentTaskLimit,
        },
      })
    } catch (error: any) {
      state.status.state = "stopped"
      logEvent(state, "daemon:error", { error: error.message })
      saveDaemonState(context.directory, state)
      return JSON.stringify({
        success: false,
        message: `Failed to start daemon: ${error.message}`,
        state: "stopped",
      })
    }
  },
})

/**
 * Stop the daemon
 */
export const daemonStop = tool({
  description: "Stop the daemon gracefully. Will wait for running tasks to complete before shutting down.",
  args: {
    force: tool.schema.boolean().optional().describe("Force immediate shutdown even if tasks are running"),
  },
  async execute(args, context) {
    const state = loadDaemonState(context.directory)

    if (!state || state.status.state === "stopped" || state.status.state === "stopping") {
      return JSON.stringify({
        success: false,
        message: "Daemon is not running",
        state: "stopped",
      })
    }

    // Update state to stopping
    state.status.state = "stopping"
    logEvent(state, "stop", { force: args.force })
    saveDaemonState(context.directory, state)

    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    // Stop worker
    stopWorker()

    // Update state to stopped
    state.status.state = "stopped"
    state.status.uptime = state.status.startTime
      ? Date.now() - new Date(state.status.startTime).getTime()
      : 0
    state.status.startTime = null
    state.status.pid = null
    state.status.workerPid = null
    saveDaemonState(context.directory, state)

    return JSON.stringify({
      success: true,
      message: "Daemon stopped successfully",
      state: "stopped",
      uptime: state.status.uptime,
    })
  },
})

/**
 * Get daemon status
 */
export const daemonStatus = tool({
  description: "Get the current status of the daemon including state, uptime, task counts, and worker health.",
  args: {},
  async execute(_args, context) {
    const state = loadDaemonState(context.directory)

    if (!state) {
      return JSON.stringify({
        state: "stopped" as DaemonState,
        uptime: 0,
        tasks: { total: 0, queued: 0, running: 0, completed: 0, failed: 0 },
        lastHeartbeat: null,
        nextHeartbeat: null,
        restartCount: 0,
      })
    }

    const uptime = state.status.startTime
      ? Date.now() - new Date(state.status.startTime).getTime()
      : state.status.uptime

    const tasks = {
      total: state.tasks.length,
      queued: state.tasks.filter((t) => t.status === "queued").length,
      running: state.tasks.filter((t) => t.status === "running").length,
      completed: state.tasks.filter((t) => t.status === "completed").length,
      failed: state.tasks.filter((t) => t.status === "failed").length,
    }

    const nextHeartbeat = state.status.lastHeartbeat
      ? new Date(new Date(state.status.lastHeartbeat).getTime() + state.config.heartbeatInterval).toISOString()
      : null

    return JSON.stringify({
      state: state.status.state,
      uptime,
      pid: state.status.pid,
      tasks,
      lastHeartbeat: state.status.lastHeartbeat,
      nextHeartbeat,
      restartCount: state.status.restartCount,
      workerPid: state.status.workerPid,
    })
  },
})

/**
 * Queue a task for background execution
 */
export const daemonQueueTask = tool({
  description: "Add a task to the daemon's background task queue. Tasks are processed based on priority.",
  args: {
    name: tool.schema.string().describe("Name/description of the task"),
    description: tool.schema.string().describe("Detailed description of what the task should do"),
    priority: tool.schema
      .enum(["low", "normal", "high", "critical"])
      .optional()
      .describe("Task priority (default: normal)"),
    maxRetries: tool.schema.number().optional().describe("Maximum retry attempts (default: 3)"),
    timeout: tool.schema.number().optional().describe("Task timeout in ms (default: 300000)"),
  },
  async execute(args, context) {
    const state = loadDaemonState(context.directory) || createInitialState(context.directory, DEFAULT_CONFIG)

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const task: Task = {
      id: taskId,
      name: args.name,
      description: args.description,
      priority: args.priority || "normal",
      status: "queued",
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: args.maxRetries || state.config.maxRetries,
      timeout: args.timeout || state.config.taskTimeout,
    }

    state.tasks.push(task)
    logEvent(state, "task:queued", { taskId, priority: task.priority })
    saveDaemonState(context.directory, state)

    // Notify worker if running
    if (workerProcess && workerProcess.connected && state.status.state === "running") {
      workerProcess.send({ type: "task:queued", payload: task })
    }

    return JSON.stringify({
      success: true,
      message: `Task queued successfully`,
      task: {
        id: task.id,
        name: task.name,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
      },
    })
  },
})

/**
 * List queued and running tasks
 */
export const daemonListTasks = tool({
  description: "List all tasks in the daemon queue including their status, priority, and execution details.",
  args: {
    status: tool.schema
      .enum(["all", "queued", "running", "completed", "failed"])
      .optional()
      .describe("Filter by task status"),
    limit: tool.schema.number().optional().describe("Maximum number of tasks to return (default: 50)"),
  },
  async execute(args, context) {
    const state = loadDaemonState(context.directory)

    if (!state) {
      return JSON.stringify({ tasks: [], total: 0 })
    }

    let tasks = state.tasks

    if (args.status && args.status !== "all") {
      tasks = tasks.filter((t) => t.status === args.status)
    }

    // Sort by priority (critical first) then by creation time
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
    tasks = tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    const limit = args.limit || 50
    const limitedTasks = tasks.slice(0, limit)

    return JSON.stringify({
      tasks: limitedTasks.map((t) => ({
        id: t.id,
        name: t.name,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        retries: t.retries,
      })),
      total: tasks.length,
      filtered: args.status || "all",
    })
  },
})

/**
 * Pause the daemon (stop processing new tasks but keep running)
 */
export const daemonPause = tool({
  description: "Pause the daemon. Running tasks will complete but no new tasks will be started.",
  args: {},
  async execute(_args, context) {
    const state = loadDaemonState(context.directory)

    if (!state || state.status.state !== "running") {
      return JSON.stringify({
        success: false,
        message: "Daemon is not running",
        state: state?.status.state || "stopped",
      })
    }

    state.status.state = "paused"
    logEvent(state, "pause")
    saveDaemonState(context.directory, state)

    // Notify worker
    if (workerProcess && workerProcess.connected) {
      workerProcess.send({ type: "pause" })
    }

    return JSON.stringify({
      success: true,
      message: "Daemon paused",
      state: "paused",
    })
  },
})

/**
 * Resume the daemon from paused state
 */
export const daemonResume = tool({
  description: "Resume a paused daemon to start processing queued tasks again.",
  args: {},
  async execute(_args, context) {
    const state = loadDaemonState(context.directory)

    if (!state || state.status.state !== "paused") {
      return JSON.stringify({
        success: false,
        message: "Daemon is not paused",
        state: state?.status.state || "stopped",
      })
    }

    state.status.state = "running"
    logEvent(state, "resume")
    saveDaemonState(context.directory, state)

    // Notify worker
    if (workerProcess && workerProcess.connected) {
      workerProcess.send({ type: "resume" })
    }

    return JSON.stringify({
      success: true,
      message: "Daemon resumed",
      state: "running",
    })
  },
})

/**
 * Get daemon event log
 */
export const daemonEventLog = tool({
  description: "Get the daemon event log for debugging and monitoring.",
  args: {
    eventType: tool.schema
      .enum(["all", "task:queued", "task:completed", "task:failed", "daemon:heartbeat", "daemon:error"])
      .optional()
      .describe("Filter by event type"),
    limit: tool.schema.number().optional().describe("Maximum number of events to return (default: 100)"),
  },
  async execute(args, context) {
    const state = loadDaemonState(context.directory)

    if (!state) {
      return JSON.stringify({ events: [], total: 0 })
    }

    let events = state.events

    if (args.eventType && args.eventType !== "all") {
      events = events.filter((e) => e.event === args.eventType)
    }

    const limit = args.limit || 100
    const limitedEvents = events.slice(-limit)

    return JSON.stringify({
      events: limitedEvents,
      total: events.length,
    })
  },
})

/**
 * Configure daemon settings
 */
export const daemonConfigure = tool({
  description: "Configure daemon settings such as heartbeat interval, max retries, and concurrent task limit.",
  args: {
    heartbeatInterval: tool.schema.number().optional().describe("Heartbeat interval in ms (default: 30000)"),
    maxRetries: tool.schema.number().optional().describe("Maximum retry attempts (default: 3)"),
    taskTimeout: tool.schema.number().optional().describe("Task timeout in ms (default: 300000)"),
    concurrentTaskLimit: tool.schema.number().optional().describe("Max concurrent tasks (default: 5)"),
  },
  async execute(args, context) {
    const state = loadDaemonState(context.directory) || createInitialState(context.directory, DEFAULT_CONFIG)

    // Update config
    if (args.heartbeatInterval !== undefined) {
      state.config.heartbeatInterval = args.heartbeatInterval
    }
    if (args.maxRetries !== undefined) {
      state.config.maxRetries = args.maxRetries
    }
    if (args.taskTimeout !== undefined) {
      state.config.taskTimeout = args.taskTimeout
    }
    if (args.concurrentTaskLimit !== undefined) {
      state.config.concurrentTaskLimit = args.concurrentTaskLimit
    }

    saveDaemonState(context.directory, state)

    // Notify worker of config change if running
    if (workerProcess && workerProcess.connected) {
      workerProcess.send({ type: "config", payload: state.config })
    }

    return JSON.stringify({
      success: true,
      message: "Daemon configuration updated",
      config: state.config,
    })
  },
})

// ============================================================================
// Feature Flag Check
// ============================================================================

function isDaemonModeEnabled(directory: string): boolean {
  try {
    const flagsPath = join(directory, ".opencode/feature-flags.json")
    if (!existsSync(flagsPath)) {
      return false
    }
    const flagsData = JSON.parse(readFileSync(flagsPath, "utf-8"))
    return flagsData.flags?.daemon_mode_enabled?.enabled === true
  } catch {
    return false
  }
}

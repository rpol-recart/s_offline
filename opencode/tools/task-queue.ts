import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

// ============================================================================
// Types
// ============================================================================

export type TaskType = "code" | "research" | "review" | "test" | "custom"
export type TaskPriority = "critical" | "high" | "normal" | "low"
export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled"

export interface QueuedTask {
  id: string
  type: TaskType
  payload: unknown
  priority: TaskPriority
  status: TaskStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
  retries: number
  maxRetries: number
}

export interface QueueConfig {
  concurrentLimit: number
  defaultMaxRetries: number
  baseBackoffMs: number
  maxBackoffMs: number
  taskTimeoutMs: number
  storageDir: string
}

export interface QueueStats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  cancelled: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: QueueConfig = {
  concurrentLimit: 5,
  defaultMaxRetries: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 60000,
  taskTimeoutMs: 300000,
  storageDir: ".opencode/task-queue",
}

const QUEUE_FILE = "queue.json"

// ============================================================================
// Priority Order (lower = higher priority)
// ============================================================================

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

// ============================================================================
// Storage Helpers
// ============================================================================

function ensureDirectories(baseDir: string): void {
  const queueDir = join(baseDir, DEFAULT_CONFIG.storageDir)
  const completedDir = join(queueDir, "completed")
  const failedDir = join(queueDir, "failed")
  const logsDir = join(queueDir, "logs")

  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true })
  }
  if (!existsSync(completedDir)) {
    mkdirSync(completedDir, { recursive: true })
  }
  if (!existsSync(failedDir)) {
    mkdirSync(failedDir, { recursive: true })
  }
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }
}

function getQueuePath(directory: string): string {
  return join(directory, DEFAULT_CONFIG.storageDir, QUEUE_FILE)
}

function getCompletedPath(directory: string, taskId: string): string {
  return join(directory, DEFAULT_CONFIG.storageDir, "completed", `${taskId}.json`)
}

function getFailedPath(directory: string, taskId: string): string {
  return join(directory, DEFAULT_CONFIG.storageDir, "failed", `${taskId}.json`)
}

function getLogPath(directory: string): string {
  return join(directory, DEFAULT_CONFIG.storageDir, "logs", "queue.log")
}

interface PersistedQueue {
  tasks: QueuedTask[]
  config: QueueConfig
}

function loadQueue(directory: string): PersistedQueue {
  const path = getQueuePath(directory)
  ensureDirectories(directory)

  if (!existsSync(path)) {
    return { tasks: [], config: { ...DEFAULT_CONFIG } }
  }

  try {
    const data = readFileSync(path, "utf-8")
    return JSON.parse(data)
  } catch {
    return { tasks: [], config: { ...DEFAULT_CONFIG } }
  }
}

function saveQueue(directory: string, queue: PersistedQueue): void {
  const path = getQueuePath(directory)
  ensureDirectories(directory)
  writeFileSync(path, JSON.stringify(queue, null, 2), "utf-8")
}

function logEvent(directory: string, event: string, data?: unknown): void {
  const logPath = getLogPath(directory)
  ensureDirectories(directory)

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    data,
  }

  const logLine = JSON.stringify(entry) + "\n"

  if (existsSync(logPath)) {
    const content = readFileSync(logPath, "utf-8")
    const lines = content.split("\n").filter(Boolean)
    // Keep last 5000 entries
    const trimmed = lines.length > 5000 ? lines.slice(-5000) : lines
    writeFileSync(logPath, trimmed.join("\n") + "\n" + logLine, "utf-8")
  } else {
    writeFileSync(logPath, logLine, "utf-8")
  }
}

// ============================================================================
// Queue Operations
// ============================================================================

function sortTasks(tasks: QueuedTask[]): QueuedTask[] {
  return tasks.sort((a, b) => {
    // First by priority
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priorityDiff !== 0) return priorityDiff
    // Then by creation time (FIFO)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function calculateBackoff(retries: number, config: QueueConfig): number {
  const backoff = Math.min(
    config.baseBackoffMs * Math.pow(2, retries),
    config.maxBackoffMs
  )
  // Add jitter (±10%)
  const jitter = backoff * 0.1 * (Math.random() * 2 - 1)
  return Math.floor(backoff + jitter)
}

// ============================================================================
// Tool: enqueue
// ============================================================================

export const enqueue = tool({
  description: "Add a task to the background task queue. Tasks are processed based on priority.",
  args: {
    type: tool.schema
      .enum(["code", "research", "review", "test", "custom"])
      .describe("Type of task"),
    payload: tool.schema.any().describe("Task payload data"),
    priority: tool.schema
      .enum(["critical", "high", "normal", "low"])
      .optional()
      .describe("Task priority (default: normal)"),
    max_retries: tool.schema.number().optional().describe("Max retry attempts (default: 3)"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const task: QueuedTask = {
      id: taskId,
      type: args.type,
      payload: args.payload,
      priority: args.priority || "normal",
      status: "queued",
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: args.max_retries ?? queue.config.defaultMaxRetries,
    }

    queue.tasks.push(task)
    queue.tasks = sortTasks(queue.tasks)
    saveQueue(context.directory, queue)
    logEvent(context.directory, "task:enqueued", { taskId, type: task.type, priority: task.priority })

    return JSON.stringify({
      success: true,
      taskId,
      message: `Task ${taskId} enqueued with priority ${task.priority}`,
      queueSize: queue.tasks.length,
    })
  },
})

// ============================================================================
// Tool: dequeue
// ============================================================================

export const dequeue = tool({
  description: "Get the next task from the queue (FIFO with priority ordering) without removing it.",
  args: {},
  async execute(_args, context) {
    const queue = loadQueue(context.directory)

    // Get next queued task
    const queuedTasks = queue.tasks
      .filter((t) => t.status === "queued")
      .sort((a, b) => {
        const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })

    if (queuedTasks.length === 0) {
      return JSON.stringify({
        hasTask: false,
        message: "Queue is empty",
        queueSize: 0,
      })
    }

    const task = queuedTasks[0]
    task.status = "processing"
    task.startedAt = new Date().toISOString()

    // Update in queue
    const taskIndex = queue.tasks.findIndex((t) => t.id === task.id)
    if (taskIndex !== -1) {
      queue.tasks[taskIndex] = task
    }

    saveQueue(context.directory, queue)
    logEvent(context.directory, "task:dequeued", { taskId: task.id, type: task.type })

    return JSON.stringify({
      hasTask: true,
      task: {
        id: task.id,
        type: task.type,
        payload: task.payload,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        retries: task.retries,
        maxRetries: task.maxRetries,
      },
      queueSize: queue.tasks.filter((t) => t.status === "queued").length,
    })
  },
})

// ============================================================================
// Tool: peek
// ============================================================================

export const peek = tool({
  description: "View the next task without removing it from the queue.",
  args: {
    count: tool.schema.number().optional().describe("Number of tasks to peek (default: 1, max: 10)"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const queuedTasks = queue.tasks
      .filter((t) => t.status === "queued")
      .sort((a, b) => {
        const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })

    const peekCount = Math.min(args.count || 1, 10)
    const peekedTasks = queuedTasks.slice(0, peekCount)

    if (peekedTasks.length === 0) {
      return JSON.stringify({
        hasTasks: false,
        message: "Queue is empty",
        queueSize: 0,
      })
    }

    return JSON.stringify({
      hasTasks: true,
      tasks: peekedTasks.map((t) => ({
        id: t.id,
        type: t.type,
        priority: t.status,
        createdAt: t.createdAt,
        retries: t.retries,
      })),
      queueSize: queue.tasks.length,
      queuedCount: queuedTasks.length,
    })
  },
})

// ============================================================================
// Tool: size
// ============================================================================

export const size = tool({
  description: "Get the current queue size and statistics.",
  args: {},
  async execute(_args, context) {
    const queue = loadQueue(context.directory)

    const stats: QueueStats = {
      total: queue.tasks.length,
      queued: queue.tasks.filter((t) => t.status === "queued").length,
      processing: queue.tasks.filter((t) => t.status === "processing").length,
      completed: queue.tasks.filter((t) => t.status === "completed").length,
      failed: queue.tasks.filter((t) => t.status === "failed").length,
      cancelled: queue.tasks.filter((t) => t.status === "cancelled").length,
    }

    return JSON.stringify({
      stats,
      message: `Queue has ${stats.queued} queued tasks, ${stats.processing} processing`,
    })
  },
})

// ============================================================================
// Tool: complete_task
// ============================================================================

export const completeTask = tool({
  description: "Mark a task as completed with result.",
  args: {
    task_id: tool.schema.string().describe("Task ID to complete"),
    result: tool.schema.any().optional().describe("Task execution result"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const taskIndex = queue.tasks.findIndex((t) => t.id === args.task_id)
    if (taskIndex === -1) {
      return JSON.stringify({
        success: false,
        message: `Task ${args.task_id} not found in queue`,
      })
    }

    const task = queue.tasks[taskIndex]
    task.status = "completed"
    task.completedAt = new Date().toISOString()
    task.result = args.result

    // Archive to completed
    const completedPath = getCompletedPath(context.directory, task.id)
    writeFileSync(completedPath, JSON.stringify(task, null, 2), "utf-8")

    // Remove from active queue
    queue.tasks.splice(taskIndex, 1)
    saveQueue(context.directory, queue)

    logEvent(context.directory, "task:completed", { taskId: task.id })

    return JSON.stringify({
      success: true,
      taskId: task.id,
      message: `Task ${task.id} marked as completed`,
    })
  },
})

// ============================================================================
// Tool: fail_task
// ============================================================================

export const failTask = tool({
  description: "Mark a task as failed. Supports automatic retry with exponential backoff.",
  args: {
    task_id: tool.schema.string().describe("Task ID that failed"),
    error: tool.schema.string().describe("Error message"),
    force: tool.schema.boolean().optional().describe("Force failure without retry"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const taskIndex = queue.tasks.findIndex((t) => t.id === args.task_id)
    if (taskIndex === -1) {
      return JSON.stringify({
        success: false,
        message: `Task ${args.task_id} not found in queue`,
      })
    }

    const task = queue.tasks[taskIndex]

    if (args.force || task.retries >= task.maxRetries) {
      // Permanent failure
      task.status = "failed"
      task.completedAt = new Date().toISOString()
      task.error = args.error

      // Archive to failed
      const failedPath = getFailedPath(context.directory, task.id)
      writeFileSync(failedPath, JSON.stringify(task, null, 2), "utf-8")

      // Remove from active queue
      queue.tasks.splice(taskIndex, 1)
      saveQueue(context.directory, queue)

      logEvent(context.directory, "task:failed", { taskId: task.id, error: args.error, permanent: true })

      return JSON.stringify({
        success: true,
        taskId: task.id,
        message: `Task ${task.id} marked as permanently failed`,
        permanent: true,
      })
    } else {
      // Schedule retry with backoff
      task.retries++
      const backoffMs = calculateBackoff(task.retries, queue.config)

      logEvent(context.directory, "task:retry_scheduled", {
        taskId: task.id,
        retry: task.retries,
        maxRetries: task.maxRetries,
        backoffMs,
      })

      // Reset to queued for retry after backoff
      task.status = "queued"
      task.error = args.error

      queue.tasks[taskIndex] = task
      saveQueue(context.directory, queue)

      return JSON.stringify({
        success: true,
        taskId: task.id,
        message: `Task ${task.id} scheduled for retry ${task.retries}/${task.maxRetries} after ${backoffMs}ms`,
        willRetry: true,
        retryInMs: backoffMs,
        retry: task.retries,
        maxRetries: task.maxRetries,
      })
    }
  },
})

// ============================================================================
// Tool: cancel_task
// ============================================================================

export const cancelTask = tool({
  description: "Cancel a queued or processing task.",
  args: {
    task_id: tool.schema.string().describe("Task ID to cancel"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const taskIndex = queue.tasks.findIndex((t) => t.id === args.task_id)
    if (taskIndex === -1) {
      return JSON.stringify({
        success: false,
        message: `Task ${args.task_id} not found in queue`,
      })
    }

    const task = queue.tasks[taskIndex]

    if (task.status === "completed" || task.status === "failed") {
      return JSON.stringify({
        success: false,
        message: `Cannot cancel task in ${task.status} state`,
        status: task.status,
      })
    }

    task.status = "cancelled"
    task.completedAt = new Date().toISOString()

    // Archive to failed (cancelled tasks go there too)
    const failedPath = getFailedPath(context.directory, task.id)
    writeFileSync(failedPath, JSON.stringify(task, null, 2), "utf-8")

    // Remove from active queue
    queue.tasks.splice(taskIndex, 1)
    saveQueue(context.directory, queue)

    logEvent(context.directory, "task:cancelled", { taskId: task.id })

    return JSON.stringify({
      success: true,
      taskId: task.id,
      message: `Task ${task.id} cancelled`,
    })
  },
})

// ============================================================================
// Tool: list_tasks
// ============================================================================

export const listTasks = tool({
  description: "List tasks in the queue with optional filtering.",
  args: {
    status: tool.schema
      .enum(["all", "queued", "processing", "completed", "failed", "cancelled"])
      .optional()
      .describe("Filter by status (default: all)"),
    type: tool.schema
      .enum(["all", "code", "research", "review", "test", "custom"])
      .optional()
      .describe("Filter by task type"),
    limit: tool.schema.number().optional().describe("Max results (default: 50)"),
    offset: tool.schema.number().optional().describe("Pagination offset (default: 0)"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    let tasks = queue.tasks

    // Filter by status
    if (args.status && args.status !== "all") {
      tasks = tasks.filter((t) => t.status === args.status)
    }

    // Filter by type
    if (args.type && args.type !== "all") {
      tasks = tasks.filter((t) => t.type === args.type)
    }

    // Sort by priority and creation time
    tasks = sortTasks([...tasks])

    // Pagination
    const offset = args.offset || 0
    const limit = args.limit || 50
    const paginatedTasks = tasks.slice(offset, offset + limit)

    return JSON.stringify({
      tasks: paginatedTasks.map((t) => ({
        id: t.id,
        type: t.type,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        retries: t.retries,
        maxRetries: t.maxRetries,
      })),
      total: tasks.length,
      offset,
      limit,
      hasMore: offset + limit < tasks.length,
    })
  },
})

// ============================================================================
// Tool: get_task
// ============================================================================

export const getTask = tool({
  description: "Get details of a specific task by ID.",
  args: {
    task_id: tool.schema.string().describe("Task ID to retrieve"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const task = queue.tasks.find((t) => t.id === args.task_id)

    if (task) {
      return JSON.stringify({ found: true, task })
    }

    // Check completed archive
    const completedPath = getCompletedPath(context.directory, args.task_id)
    if (existsSync(completedPath)) {
      try {
        const completedData = readFileSync(completedPath, "utf-8")
        return JSON.stringify({ found: true, task: JSON.parse(completedData), archived: true })
      } catch {
        // Fall through to not found
      }
    }

    // Check failed archive
    const failedPath = getFailedPath(context.directory, args.task_id)
    if (existsSync(failedPath)) {
      try {
        const failedData = readFileSync(failedPath, "utf-8")
        return JSON.stringify({ found: true, task: JSON.parse(failedData), archived: true })
      } catch {
        // Fall through to not found
      }
    }

    return JSON.stringify({
      found: false,
      message: `Task ${args.task_id} not found`,
    })
  },
})

// ============================================================================
// Tool: configure_queue
// ============================================================================

export const configureQueue = tool({
  description: "Configure the task queue settings.",
  args: {
    concurrent_limit: tool.schema.number().optional().describe("Max concurrent tasks (default: 5)"),
    default_max_retries: tool.schema.number().optional().describe("Default max retries (default: 3)"),
    base_backoff_ms: tool.schema.number().optional().describe("Base backoff in ms (default: 1000)"),
    max_backoff_ms: tool.schema.number().optional().describe("Max backoff in ms (default: 60000)"),
    task_timeout_ms: tool.schema.number().optional().describe("Task timeout in ms (default: 300000)"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    if (args.concurrent_limit !== undefined) {
      queue.config.concurrentLimit = args.concurrent_limit
    }
    if (args.default_max_retries !== undefined) {
      queue.config.defaultMaxRetries = args.default_max_retries
    }
    if (args.base_backoff_ms !== undefined) {
      queue.config.baseBackoffMs = args.base_backoff_ms
    }
    if (args.max_backoff_ms !== undefined) {
      queue.config.maxBackoffMs = args.max_backoff_ms
    }
    if (args.task_timeout_ms !== undefined) {
      queue.config.taskTimeoutMs = args.task_timeout_ms
    }

    saveQueue(context.directory, queue)

    logEvent(context.directory, "queue:configured", { config: queue.config })

    return JSON.stringify({
      success: true,
      message: "Queue configuration updated",
      config: queue.config,
    })
  },
})

// ============================================================================
// Tool: get_queue_config
// ============================================================================

export const getQueueConfig = tool({
  description: "Get current queue configuration.",
  args: {},
  async execute(_args, context) {
    const queue = loadQueue(context.directory)
    return JSON.stringify({ config: queue.config })
  },
})

// ============================================================================
// Tool: clear_queue
// ============================================================================

export const clearQueue = tool({
  description: "Clear all queued tasks. Does not affect processing or completed tasks.",
  args: {
    force: tool.schema.boolean().optional().describe("Skip confirmation check"),
  },
  async execute(args, context) {
    const queue = loadQueue(context.directory)

    const queuedTasks = queue.tasks.filter((t) => t.status === "queued")
    const processingTasks = queue.tasks.filter((t) => t.status === "processing")

    if (processingTasks.length > 0 && !args.force) {
      return JSON.stringify({
        success: false,
        message: "Cannot clear queue while tasks are processing. Use force=true to override.",
        processingCount: processingTasks.length,
      })
    }

    // Archive queued tasks as cancelled
    for (const task of queuedTasks) {
      task.status = "cancelled"
      task.completedAt = new Date().toISOString()
      const failedPath = getFailedPath(context.directory, task.id)
      writeFileSync(failedPath, JSON.stringify(task, null, 2), "utf-8")
    }

    // Remove queued tasks, keep processing
    queue.tasks = queue.tasks.filter((t) => t.status === "processing")
    saveQueue(context.directory, queue)

    logEvent(context.directory, "queue:cleared", { clearedCount: queuedTasks.length })

    return JSON.stringify({
      success: true,
      message: `Cleared ${queuedTasks.length} queued tasks`,
      clearedCount: queuedTasks.length,
      remainingProcessing: processingTasks.length,
    })
  },
})

// ============================================================================
// Tool: get_queue_logs
// ============================================================================

export const getQueueLogs = tool({
  description: "Get queue event logs for debugging and monitoring.",
  args: {
    limit: tool.schema.number().optional().describe("Number of log entries (default: 100)"),
    task_id: tool.schema.string().optional().describe("Filter by task ID"),
  },
  async execute(args, context) {
    const logPath = getLogPath(context.directory)

    if (!existsSync(logPath)) {
      return JSON.stringify({ logs: [], total: 0 })
    }

    try {
      const content = readFileSync(logPath, "utf-8")
      const lines = content.split("\n").filter(Boolean)

      let logs = lines.map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return { timestamp: null, event: "unknown", data: line }
        }
      })

      // Filter by task_id if specified
      if (args.task_id) {
        logs = logs.filter((log) => {
          if (log.data && typeof log.data === "object") {
            return log.data.taskId === args.task_id
          }
          return false
        })
      }

      const limit = args.limit || 100
      const recentLogs = logs.slice(-limit)

      return JSON.stringify({
        logs: recentLogs,
        total: logs.length,
        filtered: args.task_id ? `task_id=${args.task_id}` : "all",
      })
    } catch {
      return JSON.stringify({ logs: [], total: 0 })
    }
  },
})

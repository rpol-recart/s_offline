import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs"
import { join, basename } from "path"

// ============================================================================
// Types
// ============================================================================

export type SyncState = "synced" | "pending" | "conflict"
export type ConflictResolution = "last_write_wins" | "manual"

export interface Workspace {
  id: string
  name?: string
  path: string
  createdAt: string
  updatedAt: string
  lastSyncedAt?: string
  syncState: SyncState
  metadata: Record<string, unknown>
}

export interface WorkspaceSummary {
  id: string
  name?: string
  path: string
  syncState: SyncState
  createdAt: string
  lastSyncedAt?: string
}

export interface SharedContext {
  id: string
  fromWorkspaceId: string
  toWorkspaceId: string
  content: Record<string, unknown>
  sharedAt: string
  read: boolean
}

export interface KVStore {
  [key: string]: {
    value: unknown
    updatedAt: string
    workspaceId?: string
  }
}

interface WorkspaceIndex {
  workspaces: string[]
  currentWorkspaceId: string | null
  lastModified: string
}

interface SharedContextIndex {
  contexts: SharedContext[]
}

interface SyncLock {
  workspaceId: string
  timestamp: string
  owner: string
}

// ============================================================================
// Constants
// ============================================================================

const WORKSPACES_DIR = ".opencode/workspaces"
const WORKSPACE_INDEX_FILE = ".opencode/workspaces/index.json"
const SHARED_DIR = ".opencode/shared"
const KV_STORE_FILE = ".opencode/shared/kv-store.json"
const SHARED_CONTEXT_INDEX_FILE = ".opencode/shared/context-index.json"
const LOCK_FILE = ".opencode/workspaces/.lock"
const SYNC_LOCK_FILE = ".opencode/workspaces/.sync-lock"

const FEATURE_FLAG_ID = "multi_workspace_sync"

// ============================================================================
// Utility Functions
// ============================================================================

function getWorkspacesDir(context: { directory: string }): string {
  return join(context.directory, WORKSPACES_DIR)
}

function getSharedDir(context: { directory: string }): string {
  return join(context.directory, SHARED_DIR)
}

function getWorkspacePath(context: { directory: string }, workspaceId: string): string {
  return join(getWorkspacesDir(context), `${workspaceId}.json`)
}

function getWorkspaceStateDir(context: { directory: string }, workspaceId: string): string {
  return join(getWorkspacesDir(context), workspaceId)
}

function getIndexPath(context: { directory: string }): string {
  return join(context.directory, WORKSPACE_INDEX_FILE)
}

function getKVStorePath(context: { directory: string }): string {
  return join(context.directory, KV_STORE_FILE)
}

function getContextIndexPath(context: { directory: string }): string {
  return join(context.directory, SHARED_CONTEXT_INDEX_FILE)
}

function getLockPath(context: { directory: string }): string {
  return join(context.directory, LOCK_FILE)
}

function getSyncLockPath(context: { directory: string }): string {
  return join(context.directory, SYNC_LOCK_FILE)
}

function ensureWorkspacesDir(context: { directory: string }): void {
  const dir = getWorkspacesDir(context)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureSharedDir(context: { directory: string }): void {
  const dir = getSharedDir(context)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureWorkspaceStateDir(context: { directory: string }, workspaceId: string): void {
  const dir = getWorkspaceStateDir(context, workspaceId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function generateId(prefix: string = "ws"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function loadIndex(context: { directory: string }): WorkspaceIndex {
  const indexPath = getIndexPath(context)
  if (!existsSync(indexPath)) {
    return {
      workspaces: [],
      currentWorkspaceId: null,
      lastModified: new Date().toISOString(),
    }
  }
  try {
    return JSON.parse(readFileSync(indexPath, "utf-8"))
  } catch {
    return {
      workspaces: [],
      currentWorkspaceId: null,
      lastModified: new Date().toISOString(),
    }
  }
}

function saveIndex(context: { directory: string }, index: WorkspaceIndex): void {
  const indexPath = getIndexPath(context)
  ensureWorkspacesDir(context)
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8")
}

function loadKVStore(context: { directory: string }): KVStore {
  const path = getKVStorePath(context)
  if (!existsSync(path)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return {}
  }
}

function saveKVStore(context: { directory: string }, store: KVStore): void {
  const path = getKVStorePath(context)
  ensureSharedDir(context)
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8")
}

function loadContextIndex(context: { directory: string }): SharedContextIndex {
  const path = getContextIndexPath(context)
  if (!existsSync(path)) {
    return { contexts: [] }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return { contexts: [] }
  }
}

function saveContextIndex(context: { directory: string }, index: SharedContextIndex): void {
  const path = getContextIndexPath(context)
  ensureSharedDir(context)
  writeFileSync(path, JSON.stringify(index, null, 2), "utf-8")
}

// File-based locking for concurrent access
function acquireLock(context: { directory: string }, lockType: "access" | "sync" = "access"): boolean {
  const lockPath = lockType === "access" ? getLockPath(context) : getSyncLockPath(context)
  if (existsSync(lockPath)) {
    try {
      const lockData: SyncLock = JSON.parse(readFileSync(lockPath, "utf-8"))
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime()
      if (lockAge > 30000) {
        // Stale lock, remove it
        unlinkSync(lockPath)
      } else {
        return false
      }
    } catch {
      unlinkSync(lockPath)
    }
  }
  const lock: SyncLock = {
    workspaceId: "lock",
    timestamp: new Date().toISOString(),
    owner: generateId("owner"),
  }
  writeFileSync(lockPath, JSON.stringify(lock), "utf-8")
  return true
}

function releaseLock(context: { directory: string }, lockType: "access" | "sync" = "access"): void {
  const lockPath = lockType === "access" ? getLockPath(context) : getSyncLockPath(context)
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath)
    } catch {
      // Ignore errors on lock removal
    }
  }
}

// Check if feature is enabled
async function isFeatureEnabled(context: { directory: string }): Promise<boolean> {
  try {
    const configPath = join(context.directory, ".opencode/feature-flags.json")
    if (!existsSync(configPath)) {
      return false
    }
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return config.flags?.[FEATURE_FLAG_ID]?.enabled === true
  } catch {
    return false
  }
}

// ============================================================================
// Workspace Registry Tools
// ============================================================================

/**
 * Register a new workspace
 */
export const registerWorkspace = tool({
  description: "Register a new workspace for multi-workspace sync",
  args: {
    path: tool.schema.string().describe("Absolute path to the workspace directory"),
    name: tool.schema.string().optional().describe("Optional friendly name for the workspace"),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Custom metadata for the workspace"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    if (!acquireLock(context)) {
      return JSON.stringify({ error: "Could not acquire lock. Another operation is in progress." }, null, 2)
    }

    try {
      ensureWorkspacesDir(context)

      const workspaceId = generateId("workspace")
      const now = new Date().toISOString()

      const workspace: Workspace = {
        id: workspaceId,
        name: args.name,
        path: args.path,
        createdAt: now,
        updatedAt: now,
        syncState: "synced",
        metadata: args.metadata || {},
      }

      // Save workspace file
      const workspacePath = getWorkspacePath(context, workspaceId)
      writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), "utf-8")

      // Create workspace state directory
      ensureWorkspaceStateDir(context, workspaceId)

      // Update index
      const index = loadIndex(context)
      index.workspaces.push(workspaceId)
      if (!index.currentWorkspaceId) {
        index.currentWorkspaceId = workspaceId
      }
      index.lastModified = now
      saveIndex(context, index)

      return JSON.stringify({
        workspace_id: workspaceId,
        name: workspace.name,
        path: workspace.path,
        sync_state: workspace.syncState,
        created_at: workspace.createdAt,
        message: `Workspace registered successfully. Use this ID to switch: ${workspaceId}`,
      }, null, 2)
    } finally {
      releaseLock(context)
    }
  },
})

/**
 * List all registered workspaces
 */
export const listWorkspaces = tool({
  description: "List all registered workspaces with their status",
  args: {
    filter: tool.schema.enum(["all", "synced", "pending", "conflict"]).optional().describe("Filter by sync state"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)
    const workspaces: WorkspaceSummary[] = []

    for (const workspaceId of index.workspaces) {
      const workspacePath = getWorkspacePath(context, workspaceId)
      if (existsSync(workspacePath)) {
        try {
          const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
          
          if (args.filter && args.filter !== "all" && workspace.syncState !== args.filter) {
            continue
          }

          workspaces.push({
            id: workspace.id,
            name: workspace.name,
            path: workspace.path,
            syncState: workspace.syncState,
            createdAt: workspace.createdAt,
            lastSyncedAt: workspace.lastSyncedAt,
          })
        } catch {
          // Skip corrupted workspaces
        }
      }
    }

    return JSON.stringify({
      workspaces,
      current_workspace_id: index.currentWorkspaceId,
      total: workspaces.length,
    }, null, 2)
  },
})

/**
 * Remove a workspace from the registry
 */
export const removeWorkspace = tool({
  description: "Remove a workspace from the registry (does not delete files)",
  args: {
    id: tool.schema.string().describe("The workspace ID to remove"),
    force: tool.schema.boolean().optional().describe("Force removal even if sync is pending").default(false),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    if (!acquireLock(context)) {
      return JSON.stringify({ error: "Could not acquire lock. Another operation is in progress." }, null, 2)
    }

    try {
      const workspacePath = getWorkspacePath(context, args.id)

      if (!existsSync(workspacePath)) {
        return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
      }

      const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))

      if (workspace.syncState === "pending" && !args.force) {
        return JSON.stringify({
          error: "Workspace has pending sync. Use force=true to remove anyway.",
          workspace_id: args.id,
          sync_state: workspace.syncState,
        }, null, 2)
      }

      // Update index
      const index = loadIndex(context)
      index.workspaces = index.workspaces.filter(id => id !== args.id)
      if (index.currentWorkspaceId === args.id) {
        index.currentWorkspaceId = index.workspaces[0] || null
      }
      index.lastModified = new Date().toISOString()
      saveIndex(context, index)

      // Remove workspace file
      unlinkSync(workspacePath)

      return JSON.stringify({
        removed_workspace_id: args.id,
        message: "Workspace removed from registry successfully",
        current_workspace_id: index.currentWorkspaceId,
      }, null, 2)
    } finally {
      releaseLock(context)
    }
  },
})

/**
 * Get the current active workspace
 */
export const getCurrentWorkspace = tool({
  description: "Get the currently active workspace",
  args: {},
  async execute(_args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)

    if (!index.currentWorkspaceId) {
      return JSON.stringify({ error: "No active workspace. Register one with register_workspace." }, null, 2)
    }

    const workspacePath = getWorkspacePath(context, index.currentWorkspaceId)
    if (!existsSync(workspacePath)) {
      return JSON.stringify({ error: "Current workspace file not found. It may have been deleted." }, null, 2)
    }

    try {
      const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
      return JSON.stringify(workspace, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to load workspace: ${e.message}` }, null, 2)
    }
  },
})

// ============================================================================
// Workspace Switching Tools
// ============================================================================

/**
 * Switch to another workspace
 */
export const switchWorkspace = tool({
  description: "Switch the active workspace context",
  args: {
    id: tool.schema.string().describe("The workspace ID to switch to"),
    sync_before_switch: tool.schema.boolean().optional().describe("Sync current workspace before switching").default(false),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    if (!acquireLock(context)) {
      return JSON.stringify({ error: "Could not acquire lock. Another operation is in progress." }, null, 2)
    }

    try {
      const targetPath = getWorkspacePath(context, args.id)

      if (!existsSync(targetPath)) {
        return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
      }

      const index = loadIndex(context)
      const previousWorkspaceId = index.currentWorkspaceId

      // Sync before switching if requested
      if (args.sync_before_switch && previousWorkspaceId) {
        const previousPath = getWorkspacePath(context, previousWorkspaceId)
        if (existsSync(previousPath)) {
          const previousWorkspace: Workspace = JSON.parse(readFileSync(previousPath, "utf-8"))
          previousWorkspace.syncState = "pending"
          previousWorkspace.updatedAt = new Date().toISOString()
          writeFileSync(previousPath, JSON.stringify(previousWorkspace, null, 2), "utf-8")
        }
      }

      // Update current workspace
      index.currentWorkspaceId = args.id
      index.lastModified = new Date().toISOString()
      saveIndex(context, index)

      const targetWorkspace: Workspace = JSON.parse(readFileSync(targetPath, "utf-8"))
      targetWorkspace.lastSyncedAt = new Date().toISOString()
      targetWorkspace.syncState = "synced"
      writeFileSync(targetPath, JSON.stringify(targetWorkspace, null, 2), "utf-8")

      return JSON.stringify({
        previous_workspace_id: previousWorkspaceId,
        current_workspace_id: args.id,
        workspace_name: targetWorkspace.name,
        workspace_path: targetWorkspace.path,
        message: `Switched to workspace ${args.id}`,
      }, null, 2)
    } finally {
      releaseLock(context)
    }
  },
})

/**
 * Sync state to target workspace
 */
export const syncWorkspace = tool({
  description: "Sync current workspace state to a target workspace",
  args: {
    target_id: tool.schema.string().describe("The target workspace ID to sync to"),
    resolution: tool.schema.enum(["last_write_wins", "manual"]).optional().describe("Conflict resolution strategy").default("last_write_wins"),
    force: tool.schema.boolean().optional().describe("Force sync even if conflicts exist").default(false),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    if (!acquireLock(context, "sync")) {
      return JSON.stringify({ error: "Could not acquire sync lock. Another sync is in progress." }, null, 2)
    }

    try {
      const index = loadIndex(context)

      if (!index.currentWorkspaceId) {
        return JSON.stringify({ error: "No current workspace to sync from" }, null, 2)
      }

      const sourcePath = getWorkspacePath(context, index.currentWorkspaceId)
      const targetPath = getWorkspacePath(context, args.target_id)

      if (!existsSync(sourcePath)) {
        return JSON.stringify({ error: `Source workspace not found: ${index.currentWorkspaceId}` }, null, 2)
      }

      if (!existsSync(targetPath)) {
        return JSON.stringify({ error: `Target workspace not found: ${args.target_id}` }, null, 2)
      }

      const sourceWorkspace: Workspace = JSON.parse(readFileSync(sourcePath, "utf-8"))
      const targetWorkspace: Workspace = JSON.parse(readFileSync(targetPath, "utf-8"))

      // Check for conflicts
      const sourceUpdated = new Date(sourceWorkspace.updatedAt).getTime()
      const targetUpdated = new Date(targetWorkspace.updatedAt).getTime()
      const hasConflict = Math.abs(sourceUpdated - targetUpdated) < 1000 && sourceWorkspace.id !== targetWorkspace.id

      if (hasConflict && !args.force) {
        // Mark both as conflict
        sourceWorkspace.syncState = "conflict"
        targetWorkspace.syncState = "conflict"
        writeFileSync(sourcePath, JSON.stringify(sourceWorkspace, null, 2), "utf-8")
        writeFileSync(targetPath, JSON.stringify(targetWorkspace, null, 2), "utf-8")

        return JSON.stringify({
          success: false,
          conflict: true,
          source_workspace_id: sourceWorkspace.id,
          target_workspace_id: targetWorkspace.id,
          message: "Conflict detected. Use force=true to resolve or resolution='manual' to handle manually.",
        }, null, 2)
      }

      // Perform sync based on resolution strategy
      const now = new Date().toISOString()

      if (args.resolution === "last_write_wins" || args.force) {
        // Copy relevant state from source to target
        targetWorkspace.metadata = { ...sourceWorkspace.metadata, ...targetWorkspace.metadata }
        targetWorkspace.lastSyncedAt = now
        targetWorkspace.syncState = "synced"
        targetWorkspace.updatedAt = now
        writeFileSync(targetPath, JSON.stringify(targetWorkspace, null, 2), "utf-8")

        // Update source
        sourceWorkspace.syncState = "synced"
        sourceWorkspace.lastSyncedAt = now
        writeFileSync(sourcePath, JSON.stringify(sourceWorkspace, null, 2), "utf-8")
      }

      return JSON.stringify({
        success: true,
        source_workspace_id: sourceWorkspace.id,
        target_workspace_id: targetWorkspace.id,
        resolution: args.resolution,
        synced_at: now,
        message: `Synced workspace ${sourceWorkspace.id} to ${targetWorkspace.id}`,
      }, null, 2)
    } finally {
      releaseLock(context, "sync")
    }
  },
})

// ============================================================================
// Shared Memory Layer Tools
// ============================================================================

/**
 * Set a shared value across workspaces
 */
export const setShared = tool({
  description: "Set a shared value accessible from all workspaces",
  args: {
    key: tool.schema.string().describe("The key to store the value under"),
    value: tool.schema.any().describe("The value to store"),
    workspace_id: tool.schema.string().optional().describe("Optional workspace ID that owns this value"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const store = loadKVStore(context)

    store[args.key] = {
      value: args.value,
      updatedAt: new Date().toISOString(),
      workspaceId: args.workspace_id,
    }

    saveKVStore(context, store)

    return JSON.stringify({
      key: args.key,
      value: args.value,
      updated_at: store[args.key].updatedAt,
      workspace_id: store[args.key].workspaceId,
      message: `Shared value set for key: ${args.key}`,
    }, null, 2)
  },
})

/**
 * Get a shared value
 */
export const getShared = tool({
  description: "Get a shared value by key",
  args: {
    key: tool.schema.string().describe("The key to retrieve"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const store = loadKVStore(context)
    const entry = store[args.key]

    if (!entry) {
      return JSON.stringify({ error: `Key not found: ${args.key}` }, null, 2)
    }

    return JSON.stringify({
      key: args.key,
      value: entry.value,
      updated_at: entry.updatedAt,
      workspace_id: entry.workspaceId,
    }, null, 2)
  },
})

/**
 * Delete a shared value
 */
export const deleteShared = tool({
  description: "Delete a shared value by key",
  args: {
    key: tool.schema.string().describe("The key to delete"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const store = loadKVStore(context)

    if (!store[args.key]) {
      return JSON.stringify({ error: `Key not found: ${args.key}` }, null, 2)
    }

    delete store[args.key]
    saveKVStore(context, store)

    return JSON.stringify({
      key: args.key,
      deleted: true,
      message: `Shared value deleted for key: ${args.key}`,
    }, null, 2)
  },
})

/**
 * List all shared keys
 */
export const listSharedKeys = tool({
  description: "List all shared keys in the KV store",
  args: {
    prefix: tool.schema.string().optional().describe("Filter keys by prefix"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const store = loadKVStore(context)
    let keys = Object.keys(store)

    if (args.prefix) {
      keys = keys.filter(k => k.startsWith(args.prefix!))
    }

    return JSON.stringify({
      keys,
      total: keys.length,
      entries: keys.map(k => ({
        key: k,
        updated_at: store[k].updatedAt,
        workspace_id: store[k].workspaceId,
      })),
    }, null, 2)
  },
})

// ============================================================================
// Cross-Workspace Context Tools
// ============================================================================

/**
 * Share context with another workspace
 */
export const shareContext = tool({
  description: "Share context from current workspace to another workspace",
  args: {
    workspace_id: tool.schema.string().describe("The target workspace ID to share context with"),
    content: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("The context content to share"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)

    if (!index.currentWorkspaceId) {
      return JSON.stringify({ error: "No current workspace to share from" }, null, 2)
    }

    // Verify target workspace exists
    const targetPath = getWorkspacePath(context, args.workspace_id)
    if (!existsSync(targetPath)) {
      return JSON.stringify({ error: `Target workspace not found: ${args.workspace_id}` }, null, 2)
    }

    const contextId = generateId("ctx")
    const now = new Date().toISOString()

    const sharedContext: SharedContext = {
      id: contextId,
      fromWorkspaceId: index.currentWorkspaceId,
      toWorkspaceId: args.workspace_id,
      content: args.content,
      sharedAt: now,
      read: false,
    }

    // Load context index and add new context
    const contextIndex = loadContextIndex(context)
    contextIndex.contexts.push(sharedContext)
    saveContextIndex(context, contextIndex)

    // Update source workspace sync state
    const sourcePath = getWorkspacePath(context, index.currentWorkspaceId)
    if (existsSync(sourcePath)) {
      const sourceWorkspace: Workspace = JSON.parse(readFileSync(sourcePath, "utf-8"))
      sourceWorkspace.syncState = "pending"
      sourceWorkspace.updatedAt = now
      writeFileSync(sourcePath, JSON.stringify(sourceWorkspace, null, 2), "utf-8")
    }

    return JSON.stringify({
      context_id: contextId,
      from_workspace_id: index.currentWorkspaceId,
      to_workspace_id: args.workspace_id,
      shared_at: now,
      message: `Context shared to workspace ${args.workspace_id}`,
    }, null, 2)
  },
})

/**
 * Get context shared to current workspace
 */
export const getSharedContext = tool({
  description: "Get all context shared to the current workspace",
  args: {
    from_workspace_id: tool.schema.string().optional().describe("Filter by source workspace"),
    unread_only: tool.schema.boolean().optional().describe("Only return unread contexts").default(false),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)

    if (!index.currentWorkspaceId) {
      return JSON.stringify({ error: "No current workspace" }, null, 2)
    }

    const contextIndex = loadContextIndex(context)
    let contexts = contextIndex.contexts.filter(ctx => ctx.toWorkspaceId === index.currentWorkspaceId)

    if (args.from_workspace_id) {
      contexts = contexts.filter(ctx => ctx.fromWorkspaceId === args.from_workspace_id)
    }

    if (args.unread_only) {
      contexts = contexts.filter(ctx => !ctx.read)
    }

    // Mark contexts as read
    const currentWorkspaceId = index.currentWorkspaceId
    contextIndex.contexts = contextIndex.contexts.map(ctx => {
      if (ctx.toWorkspaceId === currentWorkspaceId && !ctx.read) {
        return { ...ctx, read: true }
      }
      return ctx
    })
    saveContextIndex(context, contextIndex)

    return JSON.stringify({
      contexts,
      total: contexts.length,
      unread_count: contexts.filter(c => !c.read).length,
    }, null, 2)
  },
})

/**
 * Clear shared context for current workspace
 */
export const clearSharedContext = tool({
  description: "Clear shared context received by current workspace",
  args: {
    context_id: tool.schema.string().optional().describe("Specific context ID to clear (clears all if omitted)"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)

    if (!index.currentWorkspaceId) {
      return JSON.stringify({ error: "No current workspace" }, null, 2)
    }

    const contextIndex = loadContextIndex(context)

    if (args.context_id) {
      contextIndex.contexts = contextIndex.contexts.filter(
        ctx => !(ctx.id === args.context_id && ctx.toWorkspaceId === index.currentWorkspaceId)
      )
    } else {
      contextIndex.contexts = contextIndex.contexts.filter(
        ctx => ctx.toWorkspaceId !== index.currentWorkspaceId
      )
    }

    saveContextIndex(context, contextIndex)

    return JSON.stringify({
      cleared: args.context_id || "all",
      message: `Shared context cleared`,
    }, null, 2)
  },
})

// ============================================================================
// Sync Status Tools
// ============================================================================

/**
 * Get sync status for all workspaces
 */
export const getSyncStatus = tool({
  description: "Get sync status for all registered workspaces",
  args: {},
  async execute(_args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)
    const status: Record<string, { state: SyncState; lastSynced?: string; pendingConflicts: number }> = {}

    for (const workspaceId of index.workspaces) {
      const workspacePath = getWorkspacePath(context, workspaceId)
      if (existsSync(workspacePath)) {
        try {
          const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
          status[workspaceId] = {
            state: workspace.syncState,
            lastSynced: workspace.lastSyncedAt,
            pendingConflicts: 0,
          }
        } catch {
          // Skip corrupted
        }
      }
    }

    // Count pending contexts
    const contextIndex = loadContextIndex(context)
    const pendingContexts = contextIndex.contexts.filter(ctx => !ctx.read).length

    return JSON.stringify({
      workspaces: status,
      current_workspace_id: index.currentWorkspaceId,
      pending_contexts: pendingContexts,
      last_modified: index.lastModified,
    }, null, 2)
  },
})

/**
 * Force refresh sync status for a workspace
 */
export const refreshSyncStatus = tool({
  description: "Force refresh the sync status of a workspace",
  args: {
    id: tool.schema.string().describe("The workspace ID to refresh"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const workspacePath = getWorkspacePath(context, args.id)

    if (!existsSync(workspacePath)) {
      return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
    }

    try {
      const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))

      // Check if workspace path is still valid
      const pathExists = existsSync(workspace.path)
      const stateDirExists = existsSync(getWorkspaceStateDir(context, args.id))

      if (!pathExists) {
        workspace.syncState = "conflict"
      } else if (!stateDirExists) {
        ensureWorkspaceStateDir(context, args.id)
        workspace.syncState = "pending"
      } else {
        workspace.syncState = "synced"
      }

      workspace.updatedAt = new Date().toISOString()
      writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), "utf-8")

      return JSON.stringify({
        workspace_id: args.id,
        sync_state: workspace.syncState,
        path_exists: pathExists,
        refreshed_at: workspace.updatedAt,
      }, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to refresh: ${e.message}` }, null, 2)
    }
  },
})

/**
 * Resolve a sync conflict manually
 */
export const resolveConflict = tool({
  description: "Manually resolve a sync conflict for a workspace",
  args: {
    id: tool.schema.string().describe("The workspace ID with the conflict"),
    resolution: tool.schema.enum(["accept_local", "accept_remote", "merge"]).describe("How to resolve: accept_local keeps current state, accept_remote uses shared state, merge combines both"),
    merged_state: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Required if resolution is 'merge'"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const workspacePath = getWorkspacePath(context, args.id)

    if (!existsSync(workspacePath)) {
      return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
    }

    try {
      const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))

      if (workspace.syncState !== "conflict") {
        return JSON.stringify({ error: "Workspace does not have a conflict", current_state: workspace.syncState }, null, 2)
      }

      if (args.resolution === "merge" && !args.merged_state) {
        return JSON.stringify({ error: "merged_state required when resolution is 'merge'" }, null, 2)
      }

      const now = new Date().toISOString()

      switch (args.resolution) {
        case "accept_local":
          // Keep local state, mark as synced
          workspace.syncState = "synced"
          workspace.lastSyncedAt = now
          break
        case "accept_remote":
          // For now, just mark as synced (remote would need to be specified)
          workspace.syncState = "synced"
          workspace.lastSyncedAt = now
          break
        case "merge":
          workspace.metadata = { ...workspace.metadata, ...args.merged_state }
          workspace.syncState = "synced"
          workspace.lastSyncedAt = now
          break
      }

      workspace.updatedAt = now
      writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), "utf-8")

      return JSON.stringify({
        workspace_id: args.id,
        resolution: args.resolution,
        sync_state: workspace.syncState,
        resolved_at: now,
        message: `Conflict resolved with resolution: ${args.resolution}`,
      }, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to resolve conflict: ${e.message}` }, null, 2)
    }
  },
})

// ============================================================================
// Workspace Metadata Tools
// ============================================================================

/**
 * Update workspace metadata
 */
export const updateWorkspaceMetadata = tool({
  description: "Update metadata for a workspace",
  args: {
    id: tool.schema.string().describe("The workspace ID to update"),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("Metadata to merge with existing"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const workspacePath = getWorkspacePath(context, args.id)

    if (!existsSync(workspacePath)) {
      return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
    }

    const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
    workspace.metadata = { ...workspace.metadata, ...args.metadata }
    workspace.updatedAt = new Date().toISOString()
    writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), "utf-8")

    return JSON.stringify({
      workspace_id: args.id,
      metadata: workspace.metadata,
      updated_at: workspace.updatedAt,
      message: "Metadata updated successfully",
    }, null, 2)
  },
})

/**
 * Rename a workspace
 */
export const renameWorkspace = tool({
  description: "Rename a workspace",
  args: {
    id: tool.schema.string().describe("The workspace ID to rename"),
    name: tool.schema.string().describe("The new name for the workspace"),
  },
  async execute(args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const workspacePath = getWorkspacePath(context, args.id)

    if (!existsSync(workspacePath)) {
      return JSON.stringify({ error: `Workspace not found: ${args.id}` }, null, 2)
    }

    const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
    const oldName = workspace.name
    workspace.name = args.name
    workspace.updatedAt = new Date().toISOString()
    writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), "utf-8")

    return JSON.stringify({
      workspace_id: args.id,
      old_name: oldName,
      new_name: args.name,
      message: `Workspace renamed from '${oldName || "unnamed"}' to '${args.name}'`,
    }, null, 2)
  },
})

/**
 * Get workspace statistics
 */
export const workspaceStats = tool({
  description: "Get statistics about workspaces and sync state",
  args: {},
  async execute(_args, context) {
    if (!(await isFeatureEnabled(context))) {
      return JSON.stringify({ error: "Feature 'multi_workspace_sync' is not enabled. Enable it with enable_flag tool." }, null, 2)
    }

    const index = loadIndex(context)
    const contextIndex = loadContextIndex(context)
    const kvStore = loadKVStore(context)

    let syncedCount = 0
    let pendingCount = 0
    let conflictCount = 0
    let totalContexts = contextIndex.contexts.length
    let unreadContexts = contextIndex.contexts.filter(c => !c.read).length

    for (const workspaceId of index.workspaces) {
      const workspacePath = getWorkspacePath(context, workspaceId)
      if (existsSync(workspacePath)) {
        try {
          const workspace: Workspace = JSON.parse(readFileSync(workspacePath, "utf-8"))
          switch (workspace.syncState) {
            case "synced": syncedCount++; break
            case "pending": pendingCount++; break
            case "conflict": conflictCount++; break
          }
        } catch {
          // Skip corrupted
        }
      }
    }

    return JSON.stringify({
      total_workspaces: index.workspaces.length,
      synced_workspaces: syncedCount,
      pending_workspaces: pendingCount,
      conflict_workspaces: conflictCount,
      shared_keys: Object.keys(kvStore).length,
      total_contexts: totalContexts,
      unread_contexts: unreadContexts,
      current_workspace_id: index.currentWorkspaceId,
      index_last_modified: index.lastModified,
    }, null, 2)
  },
})

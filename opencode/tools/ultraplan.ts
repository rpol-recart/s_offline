import { tool } from "@opencode-ai/plugin"
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

/**
 * ULTRAPLAN Cloud Planning for OpenCode
 * Based on KAIROS ULTRAPLAN mode - offloads complex planning to a more capable model (Opus-class)
 * with up to 30 minutes of dedicated reasoning time.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export type PlanComplexity = "low" | "medium" | "high" | "critical"
export type PlanStatus = "pending" | "planning" | "completed" | "failed" | "cancelled" | "rejected"

export interface PlanResult {
  plan: string
  steps: string[]
  resources: string[]
  risks: string[]
  confidence: number
}

export interface UltraPlan {
  id: string
  task: string
  complexity: PlanComplexity
  timeLimit: number // minutes
  status: PlanStatus
  createdAt: string
  completedAt?: string
  result?: PlanResult
  approvalRequired: boolean
  approvedAt?: string
  rejectedAt?: string
  rejectReason?: string
  // Cloud planning metadata
  provider?: string
  model?: string
  tokenUsage?: {
    input: number
    output: number
    total: number
  }
  cost?: number
  error?: string
}

export interface ApprovalRecord {
  planId: string
  approved: boolean
  timestamp: string
  reason?: string
  approver?: string
}

export interface UltraPlanConfig {
  enabled: boolean
  apiEndpoint: string
  apiKey: string
  defaultModel: string
  maxTimeLimit: number // minutes
  maxTokens: number
  temperature: number
  defaultComplexity: PlanComplexity
  autoApproval: boolean
  maxConcurrentPlans: number
}

export interface UsageStats {
  totalPlans: number
  completedPlans: number
  failedPlans: number
  cancelledPlans: number
  pendingPlans: number
  totalTokenUsage: { input: number; output: number; total: number }
  totalCost: number
  approvalRate: number
  rejectionRate: number
  averagePlanningTime: number // seconds
}

// ============================================================================
// Constants
// ============================================================================

const ULTRAPLAN_DIR = ".opencode/ultraplan"
const PLANS_DIR = "plans"
const RESULTS_DIR = "results"
const APPROVALS_DIR = "approvals"
const CONFIG_FILE = "config.json"
const USAGE_FILE = "usage.json"
const DEFAULT_CONFIG: UltraPlanConfig = {
  enabled: false,
  apiEndpoint: "https://api.anthropic.com/v1/messages",
  apiKey: "",
  defaultModel: "claude-opus-4-20250114",
  maxTimeLimit: 30,
  maxTokens: 8192,
  temperature: 0.7,
  defaultComplexity: "medium",
  autoApproval: false,
  maxConcurrentPlans: 5,
}

// ============================================================================
// Helper Functions
// ============================================================================

function getUltraplanPaths(context: { directory: string }) {
  return {
    baseDir: join(context.directory, ULTRAPLAN_DIR),
    plansDir: join(context.directory, ULTRAPLAN_DIR, PLANS_DIR),
    resultsDir: join(context.directory, ULTRAPLAN_DIR, RESULTS_DIR),
    approvalsDir: join(context.directory, ULTRAPLAN_DIR, APPROVALS_DIR),
    configPath: join(context.directory, ULTRAPLAN_DIR, CONFIG_FILE),
    usagePath: join(context.directory, ULTRAPLAN_DIR, USAGE_FILE),
  }
}

function ensureDirectories(context: { directory: string }) {
  const { plansDir, resultsDir, approvalsDir, baseDir } = getUltraplanPaths(context)
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true })
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  if (!existsSync(approvalsDir)) mkdirSync(approvalsDir, { recursive: true })
  return { plansDir, resultsDir, approvalsDir, baseDir }
}

function loadConfig(context: { directory: string }): UltraPlanConfig {
  const { configPath } = getUltraplanPaths(context)
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, "utf-8")) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(context: { directory: string }, config: UltraPlanConfig) {
  const { configPath } = getUltraplanPaths(context)
  ensureDirectories(context)
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
}

function loadUsageStats(context: { directory: string }): UsageStats {
  const { usagePath } = getUltraplanPaths(context)
  if (!existsSync(usagePath)) {
    return {
      totalPlans: 0,
      completedPlans: 0,
      failedPlans: 0,
      cancelledPlans: 0,
      pendingPlans: 0,
      totalTokenUsage: { input: 0, output: 0, total: 0 },
      totalCost: 0,
      approvalRate: 0,
      rejectionRate: 0,
      averagePlanningTime: 0,
    }
  }
  try {
    return JSON.parse(readFileSync(usagePath, "utf-8"))
  } catch {
    return {
      totalPlans: 0,
      completedPlans: 0,
      failedPlans: 0,
      cancelledPlans: 0,
      pendingPlans: 0,
      totalTokenUsage: { input: 0, output: 0, total: 0 },
      totalCost: 0,
      approvalRate: 0,
      rejectionRate: 0,
      averagePlanningTime: 0,
    }
  }
}

function saveUsageStats(context: { directory: string }, stats: UsageStats) {
  const { usagePath } = getUltraplanPaths(context)
  ensureDirectories(context)
  writeFileSync(usagePath, JSON.stringify(stats, null, 2), "utf-8")
}

function loadPlan(context: { directory: string }, planId: string): UltraPlan | null {
  const { plansDir } = getUltraplanPaths(context)
  const planPath = join(plansDir, `${planId}.json`)
  if (!existsSync(planPath)) return null
  try {
    return JSON.parse(readFileSync(planPath, "utf-8"))
  } catch {
    return null
  }
}

function savePlan(context: { directory: string }, plan: UltraPlan) {
  const { plansDir } = getUltraplanPaths(context)
  ensureDirectories(context)
  const planPath = join(plansDir, `${plan.id}.json`)
  writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8")
}

function saveResult(context: { directory: string }, planId: string, result: PlanResult) {
  const { resultsDir } = getUltraplanPaths(context)
  ensureDirectories(context)
  const resultPath = join(resultsDir, `${planId}.json`)
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8")
}

function saveApproval(context: { directory: string }, approval: ApprovalRecord) {
  const { approvalsDir } = getUltraplanPaths(context)
  ensureDirectories(context)
  const approvalPath = join(approvalsDir, `${approval.planId}.json`)
  writeFileSync(approvalPath, JSON.stringify(approval, null, 2), "utf-8")
}

function loadApproval(context: { directory: string }, planId: string): ApprovalRecord | null {
  const { approvalsDir } = getUltraplanPaths(context)
  const approvalPath = join(approvalsDir, `${planId}.json`)
  if (!existsSync(approvalPath)) return null
  try {
    return JSON.parse(readFileSync(approvalPath, "utf-8"))
  } catch {
    return null
  }
}

function updateUsageStats(context: { directory: string }, plan: UltraPlan) {
  const stats = loadUsageStats(context)
  
  stats.totalPlans++
  
  switch (plan.status) {
    case "completed":
      stats.completedPlans++
      if (plan.completedAt && plan.createdAt) {
        const planningTime = (new Date(plan.completedAt).getTime() - new Date(plan.createdAt).getTime()) / 1000
        stats.averagePlanningTime = (stats.averagePlanningTime * (stats.completedPlans - 1) + planningTime) / stats.completedPlans
      }
      break
    case "failed":
      stats.failedPlans++
      break
    case "cancelled":
      stats.cancelledPlans++
      break
    case "pending":
    case "planning":
      stats.pendingPlans++
      break
  }
  
  if (plan.tokenUsage) {
    stats.totalTokenUsage.input += plan.tokenUsage.input
    stats.totalTokenUsage.output += plan.tokenUsage.output
    stats.totalTokenUsage.total += plan.tokenUsage.total
  }
  
  if (plan.cost) {
    stats.totalCost += plan.cost
  }
  
  // Load approvals to calculate rates
  const { approvalsDir } = getUltraplanPaths(context)
  if (existsSync(approvalsDir)) {
    const files = readdirSync(approvalsDir).filter(f => f.endsWith(".json"))
    const approvals = files.map(f => {
      try {
        return JSON.parse(readFileSync(join(approvalsDir, f), "utf-8")) as ApprovalRecord
      } catch {
        return null
      }
    }).filter(Boolean) as ApprovalRecord[]
    
    const approved = approvals.filter(a => a.approved).length
    const rejected = approvals.filter(a => !a.approved).length
    const total = approved + rejected
    
    if (total > 0) {
      stats.approvalRate = approved / total
      stats.rejectionRate = rejected / total
    }
  }
  
  saveUsageStats(context, stats)
}

function getComplexityTimeLimit(complexity: PlanComplexity, maxLimit: number): number {
  const limits: Record<PlanComplexity, number> = {
    low: 5,
    medium: 15,
    high: 25,
    critical: maxLimit,
  }
  return limits[complexity] || 15
}

function estimateCost(tokenUsage: { input: number; output: number }, model: string): number {
  // Rough cost estimation per 1M tokens
  const rates: Record<string, { input: number; output: number }> = {
    "claude-opus-4-20250114": { input: 15, output: 75 }, // Claude Opus
    "claude-sonnet-4-20250114": { input: 3, output: 15 }, // Claude Sonnet
    "claude-3-5-sonnet-20250114": { input: 3, output: 15 }, // Claude 3.5 Sonnet
    "claude-3-opus-20250114": { input: 15, output: 75 }, // Claude 3 Opus
  }
  const modelRates = rates[model] || rates["claude-opus-4-20250114"]
  return (tokenUsage.input * modelRates.input + tokenUsage.output * modelRates.output) / 1_000_000
}

function withTotal(tokenUsage: { input: number; output: number }): { input: number; output: number; total: number } {
  return { ...tokenUsage, total: tokenUsage.input + tokenUsage.output }
}

// ============================================================================
// Cloud Planning API
// ============================================================================

async function callCloudPlanningAPI(
  task: string,
  config: UltraPlanConfig,
  timeLimitMinutes: number
): Promise<{ result: PlanResult; tokenUsage: { input: number; output: number; total: number }; rawResponse: string }> {
  // Build planning prompt
  const planningPrompt = `You are an expert project planner. Analyze the following task and create a detailed execution plan.

TASK: ${task}

CONSTRAINTS:
- Time limit: ${timeLimitMinutes} minutes
- Maximum ${config.maxTokens} tokens for output
- Consider resources needed, potential risks, and step-by-step execution

Please provide your response in JSON format:
{
  "plan": "High-level plan description (2-3 sentences)",
  "steps": ["Step 1 description", "Step 2 description", ...],
  "resources": ["Resource 1", "Resource 2", ...],
  "risks": ["Risk 1", "Risk 2", ...],
  "confidence": 0.0-1.0 (your confidence in this plan)
}

Be thorough and consider edge cases.`

  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.defaultModel,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: "user",
          content: planningPrompt,
        },
      ],
      system: "You are a planning expert. Always respond with valid JSON only.",
      temperature: config.temperature,
    }),
  })

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
  
  const rawResponse = data.content?.[0]?.text || ""
  let parsedResult: PlanResult
  
  try {
    // Try to extract JSON from the response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      parsedResult = JSON.parse(jsonMatch[0])
    } else {
      throw new Error("No JSON found in response")
    }
  } catch {
    // If JSON parsing fails, create a structured result from the text
    parsedResult = {
      plan: rawResponse.substring(0, 500),
      steps: rawResponse.split("\n").filter(l => l.trim()).slice(0, 10),
      resources: [],
      risks: [],
      confidence: 0.5,
    }
  }
  
  const tokenUsage = {
    input: data.usage?.input_tokens || 0,
    output: data.usage?.output_tokens || 0,
  }

  return { result: parsedResult, tokenUsage: withTotal(tokenUsage), rawResponse }
}

// ============================================================================
// Tool Implementations
// ============================================================================

export const requestPlan = tool({
  description: "Request a cloud-based complex planning session. Uses Opus-class models with extended reasoning time (up to 30 minutes).",
  args: {
    task: tool.schema.string().describe("The task or problem to plan for"),
    complexity: tool.schema.string().describe("Plan complexity: low, medium, high, or critical"),
    timeLimit: tool.schema.number().optional().describe("Time limit in minutes (default based on complexity, max 30)"),
  },
  async execute(args, context) {
    const config = loadConfig(context)
    
    if (!config.enabled) {
      return JSON.stringify({
        success: false,
        error: "ULTRAPLAN is not enabled. Set ultra_plan_enabled to true in config.",
      })
    }
    
    ensureDirectories(context)
    const { plansDir } = getUltraplanPaths(context)
    
    // Check concurrent plans limit
    const existingPlans = readdirSync(plansDir).filter(f => f.endsWith(".json"))
    const activePlans = existingPlans.map(f => {
      const plan = JSON.parse(readFileSync(join(plansDir, f), "utf-8")) as UltraPlan
      return plan
    }).filter(p => p.status === "pending" || p.status === "planning")
    
    if (activePlans.length >= config.maxConcurrentPlans) {
      return JSON.stringify({
        success: false,
        error: `Maximum concurrent plans reached (${config.maxConcurrentPlans}). Wait for existing plans to complete.`,
      })
    }
    
    // Validate complexity
    const validComplexities: PlanComplexity[] = ["low", "medium", "high", "critical"]
    const complexity = (args.complexity || config.defaultComplexity) as PlanComplexity
    
    if (!validComplexities.includes(complexity)) {
      return JSON.stringify({
        success: false,
        error: `Invalid complexity: ${args.complexity}. Valid values: ${validComplexities.join(", ")}`,
      })
    }
    
    // Determine time limit
    const maxTimeLimit = Math.min(args.timeLimit || getComplexityTimeLimit(complexity, config.maxTimeLimit), config.maxTimeLimit)
    
    const plan: UltraPlan = {
      id: randomUUID(),
      task: args.task,
      complexity,
      timeLimit: maxTimeLimit,
      status: "pending",
      createdAt: new Date().toISOString(),
      approvalRequired: !config.autoApproval,
      provider: "anthropic",
      model: config.defaultModel,
    }
    
    savePlan(context, plan)
    updateUsageStats(context, plan)
    
    return JSON.stringify({
      success: true,
      plan,
      message: `Planning request created. ID: ${plan.id}. Status: ${plan.status}.`,
    }, null, 2)
  },
})

export const startPlanning = tool({
  description: "Start the cloud planning process for a pending plan. Sends the task to the external LLM API.",
  args: {
    planId: tool.schema.string().describe("Plan ID to start planning for"),
  },
  async execute(args, context) {
    const config = loadConfig(context)
    
    if (!config.enabled) {
      return JSON.stringify({
        success: false,
        error: "ULTRAPLAN is not enabled",
      })
    }
    
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status !== "pending") {
      return JSON.stringify({
        success: false,
        error: `Plan is not pending. Current status: ${plan.status}`,
      })
    }
    
    // Update status to planning
    plan.status = "planning"
    savePlan(context, plan)
    
    try {
      const { result, tokenUsage, rawResponse } = await callCloudPlanningAPI(
        plan.task,
        config,
        plan.timeLimit
      )
      
      // Calculate cost
      const cost = estimateCost(tokenUsage, config.defaultModel)
      
      // Update plan with results
      plan.status = "completed"
      plan.completedAt = new Date().toISOString()
      plan.result = result
      plan.tokenUsage = tokenUsage
      plan.cost = cost
      
      savePlan(context, plan)
      saveResult(context, plan.id, result)
      
      updateUsageStats(context, plan)
      
      return JSON.stringify({
        success: true,
        plan,
        message: `Planning completed successfully. Cost: $${cost.toFixed(4)}. Tokens: ${tokenUsage.total}`,
      }, null, 2)
    } catch (error) {
      plan.status = "failed"
      plan.completedAt = new Date().toISOString()
      plan.error = error instanceof Error ? error.message : "Unknown error"
      
      savePlan(context, plan)
      updateUsageStats(context, plan)
      
      return JSON.stringify({
        success: false,
        plan,
        error: plan.error,
      }, null, 2)
    }
  },
})

export const getPlanStatus = tool({
  description: "Check the current status of a planning request",
  args: {
    planId: tool.schema.string().describe("Plan ID to check status for"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    return JSON.stringify({
      success: true,
      plan: {
        id: plan.id,
        status: plan.status,
        complexity: plan.complexity,
        timeLimit: plan.timeLimit,
        createdAt: plan.createdAt,
        completedAt: plan.completedAt,
        approvalRequired: plan.approvalRequired,
        approvedAt: plan.approvedAt,
        error: plan.error,
      },
    }, null, 2)
  },
})

export const getPlanResult = tool({
  description: "Get the completed planning result",
  args: {
    planId: tool.schema.string().describe("Plan ID to get results for"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status !== "completed") {
      return JSON.stringify({
        success: false,
        error: `Plan is not completed. Current status: ${plan.status}`,
        plan: {
          id: plan.id,
          status: plan.status,
        },
      })
    }
    
    return JSON.stringify({
      success: true,
      plan,
      message: plan.approvalRequired && !plan.approvedAt 
        ? "Plan completed but awaiting approval" 
        : "Plan completed and ready",
    }, null, 2)
  },
})

export const cancelPlan = tool({
  description: "Cancel a pending or in-progress planning request",
  args: {
    planId: tool.schema.string().describe("Plan ID to cancel"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status === "completed" || plan.status === "failed") {
      return JSON.stringify({
        success: false,
        error: `Cannot cancel plan with status: ${plan.status}`,
      })
    }
    
    plan.status = "cancelled"
    plan.completedAt = new Date().toISOString()
    
    savePlan(context, plan)
    updateUsageStats(context, plan)
    
    return JSON.stringify({
      success: true,
      plan,
      message: `Plan cancelled successfully`,
    }, null, 2)
  },
})

export const requestApproval = tool({
  description: "Request human approval for a completed plan before execution",
  args: {
    planId: tool.schema.string().describe("Plan ID to request approval for"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status !== "completed") {
      return JSON.stringify({
        success: false,
        error: `Cannot request approval for plan with status: ${plan.status}`,
      })
    }
    
    plan.approvalRequired = true
    savePlan(context, plan)
    
    return JSON.stringify({
      success: true,
      plan,
      message: `Approval requested. Plan ${plan.id} requires human approval before execution.`,
    }, null, 2)
  },
})

export const approvePlan = tool({
  description: "Approve a completed planning result for execution",
  args: {
    planId: tool.schema.string().describe("Plan ID to approve"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status !== "completed") {
      return JSON.stringify({
        success: false,
        error: `Cannot approve plan with status: ${plan.status}`,
      })
    }
    
    plan.approvedAt = new Date().toISOString()
    savePlan(context, plan)
    
    const approval: ApprovalRecord = {
      planId: plan.id,
      approved: true,
      timestamp: plan.approvedAt,
    }
    saveApproval(context, approval)
    
    updateUsageStats(context, plan)
    
    return JSON.stringify({
      success: true,
      plan,
      message: `Plan approved successfully at ${plan.approvedAt}`,
    }, null, 2)
  },
})

export const rejectPlan = tool({
  description: "Reject a planning result with a reason",
  args: {
    planId: tool.schema.string().describe("Plan ID to reject"),
    reason: tool.schema.string().describe("Reason for rejection"),
  },
  async execute(args, context) {
    const plan = loadPlan(context, args.planId)
    
    if (!plan) {
      return JSON.stringify({
        success: false,
        error: `Plan not found: ${args.planId}`,
      })
    }
    
    if (plan.status !== "completed") {
      return JSON.stringify({
        success: false,
        error: `Cannot reject plan with status: ${plan.status}`,
      })
    }
    
    plan.status = "rejected"
    plan.rejectedAt = new Date().toISOString()
    plan.rejectReason = args.reason
    
    savePlan(context, plan)
    
    const approval: ApprovalRecord = {
      planId: plan.id,
      approved: false,
      timestamp: plan.rejectedAt,
      reason: args.reason,
    }
    saveApproval(context, approval)
    
    updateUsageStats(context, plan)
    
    return JSON.stringify({
      success: true,
      plan,
      message: `Plan rejected: ${args.reason}`,
    }, null, 2)
  },
})

export const getUsageStats = tool({
  description: "Get ULTRAPLAN usage statistics including token usage, cost, and approval rates",
  args: {},
  async execute(_args, context) {
    const stats = loadUsageStats(context)
    const config = loadConfig(context)
    
    return JSON.stringify({
      success: true,
      stats,
      config: {
        enabled: config.enabled,
        defaultModel: config.defaultModel,
        maxTimeLimit: config.maxTimeLimit,
      },
    }, null, 2)
  },
})

export const listPlans = tool({
  description: "List all planning requests with optional status filter",
  args: {
    status: tool.schema.string().optional().describe("Filter by status: pending, planning, completed, failed, cancelled, rejected"),
    limit: tool.schema.number().optional().describe("Maximum number of plans to return (default: 50)"),
  },
  async execute(args, context) {
    const { plansDir } = getUltraplanPaths(context)
    
    if (!existsSync(plansDir)) {
      return JSON.stringify({
        success: true,
        plans: [],
        total: 0,
        message: "No plans found",
      })
    }
    
    const files = readdirSync(plansDir).filter(f => f.endsWith(".json"))
    let plans = files.map(f => {
      try {
        return JSON.parse(readFileSync(join(plansDir, f), "utf-8")) as UltraPlan
      } catch {
        return null
      }
    }).filter(Boolean) as UltraPlan[]
    
    // Filter by status if provided
    if (args.status) {
      plans = plans.filter(p => p.status === args.status)
    }
    
    // Sort by createdAt descending (newest first)
    plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    
    // Apply limit
    const limitedPlans = args.limit ? plans.slice(0, args.limit) : plans
    
    return JSON.stringify({
      success: true,
      plans: limitedPlans.map(p => ({
        id: p.id,
        task: p.task,
        complexity: p.complexity,
        status: p.status,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        approvalRequired: p.approvalRequired,
        approvedAt: p.approvedAt,
      })),
      total: plans.length,
      returned: limitedPlans.length,
    }, null, 2)
  },
})

export const configure = tool({
  description: "Configure ULTRAPLAN settings",
  args: {
    enabled: tool.schema.boolean().optional().describe("Enable/disable ULTRAPLAN"),
    apiEndpoint: tool.schema.string().optional().describe("External LLM API endpoint"),
    apiKey: tool.schema.string().optional().describe("API key for external LLM"),
    defaultModel: tool.schema.string().optional().describe("Default model to use (e.g., claude-opus-4-20250114)"),
    maxTimeLimit: tool.schema.number().optional().describe("Maximum planning time in minutes (max 30)"),
    maxTokens: tool.schema.number().optional().describe("Maximum tokens for planning output"),
    temperature: tool.schema.number().optional().describe("Sampling temperature (0-1)"),
    autoApproval: tool.schema.boolean().optional().describe("Auto-approve plans without human review"),
    maxConcurrentPlans: tool.schema.number().optional().describe("Maximum concurrent planning requests"),
  },
  async execute(args, context) {
    const config = loadConfig(context)
    
    // Update config with provided values
    if (args.enabled !== undefined) config.enabled = args.enabled
    if (args.apiEndpoint !== undefined) config.apiEndpoint = args.apiEndpoint
    if (args.apiKey !== undefined) config.apiKey = args.apiKey
    if (args.defaultModel !== undefined) config.defaultModel = args.defaultModel
    if (args.maxTimeLimit !== undefined) config.maxTimeLimit = Math.min(args.maxTimeLimit, 30)
    if (args.maxTokens !== undefined) config.maxTokens = args.maxTokens
    if (args.temperature !== undefined) config.temperature = Math.max(0, Math.min(1, args.temperature))
    if (args.autoApproval !== undefined) config.autoApproval = args.autoApproval
    if (args.maxConcurrentPlans !== undefined) config.maxConcurrentPlans = args.maxConcurrentPlans
    
    saveConfig(context, config)
    
    return JSON.stringify({
      success: true,
      config,
      message: "ULTRAPLAN configuration updated",
    }, null, 2)
  },
})

export const getConfig = tool({
  description: "Get current ULTRAPLAN configuration",
  args: {},
  async execute(_args, context) {
    const config = loadConfig(context)
    
    // Mask API key for security
    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? config.apiKey.substring(0, 8) + "..." : "",
    }
    
    return JSON.stringify({
      success: true,
      config: safeConfig,
    }, null, 2)
  },
})

// Named exports above are the tool definitions.
// Do NOT use export default with a plain object — it's not a valid ToolDefinition.
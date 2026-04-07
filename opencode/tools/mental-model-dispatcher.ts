import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs"

interface ModelRef {
  id: string
  file: string
}

/**
 * Dispatch mental models for a given task description or task type.
 * Loads the ds_dispatch.yaml, classifies the task, and returns relevant model IDs and their prompt fragments.
 */
export default tool({
  description: "Load and dispatch mental models for DS tasks based on task description or type",
  args: {
    task_description: tool.schema.string().optional()
      .describe("Natural language description of the DS task"),
    task_type: tool.schema.string().optional()
      .describe("Known task type from ds_dispatch.yaml (e.g., unmeasurable_target, physics_engineering)"),
    bundle: tool.schema.string().optional()
      .describe("Pre-configured bundle name (e.g., soft_sensing, foundation_modeling, anomaly_detection)"),
  },
  
  async execute(args, context) {
    const basePath = path.join(context.worktree, ".opencode/skills/ds-mental-models/architecture_prompts")
    const dispatchPath = path.join(basePath, "ds_dispatch.yaml")
    
    // Read dispatch config (YAML file — use custom parser)
    const dispatchContent = fs.readFileSync(dispatchPath, 'utf-8')
    const dispatch = YAML.parse(dispatchContent)
    
    // Determine what to load
    let modelIds: string[] = []
    let taskType = args.task_type || ""
    
    if (args.bundle && dispatch.bundles?.[args.bundle]) {
      // Load from bundle
      const bundle = dispatch.bundles[args.bundle]
      modelIds = bundle.models || []
      taskType = `bundle:${args.bundle}`
    } else if (args.task_type && dispatch.task_types?.[args.task_type]) {
      // Load from task type
      const taskTypeConfig = dispatch.task_types[args.task_type]
      modelIds = (taskTypeConfig.models || []).map((m: ModelRef | string) => 
        typeof m === 'string' ? m : m.id
      )
    } else if (args.task_description) {
      // Auto-classify based on description
      const desc = args.task_description.toLowerCase()
      
      if (desc.includes("нельзя измерить") || desc.includes("cannot measure") || 
          desc.includes("прокси") || desc.includes("proxy") || desc.includes("al2o3") ||
          desc.includes("alumina")) {
        taskType = "unmeasurable_target"
      } else if (desc.includes("физик") || desc.includes("physical") || 
                 desc.includes("инженер") || desc.includes("engineer")) {
        taskType = "physics_engineering"
      } else if (desc.includes("безопасност") || desc.includes("safety") || 
                 desc.includes("катастроф") || desc.includes("риск")) {
        taskType = "safety_critical"
      } else if (desc.includes("мульти") || desc.includes("multi-scale") ||
                 desc.includes("разн") || desc.includes("different time")) {
        taskType = "multi_scale"
      } else {
        taskType = "standard_supervised"
      }
      
      const taskTypeConfig = dispatch.task_types?.[taskType]
      if (taskTypeConfig) {
        modelIds = (taskTypeConfig.models || []).map((m: ModelRef | string) => 
          typeof m === 'string' ? m : m.id
        )
      }
    }
    
    // Remove duplicates
    modelIds = [...new Set(modelIds)]
    
    // Load model contents
    const models: Record<string, { think_like?: string; thinking_process?: string; prompt_fragment?: string }> = {}
    
    for (const modelId of modelIds) {
      // Try foundations first
      let modelPath = path.join(basePath, "models/foundations", `mm_${modelId}.yaml`)
      if (!fs.existsSync(modelPath)) {
        // Try domains
        modelPath = path.join(basePath, "models/domains", `da_${modelId}.yaml`)
      }
      if (!fs.existsSync(modelPath)) {
        // Try paradigms
        modelPath = path.join(basePath, "models/paradigms", `ps_${modelId}.yaml`)
      }
      
      try {
        const content = fs.readFileSync(modelPath, 'utf-8')
        const modelData = YAML.parse(content)
        // Get the first key which is the model ID
        const key = Object.keys(modelData)[0]
        models[modelId] = modelData[key] as { think_like?: string; thinking_process?: string; prompt_fragment?: string }
      } catch (e) {
        // Model file not found, skip
      }
    }
    
    return JSON.stringify({
      task_type: taskType,
      models_activated: modelIds,
      count: modelIds.length,
      models: Object.entries(models).map(([id, data]) => ({
        id,
        think_like: data.think_like || "",
        thinking_process: data.thinking_process || "",
        prompt_fragment: data.prompt_fragment || ""
      }))
    })
  }
})

// Simple YAML parser for tool execution
const YAML = {
  parse(str: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const lines = str.split('\n')
    let currentKey = ''
    let currentIndent = 0
    let inMultiline = false
    let multilineValue = ''
    let multilineKey = ''
    
    for (const line of lines) {
      if (line.trim().startsWith('#')) continue
      
      const match = line.match(/^(\s*)([-\w]+):\s*(.*)$/)
      if (match) {
        const [, indent, key, value] = match
        
        if (inMultiline && currentIndent >= indent.length) {
          result[multilineKey] = multilineValue.trim()
          inMultiline = false
        }
        
        if (value && !value.startsWith('|') && !value.startsWith('>')) {
          result[key] = value.replace(/^["']|["']$/g, '')
        } else if (value.startsWith('|') || value.startsWith('>')) {
          inMultiline = true
          multilineKey = key
          multilineValue = ''
          currentIndent = indent.length + 1
        } else {
          currentKey = key
          result[key] = ''
        }
      } else if (inMultiline && line.trim()) {
        multilineValue += line.trim() + '\n'
      }
    }
    
    if (inMultiline) {
      result[multilineKey] = multilineValue.trim()
    }
    
    return result
  }
}
import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { join } from "path"

/**
 * Spawn a sub-agent task.
 * Permission: danger-full-access (spawns new processes)
 */
export default tool({
  description: "Launch a specialized sub-agent task. The agent will be spawned with the given prompt and description.",
  args: {
    description: tool.schema.string().describe("Description of the task for the sub-agent"),
    prompt: tool.schema.string().describe("The prompt/instruction for the sub-agent"),
    agent_type: tool.schema.string().optional().describe("Type of agent to spawn (e.g., 'coder', 'reviewer', 'researcher')"),
    name: tool.schema.string().optional().describe("Optional name for the agent"),
    model: tool.schema.string().optional().describe("Optional model to use"),
  },
  async execute(args, context) {
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const outputDir = join(context.directory, ".opencode", "agents")
    const outputFile = join(outputDir, `${agentId}.md`)
    const manifestFile = join(outputDir, `${agentId}.json`)
    
    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      execSync(`mkdir -p "${outputDir}"`, { cwd: context.directory })
    }
    
    // Create task file
    const taskContent = `# Sub-Agent Task

- id: ${agentId}
- name: ${args.name || args.description.slice(0, 50)}
- description: ${args.description}
- agent_type: ${args.agent_type || "default"}
- model: ${args.model || "default"}
- created_at: ${new Date().toISOString()}

## Prompt

${args.prompt}
`
    writeFileSync(outputFile, taskContent, "utf-8")
    
    // Create manifest
    const manifest = {
      agentId,
      name: args.name || args.description.slice(0, 50),
      description: args.description,
      agentType: args.agent_type || "default",
      model: args.model || "default",
      status: "pending",
      outputFile,
      manifestFile,
      createdAt: new Date().toISOString(),
    }
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8")
    
    return JSON.stringify({
      agent_id: agentId,
      name: args.name || args.description.slice(0, 50),
      description: args.description,
      agent_type: args.agent_type || "default",
      status: "spawned",
      output_file: outputFile,
      manifest_file: manifestFile,
      created_at: new Date().toISOString(),
    }, null, 2)
  },
})

export const list = tool({
  description: "List all spawned sub-agents",
  args: {},
  async execute(_args, context) {
    const outputDir = join(context.directory, ".opencode", "agents")
    
    if (!existsSync(outputDir)) {
      return "No agents spawned yet"
    }
    
    try {
      const result = execSync("ls -la *.json 2>/dev/null || echo 'No agent manifests'", {
        encoding: "utf-8",
        cwd: outputDir,
      })
      return result.trim()
    } catch {
      return "No agents spawned yet"
    }
  },
})

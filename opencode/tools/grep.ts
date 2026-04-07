import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { join } from "path"

/**
 * Search file contents with a regex pattern.
 * Permission: read-only
 */
export default tool({
  description: "Search file contents using regex. Returns matching lines with optional line numbers and context.",
  args: {
    pattern: tool.schema.string().describe("Regex pattern to search for"),
    path: tool.schema.string().optional().describe("Directory or file path to search in"),
    glob: tool.schema.string().optional().describe("File glob pattern to filter (e.g., '*.ts', '*.js')"),
    "-n": tool.schema.boolean().optional().describe("Show line numbers"),
    "-i": tool.schema.boolean().optional().describe("Case insensitive search"),
    "-C": tool.schema.number().optional().describe("Number of lines of context before/after"),
    head_limit: tool.schema.number().optional().describe("Maximum number of results to return"),
  },
  async execute(args, context) {
    const searchPath = args.path
      ? join(context.directory, args.path)
      : context.directory

    // Escape single quotes for shell
    const escapedPattern = args.pattern.replace(/'/g, "'\\''")

    // Build flags cleanly — no duplicates
    const flagParts: string[] = ["-r"]
    if (args["-i"]) flagParts.push("-i")
    if (args["-n"] !== false) flagParts.push("-n") // default: show line numbers
    if (args["-C"]) flagParts.push(`-C ${args["-C"]}`)
    if (args.glob) flagParts.push(`--include="${args.glob}"`)

    let command = `grep ${flagParts.join(" ")} -- '${escapedPattern}' "${searchPath}"`

    if (args.head_limit) {
      command += ` | head -${args.head_limit}`
    }
    
    try {
      const result = execSync(command, {
        encoding: "utf-8",
        cwd: context.directory,
        maxBuffer: 10 * 1024 * 1024,
      })
      return result.trim() || `No matches found for '${args.pattern}'`
    } catch (e: any) {
      if (e.status === 1) {
        return `No matches found for '${args.pattern}'`
      }
      return `Search failed: ${e.message}`
    }
  },
})

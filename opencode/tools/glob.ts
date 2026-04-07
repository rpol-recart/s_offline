import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { glob } from "glob"

/**
 * Find files by glob pattern.
 * Permission: read-only
 */
export default tool({
  description: "Find files matching a glob pattern. Use ** for recursive search, * for single directory wildcards.",
  args: {
    pattern: tool.schema.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.js', '*.json')"),
    path: tool.schema.string().optional().describe("Base path to search from (defaults to workspace root)"),
  },
  async execute(args, context) {
    const basePath = args.path ? join(context.directory, args.path) : context.directory
    
    try {
      const files = glob.sync(args.pattern, {
        cwd: basePath,
        absolute: false,
        nodir: true,
      })
      
      if (files.length === 0) {
        return `No files matching pattern '${args.pattern}' found in ${basePath}`
      }
      
      return files.join("\n")
    } catch (e: any) {
      return `Glob search failed: ${e.message}`
    }
  },
})

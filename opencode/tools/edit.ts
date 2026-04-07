import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * Replace text in a workspace file.
 * Permission: workspace-write
 */
export default tool({
  description: "Replace exact text in a file. Use for line-based edits, refactoring, or updating content. Supports replace-all flag.",
  args: {
    filePath: tool.schema.string().describe("Path to the file to edit"),
    oldString: tool.schema.string().describe("Exact text to find and replace"),
    newString: tool.schema.string().describe("Text to replace the old string with"),
    replaceAll: tool.schema.boolean().optional().describe("Replace all occurrences (default: false)"),
  },
  async execute(args, context) {
    // Resolve relative paths
    const resolvedPath = args.filePath.startsWith("/") 
      ? args.filePath 
      : join(context.directory, args.filePath)
    
    if (!existsSync(resolvedPath)) {
      return `Error: File not found: ${resolvedPath}`
    }
    
    try {
      let content = readFileSync(resolvedPath, "utf-8")
      const oldContent = content
      
      if (args.replaceAll) {
        content = content.split(args.oldString).join(args.newString)
        const count = (oldContent.match(new RegExp(escapeRegex(args.oldString), "g")) || []).length
        if (count === 0) {
          return `No occurrences of '${args.oldString}' found in ${resolvedPath}`
        }
        writeFileSync(resolvedPath, content, "utf-8")
        return `Replaced ${count} occurrence(s) in ${resolvedPath}`
      } else {
        if (!content.includes(args.oldString)) {
          return `Text '${args.oldString}' not found in ${resolvedPath}`
        }
        content = content.replace(args.oldString, args.newString)
        writeFileSync(resolvedPath, content, "utf-8")
        return `Edit applied to ${resolvedPath}`
      }
    } catch (e: any) {
      return `Error editing file: ${e.message}`
    }
  },
})

// Escape special regex characters in string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * Update the structured task list for the current session.
 * Permission: workspace-write
 */
export default tool({
  description: "Update the structured task list. Track todos with content, activeForm, and status (pending, in_progress, completed).",
  args: {
    todos: tool.schema.array(tool.schema.object({
      content: tool.schema.string().describe("What needs to be done"),
      activeForm: tool.schema.string().describe("Current action being performed (e.g., 'Implementing feature', 'Writing tests')"),
      status: tool.schema.enum(["pending", "in_progress", "completed"]).describe("Current status"),
    })).describe("Array of todo items to update"),
  },
  async execute(args, context) {
    const todoPath = join(context.directory, ".opencode", "todos.json")
    
    // Ensure directory exists
    const dir = join(context.directory, ".opencode")
    if (!existsSync(dir)) {
      execSync(`mkdir -p "${dir}"`, { cwd: context.directory })
    }
    
    // Read old todos
    let oldTodos: any[] = []
    if (existsSync(todoPath)) {
      try {
        oldTodos = JSON.parse(readFileSync(todoPath, "utf-8"))
      } catch {}
    }
    
    // Validate todos
    for (const todo of args.todos) {
      if (!todo.content.trim()) {
        return "Error: todo content must not be empty"
      }
      if (!todo.activeForm.trim()) {
        return "Error: todo activeForm must not be empty"
      }
    }
    
    // Check if all done (to clear todos)
    const allDone = args.todos.every(t => t.status === "completed")
    const newTodos = allDone ? [] : args.todos
    
    // Write updated todos
    writeFileSync(todoPath, JSON.stringify(newTodos, null, 2), "utf-8")
    
    // Check if verification nudge needed
    const verificationNeeded = allDone && 
      args.todos.length >= 3 &&
      !args.todos.some(t => t.content.toLowerCase().includes("verif"))
    
    return JSON.stringify({
      old_todos: oldTodos,
      new_todos: args.todos,
      verification_nudge_needed: verificationNeeded || undefined,
    }, null, 2)
  },
})

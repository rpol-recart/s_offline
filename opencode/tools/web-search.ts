import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { join } from "path"

/**
 * Search the web for current information.
 * Permission: read-only (network access)
 */
export default tool({
  description: "Search the web for current information. Returns search results with titles and URLs.",
  args: {
    query: tool.schema.string().describe("Search query (min 2 characters)"),
    allowed_domains: tool.schema.array(tool.schema.string()).optional().describe("Limit results to specific domains"),
    blocked_domains: tool.schema.array(tool.schema.string()).optional().describe("Exclude results from specific domains"),
    search_domain_filter: tool.schema.string().optional().describe("Domain to search within"),
    location: tool.schema.string().optional().describe("Location hint: 'cn' for China, 'us' for US (default: auto-detect)"),
  },
  async execute(args, context) {
    const query = args.query.trim()
    if (query.length < 2) {
      return "Search query must be at least 2 characters"
    }
    
    // Build search URL (using DuckDuckGo HTML)
    let searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    
    try {
      const result = execSync(`curl -s --max-time 15 -L -A "OpenCode-FW/1.0" "${searchUrl}"`, {
        encoding: "utf-8",
        cwd: context.directory,
        maxBuffer: 2 * 1024 * 1024,
      })
      
      // Parse search results from DuckDuckGo HTML
      const results: Array<{title: string, url: string}> = []
      const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi
      let match
      
      while ((match = linkPattern.exec(result)) !== null && results.length < 8) {
        const url = match[1]
        const title = match[2].replace(/<[^>]+>/g, "").trim()
        if (url.startsWith("http")) {
          results.push({ title, url })
        }
      }
      
      if (results.length === 0) {
        return `No search results found for: ${query}`
      }
      
      const formatted = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n")
      
      return `Search results for "${query}":\n\n${formatted}\n\nInclude a Sources section in the final answer.`
    } catch (e: any) {
      return `Web search failed: ${e.message}`
    }
  },
})

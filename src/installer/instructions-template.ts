/**
 * Agent-instructions template — the markdown body each agent target
 * writes into its conventional instructions file (CLAUDE.md /
 * AGENTS.md / skillgraph.mdc / etc.).
 *
 * The body content is identical across agents because the skillgraph
 * usage advice is agent-agnostic — only the destination filename and
 * any optional frontmatter (Cursor `.mdc`) varies per target.
 *
 * The legacy `claude-md-template.ts` re-exports these names for
 * backwards compatibility with downstream importers.
 */

/** Markers used by the marker-based section replacement. */
export const SKILLGRAPH_SECTION_START = '<!-- SKILLGRAPH_START -->';
export const SKILLGRAPH_SECTION_END = '<!-- SKILLGRAPH_END -->';

/**
 * The full marker-delimited block written into each agent's
 * instructions file. Includes the start/end markers so the section
 * can be detected and replaced on re-install.
 */
export const INSTRUCTIONS_TEMPLATE = `${SKILLGRAPH_SECTION_START}
## SkillGraph

This project has a SkillGraph MCP server (\`skillgraph_*\` tools) configured. SkillGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer skillgraph over native search

Use skillgraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | \`skillgraph_search\` |
| "What calls function Y?" | \`skillgraph_callers\` |
| "What does Y call?" | \`skillgraph_callees\` |
| "What would break if I changed Z?" | \`skillgraph_impact\` |
| "Show me Y's signature / source / docstring" | \`skillgraph_node\` |
| "Give me focused context for a task/area" | \`skillgraph_context\` |
| "Survey an unfamiliar module/topic" | \`skillgraph_explore\` |
| "What files exist under path/" | \`skillgraph_files\` |
| "Is the index healthy?" | \`skillgraph_status\` |

### Rules of thumb

- **Trust skillgraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. \`skillgraph_search\` is faster and returns kind + location + signature in one call.
- **Don't chain \`skillgraph_search\` + \`skillgraph_node\`** when you just want context — \`skillgraph_context\` is one call.
- **\`skillgraph_explore\` is the heavy hitter** for unfamiliar areas — it returns full source from all relevant files in one call, but is token-heavy. If your harness supports parallel subagents (e.g., Claude Code's Task tool), spawn one for explore-class questions to keep main session context clean.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If \`.skillgraph/\` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have SkillGraph initialized. Want me to run \`skillgraph init -i\` to build the index?"*
${SKILLGRAPH_SECTION_END}`;

/**
 * Backwards-compat alias. Existing downstream code may import
 * `CLAUDE_MD_TEMPLATE` from this module via the re-export shim in
 * `claude-md-template.ts`.
 */
export const CLAUDE_MD_TEMPLATE = INSTRUCTIONS_TEMPLATE;

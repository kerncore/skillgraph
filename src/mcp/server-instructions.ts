/**
 * Server-level instructions emitted in the MCP `initialize` response.
 *
 * MCP clients (Claude Code, Cursor, opencode, LangChain, OpenAI Agent
 * SDK, …) surface this text in the agent's system prompt automatically,
 * giving the agent a high-level playbook for the skillgraph toolset
 * before it sees individual tool descriptions.
 *
 * Goals when editing this:
 *   - Tool selection by intent (which tool for which question)
 *   - Common chains (refactor planning = X then Y)
 *   - Anti-patterns (don't grep when skillgraph_search is faster)
 *
 * Keep it tight. The agent reads this every session — long instructions
 * burn tokens. Reference only tools that exist on `main`; gate any
 * conditional tools behind feature checks if/when they ship.
 */
export const SERVER_INSTRUCTIONS = `# Codegraph — code intelligence over an indexed knowledge graph

Codegraph is a SQLite knowledge graph of every symbol, edge, and file
in the workspace. Reads are sub-millisecond; the index lags writes by
about a second through the file watcher. Consult it BEFORE writing or
editing code, not during.

## Tool selection by intent

- **"What is the symbol named X?"** → \`skillgraph_search\`
- **"What's the deal with this task / feature / area?"** → \`skillgraph_context\` (PRIMARY — composes search + node + callers + callees in one call)
- **"What calls this?"** → \`skillgraph_callers\`
- **"What does this call?"** → \`skillgraph_callees\`
- **"What would changing this break?"** → \`skillgraph_impact\`
- **"Show me this symbol's source / signature / docstring."** → \`skillgraph_node\`
- **"Survey an unfamiliar topic / pattern / module."** → \`skillgraph_explore\` (heavier; deep dive)
- **"What's in directory X?"** → \`skillgraph_files\`
- **"Is the index ready / what's its size?"** → \`skillgraph_status\`

## Common chains

- **Onboarding**: \`skillgraph_context\` first. If still unclear, \`skillgraph_explore\` for breadth, then \`skillgraph_node\` on specific symbols.
- **Refactor planning**: \`skillgraph_search\` → \`skillgraph_callers\` → \`skillgraph_impact\`. The blast-radius answer comes from impact, not from walking callers manually.
- **Debugging a regression**: \`skillgraph_callers\` of the suspected symbol; widen with \`skillgraph_impact\` if an unexpected call appears.

## Anti-patterns

- **Don't grep first** when looking up a symbol by name — \`skillgraph_search\` is faster and returns kind + location + signature.
- **Don't chain \`skillgraph_search\` + \`skillgraph_node\`** when you just want context — \`skillgraph_context\` is one round-trip.
- **Don't use \`skillgraph_explore\` for narrow questions** — it's a multi-call deep dive, expensive in tokens. Save it for genuine "I'm new here" surveys.
- **Don't query the index immediately after editing a file** — the watcher needs ~500ms to debounce + sync. Wait for the next turn.

## Limitations

- Index lags file writes by ~1 second.
- Cross-file resolution is best-effort name matching; ambiguous calls may return multiple candidates.
- No live correctness validation — that's still the TypeScript compiler / test suite / linter's job. Codegraph supplements those with structural context they don't have.
`;

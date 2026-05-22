<!-- skillgen:start -->
# SkillGen — Code Intelligence

This project is indexed by SkillGen as **skillgraph** (3868 symbols, 9118 relationships, 256 execution flows). Use the SkillGen MCP tools to understand code, assess impact, and navigate safely.

> If any SkillGen tool warns the index is stale, run `npx skillgen analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `skillgen_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `skillgen_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `skillgen_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `skillgen_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `skillgen_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `skillgen_rename` which understands the call graph.
- NEVER commit changes without running `skillgen_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `skillgen://repo/skillgraph/context` | Codebase overview, check index freshness |
| `skillgen://repo/skillgraph/clusters` | All functional areas |
| `skillgen://repo/skillgraph/processes` | All execution flows |
| `skillgen://repo/skillgraph/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/skillgen/skillgen-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/skillgen/skillgen-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/skillgen/skillgen-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/skillgen/skillgen-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/skillgen/skillgen-guide/SKILL.md` |
| Index, status, status, clean CLI commands | `.claude/skills/skillgen/skillgen-cli/SKILL.md` |
| Work in the Db area (144 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/db/SKILL.md` |
| Work in the Extraction area (114 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/extraction/SKILL.md` |
| Work in the Frameworks area (104 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/frameworks/SKILL.md` |
| Work in the Targets area (91 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/targets/SKILL.md` |
| Work in the Resolution area (69 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/resolution/SKILL.md` |
| Work in the Mcp area (67 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/mcp/SKILL.md` |
| Work in the Graph area (52 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/graph/SKILL.md` |
| Work in the Languages area (41 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/languages/SKILL.md` |
| Work in the Context area (14 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/context/SKILL.md` |
| Work in the Ui area (12 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/ui/SKILL.md` |
| Work in the Cluster_34 area (10 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/cluster-34/SKILL.md` |
| Work in the Cluster_30 area (7 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/cluster-30/SKILL.md` |
| Work in the Cluster_33 area (5 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/cluster-33/SKILL.md` |
| Work in the Sync area (4 symbols) | `/Users/sergeis/.claude/skills/generated/skillgraph/sync/SKILL.md` |

<!-- skillgen:end -->

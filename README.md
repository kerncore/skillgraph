# SkillGraph

SkillGraph is a local-first code intelligence layer for AI coding agents. It indexes a repository, builds a symbol and relationship graph, and exposes that context through a CLI and MCP server so tools such as Claude Code, Cursor, Codex CLI, and opencode can navigate code with less guesswork.

## What Problem Is Solved

AI coding agents are good at editing code, but they often spend too much time rediscovering how a repository works. On large or unfamiliar projects, plain file search can miss relevant symbols, lose call relationships, or flood the model with unrelated files.

SkillGraph solves this by giving agents a structured, local view of the codebase:

- Find symbols, files, callers, callees, and related code quickly.
- Build focused context for a task without repeatedly scanning the whole repository.
- Analyze potential impact before changing shared code.
- Keep code intelligence local to the developer machine.

## How The Problem Is Solved

SkillGraph parses source files, stores code structure in a local SQLite-backed graph, and serves that graph through command-line and MCP workflows.

Core capabilities include:

- **Repository indexing**: extracts symbols, files, and relationships from supported languages.
- **Knowledge graph traversal**: follows imports, calls, containment, inheritance, and dependency relationships.
- **Task context building**: returns compact, relevant source context for natural-language development tasks.
- **MCP integration**: lets AI agents query the graph directly from their normal coding workflow.
- **Local operation**: stores project data in `.skillgraph/` and does not require a hosted service.

Supported agent targets include Claude Code, Cursor, Codex CLI, and opencode.

## How To Install

### Prerequisites

- Node.js `>=18 <25`
- npm

### Install The CLI

```bash
npm install -g @colbymchenry/skillgraph
```

### Configure Your AI Agent

Run the interactive installer:

```bash
skillgraph install
```

For a non-interactive global setup using detected agents:

```bash
skillgraph install --yes
```

You can also target specific agents:

```bash
skillgraph install --target claude,cursor --location global
```

### Initialize A Project

From the repository you want to index:

```bash
skillgraph init -i
```

This creates `.skillgraph/`, writes the project configuration, and performs the first index.

### Common Commands

```bash
skillgraph status
skillgraph sync
skillgraph query "authentication service"
skillgraph context "understand the request handling flow"
skillgraph affected --stdin
```

To run the MCP server manually:

```bash
skillgraph serve --mcp
```

## Development From Source

```bash
git clone <repository-url>
cd skillgraph
npm install
npm run build
npm test
```

Run the local CLI through npm:

```bash
npm run cli -- status
npm run cli -- query "symbol name"
```

## How To Contribute

1. Fork or branch from the latest main branch.
2. Install dependencies with `npm install`.
3. Make focused changes that match the existing TypeScript style.
4. Add or update tests in `__tests__/` when behavior changes.
5. Run verification before opening a pull request:

```bash
npm test
npm run build
```

When contributing language extraction, graph traversal, installer, or MCP changes, include tests that cover the affected workflow. Keep generated build output out of commits unless a release process explicitly requires it.

## License

MIT

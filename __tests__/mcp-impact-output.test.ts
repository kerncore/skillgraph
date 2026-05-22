import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SkillGraph from '../src';
import { ToolHandler } from '../src/mcp/tools';
import { Node, Subgraph } from '../src/types';

describe('skillgraph_impact output', () => {
  let testDir: string;
  let sg: SkillGraph;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgraph-impact-output-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(
      path.join(testDir, 'src', 'flow.ts'),
      `export function target(value: string): string {\n  return value.trim();\n}\n\nexport function middle(value: string): string {\n  return target(value);\n}\n\nexport function open(value: string): string {\n  return middle(value);\n}\n`
    );
    sg = SkillGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await sg.indexAll();
    handler = new ToolHandler(sg);
  });

  afterEach(() => {
    sg.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns chain-oriented JSON with paths, line refs, risk reasons, and cursor', async () => {
    const result = await handler.execute('skillgraph_impact', {
      symbol: 'target',
      depth: 3,
      limit: 1,
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]!.text);

    expect(typeof payload.target).toBe('string');
    expect(payload.direction).toBe('upstream');
    expect(payload.signature).toContain('target');
    expect(payload.risk.level).toMatch(/LOW|MEDIUM|HIGH|CRITICAL/);
    expect(Array.isArray(payload.risk.reasons)).toBe(true);
    expect(payload.counts.direct_callers).toBeGreaterThanOrEqual(1);
    expect(payload.counts.transitive_callers).toBeGreaterThanOrEqual(1);
    expect(payload.callers).toHaveLength(1);
    expect(typeof payload.callers[0].id).toBe('string');
    expect(payload.callers[0].file).toMatch(/src\/flow\.ts:\d+/);
    expect(payload.callers[0].path_to_target.at(-1)).toBe('target');
    expect(typeof payload.callers[0].call_sites).toBe('number');
    expect(Array.isArray(payload.main_interfaces)).toBe(true);
    expect(payload.graph_impact.callers).toEqual(payload.callers);
    expect(Array.isArray(payload.semantic_consumers)).toBe(true);
    expect(Array.isArray(payload.bridges)).toBe(true);
    expect(result.structuredContent).toEqual(payload);
    expect(payload.next_cursor === null || typeof payload.next_cursor === 'string').toBe(true);
  });

  it('uses next_cursor to return the next page', async () => {
    const first = await handler.execute('skillgraph_impact', {
      symbol: 'target',
      depth: 3,
      limit: 1,
    });
    const firstPayload = JSON.parse(first.content[0]!.text);
    if (!firstPayload.next_cursor) return;

    const second = await handler.execute('skillgraph_impact', {
      symbol: 'target',
      depth: 3,
      limit: 1,
      cursor: firstPayload.next_cursor,
    });
    const secondPayload = JSON.parse(second.content[0]!.text);
    expect(secondPayload.callers[0].id).not.toBe(firstPayload.callers[0].id);
  });

  it('adds semantic consumer bridges in hybrid mode', async () => {
    const target = makeNode({
      id: 'style-node',
      name: 'StyleConfig',
      kind: 'interface',
      filePath: 'src/style.ts',
      qualifiedName: 'src/style.ts::StyleConfig',
      isExported: true,
    });
    const processing = makeNode({
      id: 'processing-node',
      name: 'processing',
      kind: 'function',
      filePath: 'src/processing.ts',
      qualifiedName: 'src/processing.ts::processing',
      isExported: false,
    });
    const impact: Subgraph = {
      roots: [target.id],
      nodes: new Map([[target.id, target]]),
      edges: [],
    };
    const fakeGraph = {
      searchNodes: () => [{ node: target, score: 1 }],
      getImpactRadius: () => impact,
      getNodesInFile: () => [target],
      getChildren: () => [],
      searchSemanticCode: async () => [{
        node: processing,
        score: 0.91,
        document: {
          id: 'qwen:256:usage:processing-node',
          nodeId: processing.id,
          scope: 'usage',
          content: [
            'Usage by function src/processing.ts::processing',
            'Uses:',
            '- interface src/style.ts::StyleConfig at src/style.ts:1',
            'Call and use sites:',
            'Target: interface src/style.ts::StyleConfig',
            '- references in src/processing.ts:4:10',
          ].join('\n'),
          contentHash: 'hash',
          model: 'qwen-test',
          dimension: 256,
          updatedAt: 1,
        },
      }],
    };

    const handler = new ToolHandler(fakeGraph as any);
    const result = await handler.execute('skillgraph_impact', {
      symbol: 'StyleConfig',
      mode: 'hybrid',
    });
    const payload = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(payload.semantic_consumers).toHaveLength(1);
    expect(payload.semantic_consumers[0].name).toBe('processing');
    expect(payload.bridges[0]).toMatchObject({
      to: 'processing() at src/processing.ts:1',
      confidence: 'medium',
    });
    expect(payload.bridges[0].evidence).toContain('semantic_usage');
    expect(payload.bridges[0].evidence).toContain('main_interface');
  });
});

function makeNode(overrides: Partial<Node>): Node {
  return {
    id: 'node',
    kind: 'function',
    name: 'node',
    qualifiedName: 'node',
    filePath: 'src/file.ts',
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 1,
    updatedAt: 1,
    ...overrides,
  };
}

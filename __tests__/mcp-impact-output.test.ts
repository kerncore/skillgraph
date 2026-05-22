import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../src';
import { ToolHandler } from '../src/mcp/tools';

describe('codegraph_impact output', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-impact-output-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(
      path.join(testDir, 'src', 'flow.ts'),
      `export function target(value: string): string {\n  return value.trim();\n}\n\nexport function middle(value: string): string {\n  return target(value);\n}\n\nexport function open(value: string): string {\n  return middle(value);\n}\n`
    );
    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    cg.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns chain-oriented JSON with paths, line refs, risk reasons, and cursor', async () => {
    const result = await handler.execute('codegraph_impact', {
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
    expect(payload.next_cursor === null || typeof payload.next_cursor === 'string').toBe(true);
  });

  it('uses next_cursor to return the next page', async () => {
    const first = await handler.execute('codegraph_impact', {
      symbol: 'target',
      depth: 3,
      limit: 1,
    });
    const firstPayload = JSON.parse(first.content[0]!.text);
    if (!firstPayload.next_cursor) return;

    const second = await handler.execute('codegraph_impact', {
      symbol: 'target',
      depth: 3,
      limit: 1,
      cursor: firstPayload.next_cursor,
    });
    const secondPayload = JSON.parse(second.content[0]!.text);
    expect(secondPayload.callers[0].id).not.toBe(firstPayload.callers[0].id);
  });
});

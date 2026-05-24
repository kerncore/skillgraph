import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectRetrievalIntent,
  formatRerankInstruction,
  getDetailedInstruct,
  scopesForIntent,
  taskForIntent,
} from '../src/retrieval/prompts';
import { RetrievalIndexer } from '../src/retrieval/indexer';
import { DEFAULT_CONFIG, Node, ReferenceOccurrence } from '../src/types';
import { validateConfig } from '../src/config';

describe('Qwen retrieval prompt formatting', () => {
  it('formats embedding query instructions exactly as Qwen expects', () => {
    expect(getDetailedInstruct('Given a task, retrieve code', 'Where is Foo declared?'))
      .toBe('Instruct: Given a task, retrieve code\nQuery:Where is Foo declared?');
  });

  it('does not put embedding instructions on documents', () => {
    const doc = 'Declaration of function foo\nCode:\nfunction foo() {}';
    expect(doc).not.toContain('Instruct:');
    expect(doc).not.toContain('Query:');
  });

  it('formats reranker inputs exactly as Qwen expects', () => {
    expect(formatRerankInstruction('Retrieve code', 'Who calls foo?', 'foo() is called here'))
      .toBe('<Instruct>: Retrieve code\n<Query>: Who calls foo?\n<Document>: foo() is called here');
  });

  it('detects declaration vs usage retrieval intent', () => {
    expect(detectRetrievalIntent('Where is PaymentService implemented?')).toBe('declaration');
    expect(detectRetrievalIntent('Who calls processPayment?')).toBe('usage');
    expect(detectRetrievalIntent('payment processing')).toBe('mixed');
  });

  it('maps intents to retrieval document scopes', () => {
    expect(scopesForIntent('declaration')).toEqual(['declaration']);
    expect(scopesForIntent('usage')).toEqual(['usage']);
    expect(scopesForIntent('mixed')).toEqual(['declaration', 'usage']);
    expect(taskForIntent('declaration')).toContain('declarations');
    expect(taskForIntent('usage')).toContain('usage sites');
  });
});

describe('Qwen retrieval document indexing', () => {
  it('indexes consumer usage documents on the consumer node instead of duplicating target blocks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgraph-qwen-docs-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(
        path.join(root, 'src', 'flow.ts'),
        `export function apiTarget(value: string) {\n  return value.trim();\n}\n\nexport function secondTarget(value: string) {\n  return value.toUpperCase();\n}\n\nfunction callApi(value: string) {\n  return secondTarget(apiTarget(value));\n}\n`
      );

      const baseNode = {
        kind: 'function',
        filePath: 'src/flow.ts',
        language: 'typescript',
        startColumn: 0,
        endColumn: 1,
        updatedAt: 1,
      } as const;
      const apiNode: Node = {
        ...baseNode,
        id: 'api-node',
        name: 'apiTarget',
        qualifiedName: 'src/flow.ts::apiTarget',
        startLine: 1,
        endLine: 3,
        signature: 'apiTarget(value: string)',
        isExported: true,
      };
      const consumerNode: Node = {
        ...baseNode,
        id: 'consumer-node',
        name: 'callApi',
        qualifiedName: 'src/flow.ts::callApi',
        startLine: 9,
        endLine: 11,
        signature: 'callApi(value: string)',
        isExported: false,
      };
      const secondNode: Node = {
        ...baseNode,
        id: 'second-node',
        name: 'secondTarget',
        qualifiedName: 'src/flow.ts::secondTarget',
        startLine: 5,
        endLine: 7,
        signature: 'secondTarget(value: string)',
        isExported: true,
      };
      const apiOccurrence: ReferenceOccurrence = {
        fromNodeId: consumerNode.id,
        targetNodeId: apiNode.id,
        referenceName: 'apiTarget',
        referenceKind: 'calls',
        filePath: 'src/flow.ts',
        language: 'typescript',
        line: 10,
        column: 23,
        sourceSlice: 'return secondTarget(apiTarget(value));',
      };
      const secondOccurrence: ReferenceOccurrence = {
        fromNodeId: consumerNode.id,
        targetNodeId: secondNode.id,
        referenceName: 'secondTarget',
        referenceKind: 'calls',
        filePath: 'src/flow.ts',
        language: 'typescript',
        line: 10,
        column: 9,
        sourceSlice: 'return secondTarget(apiTarget(value));',
      };
      const nodes = new Map([
        [apiNode.id, apiNode],
        [secondNode.id, secondNode],
        [consumerNode.id, consumerNode],
      ]);
      const queries = {
        getAllNodes: () => [apiNode, secondNode, consumerNode],
        getNodeById: (id: string) => nodes.get(id) ?? null,
        getReferenceOccurrencesByTarget: (id: string) => {
          if (id === apiNode.id) return [apiOccurrence];
          if (id === secondNode.id) return [secondOccurrence];
          return [];
        },
      };

      const documents = new RetrievalIndexer(root, queries as any, DEFAULT_CONFIG.qwen!)
        .buildDocuments('qwen-test', 256);
      const declarationDocs = documents.filter((document) => document.scope === 'declaration');
      const usageDocs = documents.filter((document) => document.scope === 'usage');

      expect(declarationDocs.map((document) => document.nodeId)).toEqual([apiNode.id, secondNode.id]);
      expect(usageDocs).toHaveLength(1);
      expect(usageDocs[0]!.nodeId).toBe(consumerNode.id);
      expect(usageDocs[0]!.id).toContain(`usage:${consumerNode.id}`);
      expect(usageDocs[0]!.content).toContain('Usage by function src/flow.ts::callApi');
      expect(usageDocs[0]!.content).toContain('- function src/flow.ts::apiTarget');
      expect(usageDocs[0]!.content).toContain('- function src/flow.ts::secondTarget');
      expect(documents.some((document) => document.scope === 'usage' && document.nodeId === apiNode.id)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists usage embeddings incrementally before declaration embeddings', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgraph-qwen-incremental-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(
        path.join(root, 'src', 'flow.ts'),
        `export function target(value: string) {\n  return value.trim();\n}\n\nfunction consumer(value: string) {\n  return target(value);\n}\n`
      );

      const baseNode = {
        kind: 'function',
        filePath: 'src/flow.ts',
        language: 'typescript',
        startColumn: 0,
        endColumn: 1,
        updatedAt: 1,
      } as const;
      const targetNode: Node = {
        ...baseNode,
        id: 'target-node',
        name: 'target',
        qualifiedName: 'src/flow.ts::target',
        startLine: 1,
        endLine: 3,
        signature: 'target(value: string)',
        isExported: true,
      };
      const consumerNode: Node = {
        ...baseNode,
        id: 'consumer-node',
        name: 'consumer',
        qualifiedName: 'src/flow.ts::consumer',
        startLine: 5,
        endLine: 7,
        signature: 'consumer(value: string)',
        isExported: false,
      };
      const occurrence: ReferenceOccurrence = {
        fromNodeId: consumerNode.id,
        targetNodeId: targetNode.id,
        referenceName: 'target',
        referenceKind: 'calls',
        filePath: 'src/flow.ts',
        language: 'typescript',
        line: 6,
        column: 10,
        sourceSlice: 'return target(value);',
      };
      const nodes = new Map([
        [targetNode.id, targetNode],
        [consumerNode.id, consumerNode],
      ]);
      const upserts: Array<{ scope: string; nodeId: string }> = [];
      const queries = {
        getAllNodes: () => [targetNode, consumerNode],
        getNodeById: (id: string) => nodes.get(id) ?? null,
        getReferenceOccurrencesByTarget: (id: string) => id === targetNode.id ? [occurrence] : [],
        getEmbeddingDocument: () => null,
        deleteEmbeddingDocumentsExcept: () => undefined,
        upsertEmbeddingDocument: (document: { scope: string; nodeId: string }) => {
          upserts.push({ scope: document.scope, nodeId: document.nodeId });
        },
      };
      let calls = 0;
      const provider = {
        modelId: 'qwen-test',
        dimension: 256 as const,
        async embedDocument() {
          calls++;
          if (calls === 2) throw new Error('stop after first persisted embedding');
          return new Float32Array([1, 0]);
        },
      };

      await expect(
        new RetrievalIndexer(root, queries as any, DEFAULT_CONFIG.qwen!)
          .index(provider as any)
      ).rejects.toThrow('stop after first persisted embedding');

      expect(upserts).toEqual([{ scope: 'usage', nodeId: consumerNode.id }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Qwen retrieval config', () => {
  it('defaults to disabled local Qwen retrieval with a matryoshka 256-dim index', () => {
    expect(DEFAULT_CONFIG.qwen).toMatchObject({
      enabled: false,
      embeddingModelPath: 'kerncore/Qwen3-Embedding-0.6B-GGUF',
      rerankerModelPath: 'kerncore/Qwen3-Reranker-0.6B-Q4_K_M',
      embeddingDim: 256,
      contextSize: 32768,
      gpuLayers: 0,
      candidateLimit: 50,
    });
  });

  it('validates supported matryoshka dimensions', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, qwen: { ...DEFAULT_CONFIG.qwen!, embeddingDim: 512 } })).toBe(true);
    expect(validateConfig({ ...DEFAULT_CONFIG, qwen: { ...DEFAULT_CONFIG.qwen!, embeddingDim: 999 } })).toBe(false);
  });
});

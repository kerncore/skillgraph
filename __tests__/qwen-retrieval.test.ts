import { describe, it, expect } from 'vitest';
import {
  detectRetrievalIntent,
  formatRerankInstruction,
  getDetailedInstruct,
  scopesForIntent,
  taskForIntent,
} from '../src/retrieval/prompts';
import { DEFAULT_CONFIG } from '../src/types';
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

describe('Qwen retrieval config', () => {
  it('defaults to disabled local Qwen retrieval with a matryoshka 256-dim index', () => {
    expect(DEFAULT_CONFIG.qwen).toMatchObject({
      enabled: false,
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QwenRetrievalConfig } from '../src/types';
import {
  QwenGgufEmbeddingProvider,
  normalizeQwenGgufModelReference,
  QwenGgufRerankerProvider,
  setQwenGgufLlamaModuleLoaderForTests,
} from '../src/retrieval/qwen-gguf';

const llamaMock = vi.hoisted(() => ({
  resolvedRefs: [] as Array<{ uriOrPath: string; options: unknown }>,
  getEmbeddingFor: vi.fn(),
  rankAndSort: vi.fn(),
  rank: vi.fn(),
  loadModel: vi.fn(),
  clearHistory: vi.fn(),
  generateCompletion: vi.fn(),
}));

const llamaModule = {
  LlamaCompletion: vi.fn().mockImplementation(() => ({
    generateCompletion: llamaMock.generateCompletion,
  })),
  getLlama: vi.fn(async () => ({
    loadModel: llamaMock.loadModel,
  })),
  resolveModelFile: vi.fn(async (uriOrPath: string, options: unknown) => {
    llamaMock.resolvedRefs.push({ uriOrPath, options });
    return `/resolved/${uriOrPath.replaceAll('/', '_')}`;
  }),
};

beforeEach(() => {
  setQwenGgufLlamaModuleLoaderForTests(async () => llamaModule);
});

afterEach(() => {
  setQwenGgufLlamaModuleLoaderForTests();
});

const qwenConfig: QwenRetrievalConfig = {
  enabled: true,
  embeddingModelPath: 'kerncore/Qwen3-Embedding-0.6B-GGUF',
  rerankerModelPath: 'kerncore/Qwen3-Reranker-0.6B-Q4_K_M',
  embeddingDim: 256,
  contextSize: 2048,
  gpuLayers: 0,
  candidateLimit: 2,
};

const docs = [
  {
    id: 'doc-a',
    nodeId: 'node-a',
    scope: 'declaration' as const,
    content: 'function foo() {}',
    contentHash: 'a',
    model: 'qwen-test',
    dimension: 256 as const,
    updatedAt: 1,
  },
  {
    id: 'doc-b',
    nodeId: 'node-b',
    scope: 'usage' as const,
    content: 'foo() is called from bar()',
    contentHash: 'b',
    model: 'qwen-test',
    dimension: 256 as const,
    updatedAt: 1,
  },
];

describe('Qwen GGUF model references', () => {
  it('normalizes bare Hugging Face Qwen GGUF repos to node-llama-cpp Q4_K_M model URIs', () => {
    expect(normalizeQwenGgufModelReference('kerncore/Qwen3-Embedding-0.6B-GGUF'))
      .toBe('hf:kerncore/Qwen3-Embedding-0.6B-GGUF/qwen3-embedding-0.6b-q4_k_m.gguf');
    expect(normalizeQwenGgufModelReference('kerncore/Qwen3-Reranker-0.6B-Q4_K_M'))
      .toBe('hf:kerncore/Qwen3-Reranker-0.6B-Q4_K_M/Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf');
  });

  it('normalizes Hugging Face repo pages to node-llama-cpp Q4_K_M model URIs', () => {
    expect(normalizeQwenGgufModelReference('https://huggingface.co/kerncore/Qwen3-Embedding-0.6B-GGUF'))
      .toBe('hf:kerncore/Qwen3-Embedding-0.6B-GGUF/qwen3-embedding-0.6b-q4_k_m.gguf');
    expect(normalizeQwenGgufModelReference('https://huggingface.co/kerncore/Qwen3-Reranker-0.6B-Q4_K_M'))
      .toBe('hf:kerncore/Qwen3-Reranker-0.6B-Q4_K_M/Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf');
  });

  it('normalizes Hugging Face GGUF file pages to node-llama-cpp file URIs', () => {
    expect(
      normalizeQwenGgufModelReference(
        'https://huggingface.co/kerncore/Qwen3-Reranker-0.6B-Q4_K_M/blob/main/Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf'
      )
    ).toBe('hf:kerncore/Qwen3-Reranker-0.6B-Q4_K_M/Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf');
  });
});

describe('QwenGgufEmbeddingProvider', () => {
  beforeEach(() => {
    llamaMock.resolvedRefs.length = 0;
    llamaMock.getEmbeddingFor.mockReset();
    llamaMock.loadModel.mockReset();
    llamaMock.getEmbeddingFor.mockResolvedValue({
      vector: [3, 4, 0],
    });
    llamaMock.loadModel.mockResolvedValue({
      createEmbeddingContext: vi.fn(async () => ({
        getEmbeddingFor: llamaMock.getEmbeddingFor,
      })),
    });
  });

  it('resolves the real embedding HF repo through node-llama-cpp', async () => {
    const provider = new QwenGgufEmbeddingProvider(qwenConfig);
    const embedding = await provider.embedDocument('function foo() {}');

    expect(llamaMock.resolvedRefs).toEqual([
      {
        uriOrPath: 'hf:kerncore/Qwen3-Embedding-0.6B-GGUF/qwen3-embedding-0.6b-q4_k_m.gguf',
        options: { cli: false },
      },
    ]);
    expect(llamaMock.loadModel).toHaveBeenCalledWith({
      modelPath: '/resolved/hf:kerncore_Qwen3-Embedding-0.6B-GGUF_qwen3-embedding-0.6b-q4_k_m.gguf',
      gpuLayers: 0,
    });
    expect(llamaMock.getEmbeddingFor).toHaveBeenCalledWith('function foo() {}');
    expect(embedding).toHaveLength(256);
    expect(Array.from(embedding.slice(0, 3))).toEqual([0.6000000238418579, 0.800000011920929, 0]);
  });

  it('truncates oversized documents before embedding with local GGUF models', async () => {
    const provider = new QwenGgufEmbeddingProvider(qwenConfig);
    const longDocument = `start-${'x'.repeat(7000)}-end`;

    await provider.embedDocument(longDocument);

    const embeddedText = llamaMock.getEmbeddingFor.mock.calls[0]![0] as string;
    expect(embeddedText.length).toBe(6000);
    expect(embeddedText).toContain('[...truncated for embedding...]');
    expect(embeddedText.startsWith('start-')).toBe(true);
    expect(embeddedText.endsWith('-end')).toBe(true);
  });
});

describe('QwenGgufRerankerProvider', () => {
  beforeEach(() => {
    llamaMock.resolvedRefs.length = 0;
    llamaMock.getEmbeddingFor.mockReset();
    llamaMock.rankAndSort.mockReset();
    llamaMock.rank.mockReset();
    llamaMock.loadModel.mockReset();
    llamaMock.clearHistory.mockReset();
    llamaMock.generateCompletion.mockReset();
    llamaMock.loadModel.mockResolvedValue({
      createRankingContext: vi.fn(async () => ({
        rankAndSort: llamaMock.rankAndSort,
        rank: llamaMock.rank,
      })),
    });
  });

  it('resolves Hugging Face model pages and reranks with real node-llama-cpp query/document inputs', async () => {
    llamaMock.rankAndSort.mockResolvedValue([
      { document: docs[1]!.content, score: 0.94 },
      { document: docs[0]!.content, score: 0.12 },
    ]);

    const provider = new QwenGgufRerankerProvider(qwenConfig);
    const result = await provider.rerank('Who calls foo?', docs, 'usage');

    expect(llamaMock.resolvedRefs).toEqual([
      {
        uriOrPath: 'hf:kerncore/Qwen3-Reranker-0.6B-Q4_K_M/Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf',
        options: { cli: false },
      },
    ]);
    expect(llamaMock.loadModel).toHaveBeenCalledWith({
      modelPath: '/resolved/hf:kerncore_Qwen3-Reranker-0.6B-Q4_K_M_Qwen.Qwen3-Reranker-0.6B.Q4_K_M.gguf',
      gpuLayers: 0,
    });
    expect(llamaMock.rankAndSort).toHaveBeenCalledWith(
      'Who calls foo?',
      ['function foo() {}', 'foo() is called from bar()']
    );
    expect(result.map((item) => item.document.id)).toEqual(['doc-b', 'doc-a']);
    expect(result.map((item) => item.score)).toEqual([0.94, 0.12]);
  });

  it('falls back to Qwen yes/no completion scoring when ranking context is unsupported', async () => {
    llamaMock.generateCompletion
      .mockResolvedValueOnce('no')
      .mockResolvedValueOnce('yes');
    llamaMock.loadModel.mockResolvedValue({
      createRankingContext: vi.fn(async () => {
        throw new Error('Computing rankings is not supported for this model.');
      }),
      createContext: vi.fn(async () => ({
        getSequence: () => ({
          clearHistory: llamaMock.clearHistory,
        }),
      })),
    });

    const provider = new QwenGgufRerankerProvider(qwenConfig);
    const result = await provider.rerank('Who calls foo?', docs, 'usage');

    expect(llamaMock.generateCompletion).toHaveBeenCalledTimes(2);
    expect(llamaMock.clearHistory).toHaveBeenCalledTimes(2);
    expect(llamaMock.generateCompletion.mock.calls[0]![0]).toContain('answer can only be "yes" or "no"');
    expect(llamaMock.generateCompletion.mock.calls[0]![0]).toContain('<Query>: Who calls foo?');
    expect(llamaMock.generateCompletion.mock.calls[0]![0]).toContain('<Document>: function foo() {}');
    expect(result.map((item) => item.document.id)).toEqual(['doc-b', 'doc-a']);
    expect(result.map((item) => item.score)).toEqual([1, 0]);
  });
});

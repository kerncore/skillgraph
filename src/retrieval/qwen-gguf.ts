import {
  EmbeddingDimension,
  EmbeddingDocument,
  QwenRetrievalConfig,
  RerankResult,
  RetrievalIntent,
} from '../types';
import {
  formatRerankInstruction,
  getDetailedInstruct,
  RERANK_CODE_TASK,
  taskForIntent,
} from './prompts';

const QWEN_EMBEDDING_MODEL_ID = 'Qwen3-Embedding-0.6B-GGUF';
const QWEN_RERANKER_MODEL_ID = 'Qwen3-Reranker-0.6B-GGUF';

type LlamaModule = {
  getLlama?: () => Promise<any>;
};

async function loadNodeLlamaCpp(): Promise<LlamaModule> {
  try {
    return await import('node-llama-cpp') as LlamaModule;
  } catch (error) {
    throw new Error(
      `node-llama-cpp is required for Qwen GGUF retrieval. Install optional dependencies and configure qwen model paths. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function truncateMatryoshka(vector: readonly number[], dim: EmbeddingDimension): Float32Array {
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = vector[i] ?? 0;
  return normalize(out);
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
  return vector;
}

export interface EmbeddingProvider {
  embedQuery(query: string, intent: RetrievalIntent): Promise<Float32Array>;
  embedDocument(document: string): Promise<Float32Array>;
  readonly modelId: string;
  readonly dimension: EmbeddingDimension;
}

export interface RerankerProvider {
  rerank(query: string, docs: EmbeddingDocument[], intent: RetrievalIntent): Promise<RerankResult[]>;
  readonly modelId: string;
}

export class QwenGgufEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = QWEN_EMBEDDING_MODEL_ID;
  readonly dimension: EmbeddingDimension;
  private contextPromise: Promise<any> | null = null;

  constructor(private readonly config: QwenRetrievalConfig) {
    this.dimension = config.embeddingDim;
    if (!config.embeddingModelPath) {
      throw new Error('qwen.embeddingModelPath is required when Qwen retrieval is enabled');
    }
  }

  async embedQuery(query: string, intent: RetrievalIntent): Promise<Float32Array> {
    return this.embedRaw(getDetailedInstruct(taskForIntent(intent), query));
  }

  async embedDocument(document: string): Promise<Float32Array> {
    return this.embedRaw(document);
  }

  private async embedRaw(text: string): Promise<Float32Array> {
    const context = await this.getContext();
    const embedding = await context.getEmbeddingFor(text);
    const vector = Array.from(embedding.vector ?? embedding);
    return truncateMatryoshka(vector as number[], this.dimension);
  }

  private async getContext(): Promise<any> {
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const mod = await loadNodeLlamaCpp();
        const llama = mod.getLlama ? await mod.getLlama() : mod;
        const model = await llama.loadModel({
          modelPath: this.config.embeddingModelPath,
          gpuLayers: this.config.gpuLayers,
        });
        return model.createEmbeddingContext({
          contextSize: this.config.contextSize,
        });
      })();
    }
    return this.contextPromise;
  }
}

export class QwenGgufRerankerProvider implements RerankerProvider {
  readonly modelId = QWEN_RERANKER_MODEL_ID;
  private contextPromise: Promise<any> | null = null;

  constructor(private readonly config: QwenRetrievalConfig) {
    if (!config.rerankerModelPath) {
      throw new Error('qwen.rerankerModelPath is required when Qwen reranking is enabled');
    }
  }

  async rerank(query: string, docs: EmbeddingDocument[], intent: RetrievalIntent): Promise<RerankResult[]> {
    if (docs.length === 0) return [];
    const instruction = intent === 'mixed' ? RERANK_CODE_TASK : taskForIntent(intent);
    const formattedDocs = docs.map((doc) => formatRerankInstruction(instruction, query, doc.content));
    const context = await this.getContext();

    if (typeof context.rankAndSort === 'function') {
      const ranked = await context.rankAndSort('', formattedDocs);
      return this.mapRankedResults(ranked, docs);
    }

    if (typeof context.rank === 'function') {
      const scored = await Promise.all(
        formattedDocs.map(async (doc, index) => ({
          index,
          score: Number(await context.rank('', doc)),
        }))
      );
      return scored
        .sort((a, b) => b.score - a.score)
        .map((item) => ({
          document: docs[item.index]!,
          score: item.score,
        }));
    }

    throw new Error('node-llama-cpp ranking context does not expose rankAndSort or rank');
  }

  private mapRankedResults(ranked: unknown, docs: EmbeddingDocument[]): RerankResult[] {
    const rankedItems = Array.isArray(ranked) ? ranked : [];
    return rankedItems.map((item: any, rank: number) => {
      const docText = typeof item === 'string' ? item : item.document ?? item.text ?? item.value;
      const index = docText ? docs.findIndex((doc) => docText.endsWith(doc.content)) : rank;
      const safeIndex = index >= 0 ? index : rank;
      return {
        document: docs[safeIndex]!,
        score: Number(item.score ?? item.relevanceScore ?? (docs.length - rank)),
      };
    }).filter((result) => result.document !== undefined);
  }

  private async getContext(): Promise<any> {
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const mod = await loadNodeLlamaCpp();
        const llama = mod.getLlama ? await mod.getLlama() : mod;
        const model = await llama.loadModel({
          modelPath: this.config.rerankerModelPath,
          gpuLayers: this.config.gpuLayers,
        });
        return model.createRankingContext({
          contextSize: this.config.contextSize,
        });
      })();
    }
    return this.contextPromise;
  }
}

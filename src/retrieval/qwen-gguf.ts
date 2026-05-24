import {
  EmbeddingDimension,
  EmbeddingDocument,
  QwenRetrievalConfig,
  RerankResult,
  RetrievalIntent,
} from '../types';
import {
  getDetailedInstruct,
  taskForIntent,
} from './prompts';

const QWEN_EMBEDDING_MODEL_ID = 'Qwen3-Embedding-0.6B-GGUF';
const QWEN_RERANKER_MODEL_ID = 'Qwen3-Reranker-0.6B-GGUF';
const DEFAULT_GGUF_QUANT = 'Q4_K_M';
export const DEFAULT_QWEN_EMBEDDING_MODEL_REFERENCE = 'kerncore/Qwen3-Embedding-0.6B-GGUF';
export const DEFAULT_QWEN_RERANKER_MODEL_REFERENCE = 'kerncore/Qwen3-Reranker-0.6B-Q4_K_M';

type LlamaModule = {
  getLlama?: () => Promise<any>;
  resolveModelFile?: (
    uriOrPath: string,
    options?: {
      cli?: boolean;
      download?: 'auto' | false;
      verify?: boolean;
    }
  ) => Promise<string>;
};

async function loadNodeLlamaCpp(): Promise<LlamaModule> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<LlamaModule>;
    return await dynamicImport('node-llama-cpp');
  } catch (error) {
    throw new Error(
      `node-llama-cpp is required for Qwen GGUF retrieval. Install optional dependencies and configure qwen model paths. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function normalizeQwenGgufModelReference(modelReference: string): string {
  const trimmed = modelReference.trim();
  if (isBareQwenGgufHuggingFaceRepo(trimmed)) {
    return `hf:${trimmed}:${DEFAULT_GGUF_QUANT}`;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return trimmed;
  if (url.hostname !== 'huggingface.co' && url.hostname !== 'www.huggingface.co' && url.hostname !== 'hf.co') {
    return trimmed;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return trimmed;

  const repo = `${parts[0]}/${parts[1]}`;
  const mode = parts[2];
  const filePath = (mode === 'blob' || mode === 'resolve') && parts.length > 4
    ? parts.slice(4).join('/')
    : undefined;

  if (filePath?.toLowerCase().endsWith('.gguf')) {
    return `hf:${repo}/${filePath}`;
  }

  return `hf:${repo}:${DEFAULT_GGUF_QUANT}`;
}

function isBareQwenGgufHuggingFaceRepo(modelReference: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(modelReference)) {
    return false;
  }
  const repoName = modelReference.split('/')[1]!;
  return /qwen3-(embedding|reranker).*(gguf|q\d(?:_[a-z]){0,2})/i.test(repoName);
}

function shouldResolveModelReference(modelReference: string): boolean {
  return /^(https?:\/\/|hf:|huggingface:|hf\.co\/|huggingface\.co\/)/.test(modelReference);
}

async function resolveModelPath(mod: LlamaModule, modelReference: string): Promise<string> {
  const normalizedReference = normalizeQwenGgufModelReference(modelReference);
  if (!shouldResolveModelReference(normalizedReference)) return normalizedReference;
  if (typeof mod.resolveModelFile !== 'function') {
    throw new Error('node-llama-cpp resolveModelFile is required for remote Qwen GGUF model references');
  }
  return mod.resolveModelFile(normalizedReference, { cli: false });
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
        const modelPath = await resolveModelPath(mod, this.config.embeddingModelPath!);
        const model = await llama.loadModel({
          modelPath,
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

  async rerank(query: string, docs: EmbeddingDocument[], _intent: RetrievalIntent): Promise<RerankResult[]> {
    if (docs.length === 0) return [];
    const documentContents = docs.map((doc) => doc.content);
    const context = await this.getContext();

    if (typeof context.rankAndSort === 'function') {
      const ranked = await context.rankAndSort(query, documentContents);
      return this.mapRankedResults(ranked, docs);
    }

    if (typeof context.rank === 'function') {
      const scored = await Promise.all(
        docs.map(async (doc, index) => ({
          index,
          score: Number(await context.rank(query, doc.content)),
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
      const index = docText ? docs.findIndex((doc) => doc.content === docText) : rank;
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
        const modelPath = await resolveModelPath(mod, this.config.rerankerModelPath!);
        const model = await llama.loadModel({
          modelPath,
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

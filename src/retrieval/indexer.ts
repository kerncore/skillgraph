import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import {
  EmbeddingDimension,
  EmbeddingDocument,
  Node,
  QwenRetrievalConfig,
  ReferenceOccurrence,
} from '../types';
import { validatePathWithinRoot } from '../utils';
import { EmbeddingProvider } from './qwen-gguf';

const DECLARATION_KINDS = new Set([
  'class', 'struct', 'interface', 'trait', 'protocol', 'function', 'method',
  'type_alias', 'enum', 'component', 'route', 'namespace', 'module',
]);

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function documentId(nodeId: string, scope: 'declaration' | 'usage', model: string, dimension: EmbeddingDimension): string {
  return `${model}:${dimension}:${scope}:${nodeId}`;
}

function readNodeSource(projectRoot: string, node: Node, maxChars = 6000): string {
  const fullPath = validatePathWithinRoot(projectRoot, node.filePath);
  if (!fullPath || !fs.existsSync(fullPath)) return '';
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const start = Math.max(0, node.startLine - 1);
  const end = Math.min(lines.length, node.endLine);
  return lines.slice(start, end).join('\n').slice(0, maxChars);
}

function formatDeclarationDocument(projectRoot: string, node: Node): string {
  const source = readNodeSource(projectRoot, node);
  const parts = [
    `Declaration of ${node.kind} ${node.qualifiedName || node.name}`,
    `Name: ${node.name}`,
    `Kind: ${node.kind}`,
    `Language: ${node.language}`,
    `File: ${node.filePath}:${node.startLine}`,
  ];
  if (node.signature) parts.push(`Signature: ${node.signature}`);
  if (node.docstring) parts.push(`Docstring: ${node.docstring}`);
  if (source) parts.push(`Code:\n${source}`);
  return parts.join('\n');
}

function formatUsageDocument(node: Node, occurrences: ReferenceOccurrence[]): string {
  const parts = [
    `Usage of ${node.kind} ${node.qualifiedName || node.name}`,
    `Name: ${node.name}`,
    `Kind: ${node.kind}`,
    `Language: ${node.language}`,
    `Declaration: ${node.filePath}:${node.startLine}`,
    'Call and use sites:',
  ];

  for (const occurrence of occurrences.slice(0, 20)) {
    parts.push(
      `- ${occurrence.referenceKind} in ${occurrence.filePath}:${occurrence.line}:${occurrence.column} from ${occurrence.fromNodeId}`
    );
    if (occurrence.sourceSlice) {
      parts.push(`  ${occurrence.sourceSlice.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
    }
  }

  return parts.join('\n');
}

export class RetrievalIndexer {
  constructor(
    private readonly projectRoot: string,
    private readonly queries: QueryBuilder,
    _config: QwenRetrievalConfig
  ) {
    void _config;
  }

  buildDocuments(model: string, dimension: EmbeddingDimension): EmbeddingDocument[] {
    const now = Date.now();
    const nodes = this.queries.getAllNodes();
    const documents: EmbeddingDocument[] = [];

    for (const node of nodes) {
      if (!DECLARATION_KINDS.has(node.kind)) continue;
      const content = formatDeclarationDocument(this.projectRoot, node);
      documents.push({
        id: documentId(node.id, 'declaration', model, dimension),
        nodeId: node.id,
        scope: 'declaration',
        content,
        contentHash: sha256(content),
        model,
        dimension,
        updatedAt: now,
      });

      const occurrences = this.queries.getReferenceOccurrencesByTarget(node.id, 20);
      if (occurrences.length > 0) {
        const usageContent = formatUsageDocument(node, occurrences);
        documents.push({
          id: documentId(node.id, 'usage', model, dimension),
          nodeId: node.id,
          scope: 'usage',
          content: usageContent,
          contentHash: sha256(usageContent),
          model,
          dimension,
          updatedAt: now,
        });
      }
    }

    return documents;
  }

  async index(provider: EmbeddingProvider): Promise<{ documents: number; embedded: number }> {
    const documents = this.buildDocuments(provider.modelId, provider.dimension);
    let embedded = 0;
    const prepared: EmbeddingDocument[] = [];

    for (const document of documents) {
      const existing = this.queries.getEmbeddingDocument(document.id);
      if (existing && existing.contentHash === document.contentHash && existing.embedding) {
        prepared.push({ ...document, embedding: existing.embedding });
        continue;
      }
      prepared.push({
        ...document,
        embedding: await provider.embedDocument(document.content),
      });
      embedded++;
    }

    this.queries.upsertEmbeddingDocuments(prepared);
    return { documents: documents.length, embedded };
  }
}

export function createRetrievalIndexer(
  projectRoot: string,
  queries: QueryBuilder,
  config: QwenRetrievalConfig
): RetrievalIndexer {
  return new RetrievalIndexer(path.resolve(projectRoot), queries, config);
}

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
  RetrievalScope,
} from '../types';
import { validatePathWithinRoot } from '../utils';
import { EmbeddingProvider } from './qwen-gguf';

const DECLARATION_KINDS = new Set([
  'class', 'struct', 'interface', 'trait', 'protocol', 'function', 'method',
  'type_alias', 'enum', 'component', 'route', 'namespace', 'module',
]);

const INTERFACE_KINDS = new Set([
  'class', 'struct', 'interface', 'trait', 'protocol',
  'type_alias', 'enum', 'component', 'route', 'namespace', 'module',
]);

interface UsageTargetGroup {
  target: Node;
  occurrences: ReferenceOccurrence[];
}

interface UsageDocumentGroup {
  consumer: Node;
  targets: Map<string, UsageTargetGroup>;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function documentId(key: string, scope: RetrievalScope, model: string, dimension: EmbeddingDimension): string {
  return `${model}:${dimension}:${scope}:${key}`;
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

function classifyNodeRole(node: Node, consumerNodeIds: Set<string>): RetrievalScope | null {
  if (!DECLARATION_KINDS.has(node.kind)) return null;
  if (INTERFACE_KINDS.has(node.kind) || node.isExported) return 'declaration';
  return consumerNodeIds.has(node.id) ? 'usage' : 'declaration';
}

function formatUsageDocument(projectRoot: string, consumer: Node, targets: UsageTargetGroup[]): string {
  const source = readNodeSource(projectRoot, consumer);
  const parts = [
    `Usage by ${consumer.kind} ${consumer.qualifiedName || consumer.name}`,
    `Name: ${consumer.name}`,
    `Kind: ${consumer.kind}`,
    `Language: ${consumer.language}`,
    `File: ${consumer.filePath}:${consumer.startLine}`,
    'Uses:',
  ];

  for (const { target } of targets) {
    parts.push(`- ${target.kind} ${target.qualifiedName || target.name} at ${target.filePath}:${target.startLine}`);
  }

  parts.push('Call and use sites:');

  for (const { target, occurrences } of targets) {
    parts.push(`Target: ${target.kind} ${target.qualifiedName || target.name}`);
    for (const occurrence of occurrences.slice(0, 20)) {
      parts.push(
        `- ${occurrence.referenceKind} in ${occurrence.filePath}:${occurrence.line}:${occurrence.column}`
      );
      if (occurrence.sourceSlice) {
        parts.push(`  ${occurrence.sourceSlice.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
      }
    }
  }

  if (source) parts.push(`Code:\n${source}`);

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
    const consumerNodeIds = new Set<string>();
    const usageGroups = new Map<string, UsageDocumentGroup>();

    for (const target of nodes) {
      if (!DECLARATION_KINDS.has(target.kind)) continue;
      const occurrences = this.queries.getReferenceOccurrencesByTarget(target.id, 20);
      for (const occurrence of occurrences) {
        const consumer = this.queries.getNodeById(occurrence.fromNodeId);
        if (!consumer) continue;
        consumerNodeIds.add(consumer.id);
        const group = usageGroups.get(consumer.id);
        if (group) {
          const targetGroup = group.targets.get(target.id);
          if (targetGroup) {
            targetGroup.occurrences.push(occurrence);
          } else {
            group.targets.set(target.id, { target, occurrences: [occurrence] });
          }
        } else {
          usageGroups.set(consumer.id, {
            consumer,
            targets: new Map([[target.id, { target, occurrences: [occurrence] }]]),
          });
        }
      }
    }

    for (const node of nodes) {
      if (classifyNodeRole(node, consumerNodeIds) !== 'declaration') continue;
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
    }

    for (const group of usageGroups.values()) {
      if (classifyNodeRole(group.consumer, consumerNodeIds) !== 'usage') continue;
      const usageContent = formatUsageDocument(this.projectRoot, group.consumer, [...group.targets.values()]);
      documents.push({
        id: documentId(group.consumer.id, 'usage', model, dimension),
        nodeId: group.consumer.id,
        scope: 'usage',
        content: usageContent,
        contentHash: sha256(usageContent),
        model,
        dimension,
        updatedAt: now,
      });
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

    this.queries.deleteEmbeddingDocumentsExcept(
      provider.modelId,
      provider.dimension,
      new Set(documents.map((document) => document.id))
    );
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

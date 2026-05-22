import { RetrievalIntent, RetrievalScope } from '../types';

export const DECLARATION_RETRIEVAL_TASK =
  'Given a code search query, retrieve code declarations, definitions, implementations, APIs, signatures, and type contracts that answer the query.';

export const USAGE_RETRIEVAL_TASK =
  'Given a code search query, retrieve code usage sites, callers, call examples, dependencies, type uses, and integration flows that answer the query.';

export const MIXED_RETRIEVAL_TASK =
  'Given a code search query, retrieve the most relevant code declarations or usage sites that answer the query.';

export const RERANK_CODE_TASK =
  'Given a code search query, determine whether the document contains the most relevant code block, declaration, usage site, or implementation needed to answer the query.';

const DECLARATION_HINTS = [
  'declare', 'declared', 'declaration', 'define', 'defined', 'definition',
  'implement', 'implemented', 'implementation', 'signature', 'interface',
  'class', 'struct', 'trait', 'protocol', 'type', 'api', 'contract',
];

const USAGE_HINTS = [
  'call', 'calls', 'caller', 'callers', 'called', 'use', 'uses', 'usage',
  'used', 'reference', 'references', 'referenced', 'depends', 'dependency',
  'flow', 'integration', 'example', 'examples', 'instantiates', 'imports',
];

export function detectRetrievalIntent(query: string): RetrievalIntent {
  const lowered = query.toLowerCase();
  const declarationScore = DECLARATION_HINTS.reduce(
    (score, hint) => score + (lowered.includes(hint) ? 1 : 0),
    0
  );
  const usageScore = USAGE_HINTS.reduce(
    (score, hint) => score + (lowered.includes(hint) ? 1 : 0),
    0
  );

  if (declarationScore > usageScore) return 'declaration';
  if (usageScore > declarationScore) return 'usage';
  return 'mixed';
}

export function scopesForIntent(intent: RetrievalIntent): RetrievalScope[] {
  if (intent === 'declaration') return ['declaration'];
  if (intent === 'usage') return ['usage'];
  return ['declaration', 'usage'];
}

export function taskForIntent(intent: RetrievalIntent): string {
  if (intent === 'declaration') return DECLARATION_RETRIEVAL_TASK;
  if (intent === 'usage') return USAGE_RETRIEVAL_TASK;
  return MIXED_RETRIEVAL_TASK;
}

export function getDetailedInstruct(taskDescription: string, query: string): string {
  return `Instruct: ${taskDescription}\nQuery:${query}`;
}

export function formatRerankInstruction(
  instruction: string | null,
  query: string,
  doc: string
): string {
  const task = instruction ?? 'Given a web search query, retrieve relevant passages that answer the query';
  return `<Instruct>: ${task}\n<Query>: ${query}\n<Document>: ${doc}`;
}

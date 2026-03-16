/**
 * Text similarity module using token-set overlap (Jaccard + weighted cosine).
 * All functions are pure (no I/O).
 */

export const DEFAULT_SIMILARITY_THRESHOLD = 0.55;

/**
 * Split text into tokens.
 * - Chinese characters: both unigrams and bigrams for balanced precision/recall
 * - Latin/digit words: split on non-alphanumeric, lowercase
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  const chineseChars = text.replace(/[^\u4e00-\u9fff]/g, '');

  // Chinese unigrams
  for (const ch of chineseChars) {
    tokens.push(ch);
  }
  // Chinese bigrams
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.push(chineseChars[i] + chineseChars[i + 1]);
  }

  // Latin/digit words
  const latinWords = text.match(/[a-zA-Z0-9]+/g);
  if (latinWords) {
    for (const w of latinWords) {
      tokens.push(w.toLowerCase());
    }
  }

  return tokens;
}

/**
 * Build term-frequency vectors (no IDF — use raw TF for small corpora).
 */
function buildTfVector(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const vec = new Map<string, number>();
  if (tokens.length === 0) return vec;

  for (const t of tokens) {
    vec.set(t, (vec.get(t) ?? 0) + 1);
  }

  // Normalize to unit length
  const totalSq = Math.sqrt([...vec.values()].reduce((sum, v) => sum + v * v, 0));
  if (totalSq > 0) {
    for (const [k, v] of vec) {
      vec.set(k, v / totalSq);
    }
  }

  return vec;
}

/**
 * Cosine similarity between two normalized TF vectors.
 */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0.0;

  let dot = 0;
  // Iterate over the smaller map for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, valA] of smaller) {
    const valB = larger.get(term);
    if (valB !== undefined) {
      dot += valA * valB;
    }
  }

  return Math.min(1.0, Math.max(0.0, dot));
}

/**
 * Prepare a document for similarity comparison.
 * Title is weighted 2x by repetition.
 */
function prepareDoc(item: { title: string; content: string }): string {
  return `${item.title} ${item.title} ${item.content}`;
}

/**
 * Full corpus similarity matrix.
 * Uses cosine similarity on normalized TF vectors.
 */
export function computeSimilarityMatrix(items: Array<{ title: string; content: string }>): number[][] {
  const vectors = items.map(item => buildTfVector(prepareDoc(item)));
  const n = items.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }

  return matrix;
}

/**
 * Independent 2-doc pairwise similarity.
 * Same algorithm as computeSimilarityMatrix but for exactly 2 documents.
 */
export function computePairwiseSimilarity(
  a: { title: string; content: string },
  b: { title: string; content: string },
): number {
  const docA = prepareDoc(a);
  const docB = prepareDoc(b);

  if (docA.trim().length === 0 || docB.trim().length === 0) return 0.0;

  const vecA = buildTfVector(docA);
  const vecB = buildTfVector(docB);

  return cosineSimilarity(vecA, vecB);
}

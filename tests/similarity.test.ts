import { describe, it, expect } from 'vitest';
import {
  tokenize,
  cosineSimilarity,
  computeSimilarityMatrix,
  computePairwiseSimilarity,
  DEFAULT_SIMILARITY_THRESHOLD,
} from '../src/lib/similarity.js';

describe('tokenize', () => {
  it('produces unigrams and bigrams for Chinese text', () => {
    const tokens = tokenize('美联储加息');
    // Unigrams
    expect(tokens).toContain('美');
    expect(tokens).toContain('联');
    expect(tokens).toContain('储');
    // Bigrams
    expect(tokens).toContain('美联');
    expect(tokens).toContain('联储');
    expect(tokens).toContain('加息');
  });

  it('produces lowercase words for English text', () => {
    const tokens = tokenize('Fed Raises Interest Rates');
    expect(tokens).toContain('fed');
    expect(tokens).toContain('raises');
    expect(tokens).toContain('interest');
    expect(tokens).toContain('rates');
  });

  it('handles mixed Chinese/English text', () => {
    const tokens = tokenize('美联储 Fed 加息 25bp');
    expect(tokens.some(t => /[\u4e00-\u9fff]/.test(t))).toBe(true);
    expect(tokens.some(t => /[a-z]/.test(t))).toBe(true);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('returns 0.0 for empty vectors', () => {
    expect(cosineSimilarity(new Map(), new Map())).toBe(0);
  });

  it('returns 1.0 for identical normalized vectors', () => {
    const v = new Map([['a', 0.6], ['b', 0.8]]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Map([['x', 1]]);
    const b = new Map([['y', 1]]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('computeSimilarityMatrix', () => {
  const EVENT_A_SRC1 = {
    title: '美联储宣布加息25个基点',
    content: '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。这是今年第三次加息。',
  };
  const EVENT_A_SRC2 = {
    title: '美联储如期加息25个基点',
    content: '美联储如期加息25个基点，联邦基金利率升至新区间。鲍威尔表示未来将视经济数据决定政策路径。',
  };
  const EVENT_B = {
    title: '苹果发布新款MacBook Pro',
    content: '苹果公司今日发布搭载M4芯片的新款MacBook Pro，性能提升显著，售价从14999元起。',
  };

  it('same-event articles from different sources score above threshold', () => {
    const matrix = computeSimilarityMatrix([EVENT_A_SRC1, EVENT_A_SRC2]);
    expect(matrix[0][1]).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('unrelated articles score below 0.2', () => {
    const matrix = computeSimilarityMatrix([EVENT_A_SRC1, EVENT_B]);
    expect(matrix[0][1]).toBeLessThan(0.2);
  });

  it('diagonal is 1.0', () => {
    const matrix = computeSimilarityMatrix([EVENT_A_SRC1, EVENT_B]);
    expect(matrix[0][0]).toBeCloseTo(1.0);
    expect(matrix[1][1]).toBeCloseTo(1.0);
  });

  it('matrix is symmetric', () => {
    const matrix = computeSimilarityMatrix([EVENT_A_SRC1, EVENT_A_SRC2, EVENT_B]);
    expect(matrix[0][1]).toBeCloseTo(matrix[1][0]);
    expect(matrix[0][2]).toBeCloseTo(matrix[2][0]);
  });

  it('handles empty items', () => {
    const matrix = computeSimilarityMatrix([]);
    expect(matrix).toEqual([]);
  });
});

describe('computePairwiseSimilarity', () => {
  it('returns high similarity for same-event Chinese articles', () => {
    const score = computePairwiseSimilarity(
      { title: '美联储宣布加息25个基点', content: '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。' },
      { title: '美联储如期加息25个基点', content: '美联储如期加息25个基点，联邦基金利率升至新区间。' },
    );
    expect(score).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('returns low similarity for unrelated articles', () => {
    const score = computePairwiseSimilarity(
      { title: '美联储加息', content: '美国联邦储备委员会宣布加息' },
      { title: '苹果发布MacBook', content: '苹果公司发布新款MacBook Pro' },
    );
    expect(score).toBeLessThan(0.2);
  });

  it('returns 0.0 for empty strings', () => {
    expect(computePairwiseSimilarity({ title: '', content: '' }, { title: '', content: '' })).toBe(0);
  });

  it('returns consistent scores across calls', () => {
    const a = { title: '美联储加息25个基点', content: '美联储宣布加息25个基点利率上调' };
    const b = { title: '美联储如期加息', content: '美联储如期加息联邦基金利率升至新区间' };
    const score1 = computePairwiseSimilarity(a, b);
    const score2 = computePairwiseSimilarity(a, b);
    expect(score1).toBeCloseTo(score2);
  });

  it('produces same score as computeSimilarityMatrix for 2 items', () => {
    const a = { title: '美联储加息', content: '利率上调25个基点' };
    const b = { title: '苹果发布新品', content: '苹果发布MacBook Pro' };
    const pairwise = computePairwiseSimilarity(a, b);
    const matrix = computeSimilarityMatrix([a, b]);
    expect(pairwise).toBeCloseTo(matrix[0][1]);
  });
});

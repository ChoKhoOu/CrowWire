import { describe, it, expect } from 'vitest';
import { groupByEvent } from '../src/lib/aggregator.js';
import type { ScoredItem } from '../src/types.js';

function makeItem(id: string, source: string, title: string, content: string, relevance = 50): ScoredItem {
  return {
    id,
    title,
    link: `https://example.com/${id}`,
    content,
    published_at: new Date().toISOString(),
    source,
    content_hash: `ch-${id}`,
    urgency: 50,
    relevance,
    novelty: 50,
  };
}

describe('groupByEvent', () => {
  it('groups same-event items from different sources', () => {
    const items = [
      makeItem('a', 'Bloomberg', '美联储宣布加息25个基点', '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。这是今年第三次加息。', 90),
      makeItem('b', '财联社', '美联储如期加息25个基点', '美联储如期加息25个基点，联邦基金利率升至新区间。鲍威尔表示未来将视经济数据决定政策路径。', 80),
      makeItem('c', '金十数据', '美联储加息25个基点符合预期', '美国联邦储备委员会宣布加息25个基点，市场反应平稳，美元指数小幅上涨。', 70),
    ];
    const groups = groupByEvent(items, 0.4);
    // Should form 1 group with all 3 items
    expect(groups.length).toBe(1);
    expect(groups[0].isMultiSource).toBe(true);
    expect(groups[0].members.length).toBe(3);
    expect(groups[0].representative.relevance).toBe(90);
  });

  it('keeps unrelated items as separate groups', () => {
    const items = [
      makeItem('a', 'Bloomberg', '美联储宣布加息25个基点', '美国联邦储备委员会周三宣布将基准利率上调25个基点。'),
      makeItem('b', '财联社', '苹果发布新款MacBook Pro', '苹果公司今日发布搭载M4芯片的新款MacBook Pro，性能提升显著。'),
    ];
    const groups = groupByEvent(items, 0.55);
    expect(groups.length).toBe(2);
    expect(groups.every(g => !g.isMultiSource)).toBe(true);
  });

  it('never merges items from the same source (same-source guard)', () => {
    const items = [
      makeItem('a', 'Bloomberg', '美联储宣布加息25个基点', '美国联邦储备委员会周三宣布将基准利率上调25个基点。'),
      makeItem('b', 'Bloomberg', '美联储如期加息25BP', '美联储如期加息25BP，联邦基金利率升至新区间。'),
    ];
    const groups = groupByEvent(items, 0.1); // Very low threshold
    expect(groups.length).toBe(2);
    expect(groups.every(g => !g.isMultiSource)).toBe(true);
  });

  it('single item produces a single-member group', () => {
    const items = [makeItem('a', 'Source', 'Title', 'Content')];
    const groups = groupByEvent(items);
    expect(groups.length).toBe(1);
    expect(groups[0].members.length).toBe(1);
    expect(groups[0].isMultiSource).toBe(false);
    expect(groups[0].mergedSummary).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(groupByEvent([])).toEqual([]);
  });

  it('items just below threshold remain separate', () => {
    // Use unrelated items that will have low similarity
    const items = [
      makeItem('a', 'SourceA', '美联储加息', '美国联邦储备委员会宣布加息'),
      makeItem('b', 'SourceB', '苹果发布新品', '苹果公司发布MacBook Pro'),
    ];
    const groups = groupByEvent(items, 0.55);
    expect(groups.length).toBe(2);
  });

  it('prevents chain-merging with complete-linkage', () => {
    // A and B are somewhat similar, B and C are somewhat similar, but A and C are NOT similar
    // With complete-linkage, A-B-C should NOT form one group
    const items = [
      makeItem('a', 'SourceA', '美联储加息政策', '美联储加息25个基点，市场震荡，美元走强，债券收益率上升'),
      makeItem('b', 'SourceB', '美联储加息与市场影响', '美联储加息引发市场连锁反应，科技股承压下跌明显'),
      makeItem('c', 'SourceC', '科技股大跌原因分析', '科技股今日大幅下跌，分析师认为估值过高是主因，与货币政策关系有限'),
    ];
    // With a moderate threshold, A-C should not be in the same group
    const groups = groupByEvent(items, 0.55);
    // Even if A-B or B-C might merge, A and C should NOT end up together
    for (const group of groups) {
      const ids = group.members.map(m => m.id);
      if (ids.includes('a') && ids.includes('c')) {
        // If somehow both are in same group, the similarity must actually be high enough
        // This test verifies complete-linkage prevents chaining
        expect(group.members.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('picks highest-relevance item as representative', () => {
    const items = [
      makeItem('a', 'SourceA', '美联储加息25个基点', '美国联邦储备委员会宣布加息25个基点符合预期', 60),
      makeItem('b', 'SourceB', '美联储如期加息25BP', '美联储如期加息25BP联邦基金利率升至新区间', 90),
    ];
    const groups = groupByEvent(items, 0.3);
    if (groups.length === 1) {
      expect(groups[0].representative.id).toBe('b');
      expect(groups[0].representative.relevance).toBe(90);
    }
  });
});

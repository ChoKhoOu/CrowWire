import type { ScoredItem, EventGroup } from '../types.js';

function relativeTime(published: string): string {
  const now = Date.now();
  const then = new Date(published).getTime();
  if (isNaN(then)) return '';
  const mins = Math.round((now - then) / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function urgencyTag(urgency: number): string {
  if (urgency >= 95) return '🔴 极高';
  if (urgency >= 85) return '🟠 高';
  if (urgency >= 70) return '🟡 中';
  return '🟢 低';
}

function formatTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function formatUrgent(items: ScoredItem[]): string {
  if (items.length === 0) return '';

  const lines: string[] = ['🚨 **紧急快讯**\n'];

  for (const item of items) {
    const time = relativeTime(item.published_at);
    lines.push(`> **${item.title}**`);
    lines.push(`> 来源：${item.source}${time ? ` · ${time}` : ''}`);
    lines.push(`> 紧急度：${urgencyTag(item.urgency)}（${item.urgency}/100）`);
    if (item.content) {
      const snippet = item.content.slice(0, 120).replace(/\n/g, ' ');
      lines.push(`> ${snippet}${item.content.length > 120 ? '…' : ''}`);
    }
    lines.push(`> 🔗 ${item.link}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

const HIGH_RELEVANCE = 70;

/**
 * Format flat items by wrapping each into a single-member EventGroup
 * and delegating to formatDigestGrouped.
 */
export function formatDigest(items: ScoredItem[]): string {
  if (items.length === 0) return '';

  const groups: EventGroup[] = items.map(item => ({
    representative: item,
    members: [item],
    isMultiSource: false,
  }));

  return formatDigestGrouped(groups);
}

export function formatDigestGrouped(groups: EventGroup[]): string {
  if (groups.length === 0) return '';

  const allItems = groups.flatMap(g => g.members);
  const sorted = [...groups].sort((a, b) => b.representative.relevance - a.representative.relevance);
  const highGroups = sorted.filter(g => g.representative.relevance >= HIGH_RELEVANCE);
  const lowGroups = sorted.filter(g => g.representative.relevance < HIGH_RELEVANCE);

  const timeStr = formatTimestamp();

  const lines: string[] = [
    `📰 **新闻摘要** — ${timeStr}`,
    `共 ${allItems.length} 条资讯`,
    '',
  ];

  // --- High relevance ---
  if (highGroups.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔥 今日要闻');
    lines.push('');

    const bullets: string[] = [];
    for (const group of highGroups) {
      if (group.isMultiSource && group.members.length > 1) {
        const summary = group.mergedSummary
          ?? group.members.map(m => `- ${m.title}（${m.source}）`).join('\n');
        const sources = group.members.map(m => m.source).join('、');
        bullets.push(`**${group.representative.title}**——${summary}（综合 ${sources} 报道）`);
      } else {
        const item = group.representative;
        const snippet = item.content
          ? item.content.slice(0, 100).replace(/\n/g, ' ')
          : '';
        const trail = (item.content?.length ?? 0) > 100 ? '…' : '';
        bullets.push(snippet
          ? `**${item.title}**——${snippet}${trail}（${item.source}）`
          : `**${item.title}**（${item.source}）`);
      }
    }

    lines.push(bullets.join('；'));
    lines.push('');

    lines.push('**相关链接：**');
    for (const group of highGroups) {
      for (const m of group.members) {
        lines.push(`- [${m.title}](${m.link})`);
      }
    }
    lines.push('');
  }

  // --- Low relevance ---
  if (lowGroups.length > 0) {
    lines.push('---');
    lines.push('');
    const lowItemCount = lowGroups.reduce((sum, g) => sum + g.members.length, 0);
    lines.push(`## 📋 其他资讯（${lowItemCount}条）`);
    lines.push('');

    for (const group of lowGroups) {
      if (group.isMultiSource && group.members.length > 1) {
        const summary = group.mergedSummary
          ?? group.members.map(m => `- ${m.title}（${m.source}）`).join('\n');
        lines.push(`**${group.representative.title}**`);
        lines.push(summary);
        for (const m of group.members) {
          lines.push(`${m.source} · [原文](${m.link})`);
        }
      } else {
        const item = group.representative;
        const time = relativeTime(item.published_at);
        const snippet = item.content
          ? item.content.slice(0, 80).replace(/\n/g, ' ')
          : '';
        const trail = (item.content?.length ?? 0) > 80 ? '…' : '';
        lines.push(`**${item.title}**`);
        if (snippet) {
          lines.push(`${snippet}${trail}`);
        }
        lines.push(`${item.source}${time ? ` · ${time}` : ''} · [原文](${item.link})`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`_由 CrowWire 自动生成 · ${timeStr}_`);

  return lines.join('\n').trim();
}

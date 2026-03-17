import type { ScoredItem, EventGroup } from '../types.js';

const DISCORD_MAX_CHARS = 1900;

/**
 * Split a Markdown message into Discord-safe chunks (≤ maxLen chars each),
 * splitting at paragraph boundaries (\n\n) to preserve readability.
 */
export function splitMarkdownMessages(text: string, maxLen: number = DISCORD_MAX_CHARS): string[] {
  if (!text || text.length <= maxLen) return text ? [text] : [];

  const blocks = text.split('\n\n');
  const packed: string[] = [];
  let current = '';

  for (const block of blocks) {
    const combined = current ? `${current}\n\n${block}` : block;

    if (combined.length > maxLen && current) {
      packed.push(current.trim());
      current = block;
    } else {
      current = combined;
    }
  }

  if (current.trim()) packed.push(current.trim());

  // If any single chunk still exceeds limit, split by single newlines
  const result: string[] = [];
  for (const msg of packed) {
    if (msg.length <= maxLen) {
      result.push(msg);
      continue;
    }
    const lines = msg.split('\n');
    let chunk = '';
    for (const line of lines) {
      const combined = chunk ? `${chunk}\n${line}` : line;
      if (combined.length > maxLen && chunk) {
        result.push(chunk.trim());
        chunk = line;
      } else {
        chunk = combined;
      }
    }
    if (chunk.trim()) result.push(chunk.trim());
  }

  return result;
}

/**
 * Strip leading 【title】 prefix from content that Chinese RSS sources often add.
 * Also strips the title if content starts with it directly.
 */
function stripTitlePrefix(title: string, content: string): string {
  let c = content.trim();
  const bracketPrefix = `【${title}】`;
  if (c.startsWith(bracketPrefix)) {
    c = c.slice(bracketPrefix.length).trim();
  }
  if (c.startsWith(title)) {
    c = c.slice(title.length).trim();
    c = c.replace(/^[，。、；：\s]+/, '');
  }
  return c;
}

/**
 * Get the display snippet: prefer LLM summary, fall back to cleaned content.
 * If cleaned content is empty, use the title as last resort.
 */
function getSnippet(item: ScoredItem, maxLen: number): string {
  if (item.summary) return item.summary;
  const cleaned = stripTitlePrefix(item.title, item.content);
  if (cleaned) {
    const snippet = cleaned.slice(0, maxLen).replace(/\n/g, ' ');
    return snippet + (cleaned.length > maxLen ? '…' : '');
  }
  return item.title;
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

// ── Urgent ──────────────────────────────────────────────────

export function formatUrgent(items: ScoredItem[]): string {
  if (items.length === 0) return '';

  const lines: string[] = [`🚨 **紧急快讯** ${urgencyTag(items[0].urgency)}`, ''];

  for (const item of items) {
    const snippet = getSnippet(item, 300);
    lines.push(`- ${snippet} <${item.link}>`);
  }

  return lines.join('\n').trim();
}

// ── Digest ──────────────────────────────────────────────────

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

/**
 * Format a single group as one line: `- summary _(来源)_ <link>`
 */
function formatGroupLine(group: EventGroup, snippetLen: number): string {
  if (group.isMultiSource && group.members.length > 1) {
    const summary = group.mergedSummary
      ?? group.members.map(m => getSnippet(m, 40)).join('；');
    const sources = group.members.map(m => m.source).join('、');
    const links = group.members.map(m => `<${m.link}>`).join(' ');
    return `- ${summary} _(${sources})_ ${links}`;
  }

  const item = group.representative;
  const snippet = getSnippet(item, snippetLen);
  return `- ${snippet} _(${item.source})_ <${item.link}>`;
}

export function formatDigestGrouped(groups: EventGroup[]): string {
  if (groups.length === 0) return '';

  const allItems = groups.flatMap(g => g.members);
  const sorted = [...groups].sort((a, b) => b.representative.relevance - a.representative.relevance);
  const highGroups = sorted.filter(g => g.representative.relevance >= HIGH_RELEVANCE);
  const lowGroups = sorted.filter(g => g.representative.relevance < HIGH_RELEVANCE);

  const timeStr = formatTimestamp();
  const lines: string[] = [`📰 **新闻摘要** — ${timeStr} | 共 ${allItems.length} 条`];

  if (highGroups.length > 0) {
    lines.push('');
    lines.push('**🔥 重点关注**');
    for (let i = 0; i < highGroups.length; i++) {
      lines.push(formatGroupLine(highGroups[i], 300));
      if (i < highGroups.length - 1) lines.push('');
    }
  }

  if (lowGroups.length > 0) {
    const lowCount = lowGroups.reduce((s, g) => s + g.members.length, 0);
    lines.push('');
    lines.push(`**📋 其他资讯（${lowCount}条）**`);
    for (const group of lowGroups) {
      lines.push(formatGroupLine(group, 60));
    }
  }

  lines.push('');
  lines.push(`_CrowWire · ${timeStr}_`);

  return lines.join('\n').trim();
}

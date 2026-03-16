import { computeSimilarityMatrix, DEFAULT_SIMILARITY_THRESHOLD } from './similarity.js';
import type { ScoredItem, EventGroup } from '../types.js';

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(parent: number[], i: number, j: number): void {
  const ri = find(parent, i);
  const rj = find(parent, j);
  if (ri !== rj) {
    parent[rj] = ri;
  }
}

function getComponents(parent: number[], size: number): Map<number, number[]> {
  const components = new Map<number, number[]>();
  for (let i = 0; i < size; i++) {
    const root = find(parent, i);
    const group = components.get(root);
    if (group) {
      group.push(i);
    } else {
      components.set(root, [i]);
    }
  }
  return components;
}

export function groupByEvent(
  items: ScoredItem[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): EventGroup[] {
  if (items.length === 0) return [];

  const similarityMatrix = computeSimilarityMatrix(
    items.map((i) => ({ title: i.title, content: i.content })),
  );

  const parent: number[] = items.map((_, idx) => idx);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      // Same-source guard: never merge items from the same source
      if (items[i].source === items[j].source) continue;

      if (similarityMatrix[i][j] >= threshold) {
        // Complete-linkage check: all cross-component pairs must exceed threshold
        const rootI = find(parent, i);
        const rootJ = find(parent, j);
        if (rootI === rootJ) continue; // already in same component

        const componentI: number[] = [];
        const componentJ: number[] = [];
        for (let k = 0; k < items.length; k++) {
          const root = find(parent, k);
          if (root === rootI) componentI.push(k);
          else if (root === rootJ) componentJ.push(k);
        }

        let canMerge = true;
        for (const m of componentI) {
          for (const n of componentJ) {
            if (similarityMatrix[m][n] < threshold) {
              canMerge = false;
              break;
            }
          }
          if (!canMerge) break;
        }

        if (canMerge) {
          union(parent, i, j);
        }
      }
    }
  }

  const components = getComponents(parent, items.length);
  const groups: EventGroup[] = [];

  for (const indices of components.values()) {
    const members = indices.map((idx) => items[idx]);
    const representative = members.reduce((best, item) =>
      item.relevance > best.relevance ? item : best,
    );
    const sources = new Set(members.map((m) => m.source));

    groups.push({
      members,
      representative,
      isMultiSource: sources.size >= 2,
      mergedSummary: undefined,
    });
  }

  return groups;
}

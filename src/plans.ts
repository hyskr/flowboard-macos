import type { Card } from './types';

const prefix = '计划：';
export const isPlanTag = (tag: string) => tag.startsWith(prefix) && !!tag.slice(prefix.length).trim();
export const planName = (tags: string[]) => tags.find(isPlanTag)?.slice(prefix.length).trim() ?? '';
export function withPlan(tags: string[], name: string) {
  const ordinary = tags.filter(tag => !isPlanTag(tag));
  return name.trim() ? [...ordinary, prefix + name.trim()] : ordinary;
}

export interface Plan {
  name: string;
  members: Card[];
  completed: number;
  current?: Card;
}

export function collectPlans(cards: Card[], doingId?: string): Plan[] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const name = planName(card.tags);
    if (!name) continue;
    const group = groups.get(name);
    if (group) group.push(card);
    else groups.set(name, [card]);
  }
  return Array.from(groups, ([name, members]) => {
    members.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.order - b.order || a.createdAt - b.createdAt);
    const pending = members.filter(card => !card.completedAt);
    const current = pending.find(card => card.columnId === doingId) ?? pending[0];
    return { name, members, current, completed: members.length - pending.length };
  });
}

// Each move uses the target index after removing the moving card, as card.move does.
export function planMemberMoves(cards: Card[], plan: Plan, columnId: string | null, beforeId?: string) {
  const target = cards.filter(card => card.columnId === columnId).sort((a, b) => a.order - b.order).map(card => card.id);
  const moves: { id: string; columnId: string | null; targetIndex: number }[] = [];
  let anchor = beforeId;
  for (const card of [...plan.members].reverse()) {
    const from = target.indexOf(card.id);
    if (from >= 0) target.splice(from, 1);
    const next = anchor ? target.indexOf(anchor) : -1;
    const index = next < 0 ? target.length : next;
    if (from !== index) moves.push({ id: card.id, columnId, targetIndex: index });
    target.splice(index, 0, card.id);
    anchor = card.id;
  }
  return moves;
}

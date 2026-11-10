import type { PlayerCard, Position } from '@shared/types';
import { TEAM_BY_ID } from '@shared/teams';

export interface Slot { id: string; pos: Position; x: number; y: number; links: string[]; }
/** 4-3-3 slots on a portrait pitch (x,y in %), with chemistry links between neighbours. */
export const SLOTS_433: Slot[] = [
  { id: 'GK', pos: 'GK', x: 50, y: 90, links: ['CB1', 'CB2'] },
  { id: 'RB', pos: 'RB', x: 85, y: 72, links: ['CB1', 'RW', 'CM1'] },
  { id: 'CB1', pos: 'CB', x: 63, y: 76, links: ['GK', 'RB', 'CB2', 'CDM'] },
  { id: 'CB2', pos: 'CB', x: 37, y: 76, links: ['GK', 'LB', 'CB1', 'CDM'] },
  { id: 'LB', pos: 'LB', x: 15, y: 72, links: ['CB2', 'LW', 'CM2'] },
  { id: 'CDM', pos: 'CDM', x: 50, y: 56, links: ['CB1', 'CB2', 'CM1', 'CM2'] },
  { id: 'CM1', pos: 'CM', x: 72, y: 46, links: ['CDM', 'RB', 'RW', 'ST'] },
  { id: 'CM2', pos: 'CAM', x: 28, y: 46, links: ['CDM', 'LB', 'LW', 'ST'] },
  { id: 'RW', pos: 'RW', x: 80, y: 22, links: ['CM1', 'ST', 'RB'] },
  { id: 'ST', pos: 'ST', x: 50, y: 14, links: ['RW', 'LW', 'CM1', 'CM2'] },
  { id: 'LW', pos: 'LW', x: 20, y: 22, links: ['CM2', 'ST', 'LB'] },
];
const RELATED: Record<Position, Position[]> = {
  GK: [], CB: ['CDM', 'RB', 'LB'], LB: ['LW', 'CB', 'LM'], RB: ['RW', 'CB', 'RM'], CDM: ['CM', 'CB'], CM: ['CDM', 'CAM'], CAM: ['CM', 'ST', 'LW', 'RW'],
  LM: ['LW', 'LB', 'CM'], RM: ['RW', 'RB', 'CM'], LW: ['LM', 'ST', 'CAM'], RW: ['RM', 'ST', 'CAM'], ST: ['LW', 'RW', 'CAM'],
};

export function positionFit(slot: Position, card: Position): number { return slot === card ? 1.5 : RELATED[slot].includes(card) ? 0.75 : 0; }

/** Per-slot chemistry (0..3) and team chemistry (0..100) plus average rating. */
export function chemistry(squad: Record<string, string | null>, cards: Map<string, PlayerCard>): { slots: Record<string, number>; team: number; rating: number } {
  const slots: Record<string, number> = {}; let total = 0; let ratingSum = 0; let n = 0;
  for (const s of SLOTS_433) {
    const id = squad[s.id]; const c = id ? cards.get(id) : undefined;
    if (!c) { slots[s.id] = 0; continue; }
    let v = positionFit(s.pos, c.position);
    for (const l of s.links) {
      const o = squad[l] ? cards.get(squad[l]!) : undefined; if (!o) continue;
      if (o.teamId === c.teamId) v += 0.6; else if (TEAM_BY_ID[o.teamId]?.league === TEAM_BY_ID[c.teamId]?.league) v += 0.3;
      if (o.nationality === c.nationality) v += 0.45;
    }
    v = Math.min(3, v); slots[s.id] = v; total += v; ratingSum += c.rating; n++;
  }
  return { slots, team: Math.round((total / 33) * 100), rating: n ? Math.round(ratingSum / n) : 0 };
}

/** Shared API contracts between the outcome server and the game client. */

export type GameMode = 'kickoff' | 'futsal' | 'fut' | 'freekick';
export type MatchTier = 'loss' | 'draw' | 'win' | 'otwin';
export type FreeKickTier = 'loss' | 'win';
export type Side = 'home' | 'away'; // home is always the human player's team

export interface PaytableEntry { tier: string; label: string; multiplier: number; probability: number; }
export interface ModePaytable { mode: GameMode; rtp: number; entries: PaytableEntry[]; }

export interface ServerConfigPublic {
  modes: Record<GameMode, ModePaytable>;
  minStake: number;
  maxStake: number;
  stakes: number[];
  packs: Record<PackType, { price: number; label: string }>;
}

export interface GoalEvent {
  /** Fraction of regulation time (0..1) at which the goal should happen. */
  t: number;
  side: Side;
  /** Flavour hint for the director: how the goal should look. */
  style: 'open' | 'counter' | 'longshot' | 'header' | 'scramble';
}

export interface MatchScript {
  kind: 'match';
  mode: 'kickoff' | 'futsal' | 'fut';
  tier: MatchTier;
  multiplier: number;
  finalScore: { home: number; away: number };
  events: GoalEvent[];
  /** Regulation length in real seconds (the match clock is scaled to 90'). */
  durationSec: number;
  /** Baseline opponent strength 0..1 used when no goal is being forced. */
  botStrength: number;
  /** Futsal only: regulation ends level and a sudden-death overtime (3v3, then 2v2, then 1v1) is decided by this side,
   *  `at` seconds into overtime. The golden goal is included in `finalScore` but not in `events`. */
  overtime?: { side: Side; at: number };
}

export type ShotStyle = 'curl' | 'power' | 'chip' | 'driven';
export type MissStyle = 'post' | 'bar' | 'over' | 'wide' | 'saved' | 'wall';

export interface FreeKickRoundPlan {
  /** What the bot does if the player SCORED this round. */
  ifPlayerScores: 'score' | 'miss';
  /** What the bot does if the player MISSED this round. */
  ifPlayerMisses: 'score' | 'miss';
  botShot: ShotStyle;
  botMiss: MissStyle;
  /** Whether the opposing keeper is guaranteed to stop the player's shot this round. */
  keeperWall: boolean;
  /** Whether the player's shot gets steered into the goal this round. */
  goalMagnet: boolean;
}

export interface FreeKickScript {
  kind: 'freekick';
  mode: 'freekick';
  tier: FreeKickTier;
  multiplier: number;
  /** Which free-kick situation to set up (distance, angle, wall size). */
  situation: { distance: number; angleDeg: number; wallSize: number; keeperBias: number };
  /** Per-round reactive plan. The round that would exceed this list ends the duel decisively. */
  rounds: FreeKickRoundPlan[];
}

export type RoundScript = MatchScript | FreeKickScript;

export interface StartRoundRequest {
  playerId: string;
  mode: GameMode;
  stake: number;
  clientSeed: string;
  homeTeamId?: string;
  awayTeamId?: string;
}

export interface StartRoundResponse {
  roundId: string;
  nonce: number;
  serverSeedHash: string;
  script: RoundScript;
  wallet: Wallet;
}

export interface SettleRoundRequest { playerId: string; roundId: string; }
export interface SettleRoundResponse {
  roundId: string;
  payout: number;
  multiplier: number;
  tier: string;
  wallet: Wallet;
  /** Revealed so the round can be verified: HMAC(serverSeed, `${clientSeed}:${nonce}`). */
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  nextServerSeedHash: string;
}

export interface Wallet { playerId: string; balance: number; currency: string; }

export type PackType = 'bronze' | 'silver' | 'gold' | 'elite';
export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';

export interface PlayerAttributes {
  pace: number; shooting: number; passing: number; dribbling: number; defending: number; physical: number;
  diving: number; reflexes: number;
  /** How long he keeps going: how fast his energy runs down in a match (older saved cards may not have it). */
  stamina?: number;
}

export interface PlayerCard {
  id: string;
  name: string;
  shortName: string;
  nationality: string;
  teamId: string;
  position: Position;
  rating: number;
  number: number;
  age: number;
  /** Visual genes for the procedural 3D model. */
  look: { skin: number; hair: number; hairColor: number; height: number; build: number };
  attrs: PlayerAttributes;
  rarity: 'bronze' | 'silver' | 'gold' | 'elite';
}

export interface FutClub {
  playerId: string;
  /** Owned cards (card ids reference the global player pool). */
  cards: string[];
  /** Formation slot id -> card id. */
  squad: Record<string, string | null>;
  formation: string;
  clubName: string;
}

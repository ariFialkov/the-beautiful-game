/** Playing surfaces and weather. These change how the ball bounces, rolls and grips, and how well players can turn and stop. */
export type SurfaceId = 'dry' | 'wet' | 'snow' | 'firm' | 'court';
export type Weather = 'clear' | 'rain' | 'snow' | 'indoor';

export interface Surface {
  id: SurfaceId;
  label: string;
  weather: Weather;
  /** Coefficient of restitution for a ball landing on the surface. */
  bounce: number;
  /** Sliding friction between ball and surface (how quickly skid turns into roll; how much spin bites). */
  mu: number;
  /** Rolling resistance: constant part (fraction of g) and speed-proportional part (1/s). */
  rollC: number;
  rollV: number;
  /** Player footing: scales acceleration, braking and cornering. */
  grip: number;
  /** How far slide tackles travel (higher = further). */
  slide: number;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  dry: { id: 'dry', label: 'Dry pitch', weather: 'clear', bounce: 0.62, mu: 0.45, rollC: 0.04, rollV: 0.05, grip: 1, slide: 1 },
  firm: { id: 'firm', label: 'Firm, hot day', weather: 'clear', bounce: 0.72, mu: 0.5, rollC: 0.032, rollV: 0.04, grip: 1, slide: 0.9 },
  wet: { id: 'wet', label: 'Rain, slick pitch', weather: 'rain', bounce: 0.5, mu: 0.2, rollC: 0.028, rollV: 0.035, grip: 0.86, slide: 1.4 },
  snow: { id: 'snow', label: 'Snow', weather: 'snow', bounce: 0.33, mu: 0.4, rollC: 0.11, rollV: 0.16, grip: 0.78, slide: 1.2 },
  court: { id: 'court', label: 'Indoor court', weather: 'indoor', bounce: 0.5, mu: 0.55, rollC: 0.02, rollV: 0.03, grip: 1.05, slide: 0.7 },
};

export const OUTDOOR_SURFACES: SurfaceId[] = ['dry', 'firm', 'wet', 'snow'];

/** Random outdoor conditions, weighted toward a normal dry day. */
export function randomSurface(rand = Math.random): SurfaceId {
  const r = rand();
  return r < 0.5 ? 'dry' : r < 0.68 ? 'firm' : r < 0.9 ? 'wet' : 'snow';
}

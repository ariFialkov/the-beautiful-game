import { Rng } from './rng';
import { NAMES, FOREIGN_POOL } from './names';
import type { PlayerCard, Position, PlayerAttributes } from './types';

export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'pinstripe' | 'chevron';
export type PlayStyle = 'possession' | 'counter' | 'pressing' | 'direct';
export type CrestShape = 'shield' | 'circle' | 'hex' | 'diamond';

export interface Kit { primary: string; secondary: string; shorts: string; socks: string; pattern: KitPattern; }
export interface Team {
  id: string;
  name: string;
  short: string;
  city: string;
  country: string;
  league: string;
  rating: number;
  style: PlayStyle;
  home: Kit;
  away: Kit;
  crest: { shape: CrestShape; icon: 'lion' | 'star' | 'ball' | 'crown' | 'wave' | 'tower' | 'eagle' | 'sun' | 'anchor' | 'bolt'; colors: [string, string, string] };
  stadium: { name: string; capacity: number; seats: string; roof: boolean };
  /** Average name nationality mix for roster generation. */
  foreignShare: number;
}

const T = (t: Team): Team => t;

export const TEAMS: Team[] = [
  // England - Premier Division
  T({ id: 'lon-royals', name: 'London Royals', short: 'LDN', city: 'London', country: 'England', league: 'Premier Division', rating: 86, style: 'possession',
    home: { primary: '#1d3fb3', secondary: '#ffffff', shorts: '#ffffff', socks: '#1d3fb3', pattern: 'solid' }, away: { primary: '#f2f4f7', secondary: '#1d3fb3', shorts: '#1d3fb3', socks: '#f2f4f7', pattern: 'pinstripe' },
    crest: { shape: 'shield', icon: 'crown', colors: ['#1d3fb3', '#ffffff', '#f7c948'] }, stadium: { name: 'Bridge Park', capacity: 62000, seats: '#1d3fb3', roof: true }, foreignShare: 0.55 }),
  T({ id: 'man-reds', name: 'Manchester Reds', short: 'MCR', city: 'Manchester', country: 'England', league: 'Premier Division', rating: 85, style: 'counter',
    home: { primary: '#d2202b', secondary: '#111111', shorts: '#ffffff', socks: '#111111', pattern: 'solid' }, away: { primary: '#101418', secondary: '#d2202b', shorts: '#101418', socks: '#101418', pattern: 'chevron' },
    crest: { shape: 'shield', icon: 'lion', colors: ['#d2202b', '#f7c948', '#111111'] }, stadium: { name: 'Northfield', capacity: 74000, seats: '#d2202b', roof: true }, foreignShare: 0.5 }),
  T({ id: 'mersey-blues', name: 'Merseyside Mariners', short: 'MER', city: 'Liverpool', country: 'England', league: 'Premier Division', rating: 84, style: 'pressing',
    home: { primary: '#0f6fc5', secondary: '#ffffff', shorts: '#ffffff', socks: '#0f6fc5', pattern: 'pinstripe' }, away: { primary: '#f7c948', secondary: '#0f6fc5', shorts: '#0f6fc5', socks: '#f7c948', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'anchor', colors: ['#0f6fc5', '#ffffff', '#f7c948'] }, stadium: { name: 'Dockside Arena', capacity: 54000, seats: '#0f6fc5', roof: true }, foreignShare: 0.5 }),
  T({ id: 'tyne-magpies', name: 'Tyneside United', short: 'TYN', city: 'Newcastle', country: 'England', league: 'Premier Division', rating: 80, style: 'direct',
    home: { primary: '#111111', secondary: '#ffffff', shorts: '#111111', socks: '#111111', pattern: 'stripes' }, away: { primary: '#2ec4b6', secondary: '#111111', shorts: '#111111', socks: '#2ec4b6', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'tower', colors: ['#111111', '#ffffff', '#2ec4b6'] }, stadium: { name: 'St. Giles Park', capacity: 52000, seats: '#111111', roof: false }, foreignShare: 0.45 }),
  // Spain - La Primera
  T({ id: 'mad-blancos', name: 'Madrid Blancos', short: 'MAD', city: 'Madrid', country: 'Spain', league: 'La Primera', rating: 88, style: 'counter',
    home: { primary: '#ffffff', secondary: '#1c1c1c', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' }, away: { primary: '#2a1a4a', secondary: '#c9a227', shorts: '#2a1a4a', socks: '#2a1a4a', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'crown', colors: ['#ffffff', '#1c1c1c', '#c9a227'] }, stadium: { name: 'Estadio Castellana', capacity: 81000, seats: '#ffffff', roof: true }, foreignShare: 0.5 }),
  T({ id: 'bcn-azulgrana', name: 'Barcelona Azulgrana', short: 'BCN', city: 'Barcelona', country: 'Spain', league: 'La Primera', rating: 86, style: 'possession',
    home: { primary: '#a50044', secondary: '#004d98', shorts: '#004d98', socks: '#004d98', pattern: 'stripes' }, away: { primary: '#f5e663', secondary: '#a50044', shorts: '#f5e663', socks: '#f5e663', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'star', colors: ['#a50044', '#004d98', '#f7c948'] }, stadium: { name: 'Camp de Mar', capacity: 99000, seats: '#a50044', roof: false }, foreignShare: 0.4 }),
  T({ id: 'sev-rojiblancos', name: 'Sevilla Rojiblancos', short: 'SEV', city: 'Seville', country: 'Spain', league: 'La Primera', rating: 78, style: 'pressing',
    home: { primary: '#ffffff', secondary: '#d2202b', shorts: '#111111', socks: '#111111', pattern: 'sash' }, away: { primary: '#1c1c1c', secondary: '#d2202b', shorts: '#1c1c1c', socks: '#1c1c1c', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'sun', colors: ['#d2202b', '#ffffff', '#f7c948'] }, stadium: { name: 'La Giralda Arena', capacity: 43000, seats: '#d2202b', roof: false }, foreignShare: 0.35 }),
  // Italy - Serie Nazionale
  T({ id: 'mil-rossoneri', name: 'Milano Rossoneri', short: 'MIL', city: 'Milan', country: 'Italy', league: 'Serie Nazionale', rating: 84, style: 'counter',
    home: { primary: '#d2202b', secondary: '#111111', shorts: '#ffffff', socks: '#111111', pattern: 'stripes' }, away: { primary: '#ffffff', secondary: '#d2202b', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'hex', icon: 'bolt', colors: ['#d2202b', '#111111', '#ffffff'] }, stadium: { name: 'Stadio Meridiana', capacity: 75000, seats: '#d2202b', roof: true }, foreignShare: 0.6 }),
  T({ id: 'tor-bianconeri', name: 'Torino Bianconeri', short: 'TOR', city: 'Turin', country: 'Italy', league: 'Serie Nazionale', rating: 83, style: 'possession',
    home: { primary: '#ffffff', secondary: '#111111', shorts: '#ffffff', socks: '#111111', pattern: 'stripes' }, away: { primary: '#3d2c8d', secondary: '#f7c948', shorts: '#3d2c8d', socks: '#3d2c8d', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'star', colors: ['#111111', '#ffffff', '#f7c948'] }, stadium: { name: 'Stadio Alpino', capacity: 41000, seats: '#111111', roof: true }, foreignShare: 0.55 }),
  T({ id: 'nap-azzurri', name: 'Napoli Azzurri', short: 'NAP', city: 'Naples', country: 'Italy', league: 'Serie Nazionale', rating: 82, style: 'pressing',
    home: { primary: '#1e9ad7', secondary: '#ffffff', shorts: '#ffffff', socks: '#1e9ad7', pattern: 'solid' }, away: { primary: '#f4f4f4', secondary: '#1e9ad7', shorts: '#1e9ad7', socks: '#f4f4f4', pattern: 'halves' },
    crest: { shape: 'circle', icon: 'wave', colors: ['#1e9ad7', '#ffffff', '#0b3d91'] }, stadium: { name: 'Stadio Vesuvio', capacity: 55000, seats: '#1e9ad7', roof: false }, foreignShare: 0.5 }),
  // Germany - Bundesklasse
  T({ id: 'muc-bavarians', name: 'München Bavarians', short: 'MUC', city: 'Munich', country: 'Germany', league: 'Bundesklasse', rating: 87, style: 'pressing',
    home: { primary: '#dc052d', secondary: '#ffffff', shorts: '#dc052d', socks: '#dc052d', pattern: 'pinstripe' }, away: { primary: '#0f1f3d', secondary: '#dc052d', shorts: '#0f1f3d', socks: '#0f1f3d', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'star', colors: ['#dc052d', '#ffffff', '#0066b2'] }, stadium: { name: 'Isar Arena', capacity: 75000, seats: '#dc052d', roof: true }, foreignShare: 0.45 }),
  T({ id: 'dor-gelbschwarz', name: 'Dortmund Gelbschwarz', short: 'DOR', city: 'Dortmund', country: 'Germany', league: 'Bundesklasse', rating: 82, style: 'counter',
    home: { primary: '#fde100', secondary: '#111111', shorts: '#111111', socks: '#fde100', pattern: 'solid' }, away: { primary: '#111111', secondary: '#fde100', shorts: '#111111', socks: '#111111', pattern: 'chevron' },
    crest: { shape: 'circle', icon: 'ball', colors: ['#fde100', '#111111', '#ffffff'] }, stadium: { name: 'Westwall Park', capacity: 81000, seats: '#fde100', roof: true }, foreignShare: 0.5 }),
  T({ id: 'ham-hanseaten', name: 'Hamburg Hanseaten', short: 'HAM', city: 'Hamburg', country: 'Germany', league: 'Bundesklasse', rating: 76, style: 'direct',
    home: { primary: '#ffffff', secondary: '#0a3d91', shorts: '#d2202b', socks: '#0a3d91', pattern: 'halves' }, away: { primary: '#0a3d91', secondary: '#ffffff', shorts: '#0a3d91', socks: '#0a3d91', pattern: 'solid' },
    crest: { shape: 'diamond', icon: 'anchor', colors: ['#0a3d91', '#ffffff', '#d2202b'] }, stadium: { name: 'Elbe Stadion', capacity: 57000, seats: '#0a3d91', roof: true }, foreignShare: 0.45 }),
  // France - Ligue Nationale
  T({ id: 'par-capitals', name: 'Paris Capitals', short: 'PAR', city: 'Paris', country: 'France', league: 'Ligue Nationale', rating: 85, style: 'possession',
    home: { primary: '#0a2a66', secondary: '#d2202b', shorts: '#0a2a66', socks: '#0a2a66', pattern: 'sash' }, away: { primary: '#f4f4f4', secondary: '#0a2a66', shorts: '#f4f4f4', socks: '#f4f4f4', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'tower', colors: ['#0a2a66', '#d2202b', '#ffffff'] }, stadium: { name: 'Parc des Lumières', capacity: 48000, seats: '#0a2a66', roof: true }, foreignShare: 0.6 }),
  T({ id: 'mar-phoceens', name: 'Marseille Phocéens', short: 'MAR', city: 'Marseille', country: 'France', league: 'Ligue Nationale', rating: 79, style: 'pressing',
    home: { primary: '#ffffff', secondary: '#2faee0', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' }, away: { primary: '#2faee0', secondary: '#ffffff', shorts: '#2faee0', socks: '#2faee0', pattern: 'hoops' },
    crest: { shape: 'circle', icon: 'wave', colors: ['#2faee0', '#ffffff', '#f7c948'] }, stadium: { name: 'Stade du Port', capacity: 67000, seats: '#2faee0', roof: false }, foreignShare: 0.55 }),
  // Netherlands - Eredivisie Noord
  T({ id: 'ams-lancers', name: 'Amsterdam Lancers', short: 'AMS', city: 'Amsterdam', country: 'Netherlands', league: 'Eredivisie Noord', rating: 80, style: 'possession',
    home: { primary: '#ffffff', secondary: '#d2202b', shorts: '#ffffff', socks: '#ffffff', pattern: 'stripes' }, away: { primary: '#101418', secondary: '#f7c948', shorts: '#101418', socks: '#101418', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'star', colors: ['#d2202b', '#ffffff', '#111111'] }, stadium: { name: 'Lancer Dome', capacity: 55000, seats: '#d2202b', roof: true }, foreignShare: 0.45 }),
  // Portugal - Liga Atlântica
  T({ id: 'lis-aguias', name: 'Lisboa Águias', short: 'LIS', city: 'Lisbon', country: 'Portugal', league: 'Liga Atlântica', rating: 80, style: 'counter',
    home: { primary: '#d2202b', secondary: '#ffffff', shorts: '#ffffff', socks: '#d2202b', pattern: 'solid' }, away: { primary: '#111111', secondary: '#d2202b', shorts: '#111111', socks: '#111111', pattern: 'pinstripe' },
    crest: { shape: 'shield', icon: 'eagle', colors: ['#d2202b', '#ffffff', '#f7c948'] }, stadium: { name: 'Estádio da Águia', capacity: 65000, seats: '#d2202b', roof: true }, foreignShare: 0.6 }),
  // USA - Major League
  T({ id: 'lax-stars', name: 'Los Angeles Stars', short: 'LAX', city: 'Los Angeles', country: 'USA', league: 'Major League', rating: 75, style: 'direct',
    home: { primary: '#111111', secondary: '#c9a227', shorts: '#111111', socks: '#111111', pattern: 'solid' }, away: { primary: '#ffffff', secondary: '#c9a227', shorts: '#ffffff', socks: '#ffffff', pattern: 'sash' },
    crest: { shape: 'hex', icon: 'star', colors: ['#111111', '#c9a227', '#ffffff'] }, stadium: { name: 'Sunset Field', capacity: 22000, seats: '#111111', roof: false }, foreignShare: 0.55 }),
  T({ id: 'nyc-skyline', name: 'New York Skyline', short: 'NYC', city: 'New York', country: 'USA', league: 'Major League', rating: 74, style: 'possession',
    home: { primary: '#6cace4', secondary: '#0a2a66', shorts: '#0a2a66', socks: '#6cace4', pattern: 'solid' }, away: { primary: '#0a2a66', secondary: '#ff7a00', shorts: '#0a2a66', socks: '#0a2a66', pattern: 'hoops' },
    crest: { shape: 'circle', icon: 'tower', colors: ['#6cace4', '#0a2a66', '#ff7a00'] }, stadium: { name: 'Harbor Stadium', capacity: 30000, seats: '#6cace4', roof: false }, foreignShare: 0.55 }),
  // Brazil - Brasileirão Ouro
  T({ id: 'rio-tricolor', name: 'Rio Tricolor', short: 'RIO', city: 'Rio de Janeiro', country: 'Brazil', league: 'Brasileirão Ouro', rating: 79, style: 'possession',
    home: { primary: '#d2202b', secondary: '#111111', shorts: '#ffffff', socks: '#ffffff', pattern: 'hoops' }, away: { primary: '#ffffff', secondary: '#d2202b', shorts: '#111111', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'sun', colors: ['#d2202b', '#111111', '#ffffff'] }, stadium: { name: 'Estádio Guanabara', capacity: 78000, seats: '#d2202b', roof: false }, foreignShare: 0.2 }),
  T({ id: 'sao-verdes', name: 'São Paulo Verdes', short: 'SAO', city: 'São Paulo', country: 'Brazil', league: 'Brasileirão Ouro', rating: 78, style: 'pressing',
    home: { primary: '#1a7a3c', secondary: '#ffffff', shorts: '#ffffff', socks: '#1a7a3c', pattern: 'solid' }, away: { primary: '#ffffff', secondary: '#1a7a3c', shorts: '#1a7a3c', socks: '#ffffff', pattern: 'stripes' },
    crest: { shape: 'circle', icon: 'ball', colors: ['#1a7a3c', '#ffffff', '#f7c948'] }, stadium: { name: 'Arena Paulista', capacity: 43000, seats: '#1a7a3c', roof: true }, foreignShare: 0.2 }),
  // Argentina - Primera Austral
  T({ id: 'bue-xeneizes', name: 'Buenos Aires Xeneizes', short: 'BUE', city: 'Buenos Aires', country: 'Argentina', league: 'Primera Austral', rating: 78, style: 'direct',
    home: { primary: '#0a2a66', secondary: '#f7c948', shorts: '#0a2a66', socks: '#0a2a66', pattern: 'hoops' }, away: { primary: '#f7c948', secondary: '#0a2a66', shorts: '#f7c948', socks: '#f7c948', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'star', colors: ['#0a2a66', '#f7c948', '#ffffff'] }, stadium: { name: 'La Caldera', capacity: 57000, seats: '#0a2a66', roof: false }, foreignShare: 0.2 }),
  // Japan - J-Premier
  T({ id: 'tok-samurai', name: 'Tokyo Samurai', short: 'TOK', city: 'Tokyo', country: 'Japan', league: 'J-Premier', rating: 73, style: 'possession',
    home: { primary: '#d2202b', secondary: '#0a2a66', shorts: '#0a2a66', socks: '#d2202b', pattern: 'halves' }, away: { primary: '#ffffff', secondary: '#d2202b', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'diamond', icon: 'sun', colors: ['#d2202b', '#0a2a66', '#ffffff'] }, stadium: { name: 'Ajinomoto Field', capacity: 50000, seats: '#d2202b', roof: false }, foreignShare: 0.25 }),
  // Saudi Arabia - Pro League Gulf
  T({ id: 'riy-falcons', name: 'Riyadh Falcons', short: 'RIY', city: 'Riyadh', country: 'Saudi Arabia', league: 'Pro League Gulf', rating: 77, style: 'counter',
    home: { primary: '#f7c948', secondary: '#0a2a66', shorts: '#0a2a66', socks: '#f7c948', pattern: 'solid' }, away: { primary: '#ffffff', secondary: '#f7c948', shorts: '#ffffff', socks: '#ffffff', pattern: 'chevron' },
    crest: { shape: 'shield', icon: 'eagle', colors: ['#f7c948', '#0a2a66', '#ffffff'] }, stadium: { name: 'King Fahd Oasis', capacity: 68000, seats: '#f7c948', roof: true }, foreignShare: 0.5 }),
  // --- Expansion clubs ---
  T({ id: 'nld-cannons', name: 'North London Cannons', short: 'NLC', city: 'London', country: 'England', league: 'Premier Division', rating: 85, style: 'possession',
    home: { primary: '#e0202e', secondary: '#ffffff', shorts: '#ffffff', socks: '#e0202e', pattern: 'solid' }, away: { primary: '#f2c94c', secondary: '#1b2a4a', shorts: '#1b2a4a', socks: '#f2c94c', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'bolt', colors: ['#e0202e', '#ffffff', '#c9a227'] }, stadium: { name: 'Holloway Grove', capacity: 60000, seats: '#e0202e', roof: true }, foreignShare: 0.6 }),
  T({ id: 'bir-lions', name: 'Birmingham Lions', short: 'BIR', city: 'Birmingham', country: 'England', league: 'Premier Division', rating: 78, style: 'direct',
    home: { primary: '#7a1f3d', secondary: '#7fc1ea', shorts: '#ffffff', socks: '#7fc1ea', pattern: 'halves' }, away: { primary: '#7fc1ea', secondary: '#7a1f3d', shorts: '#7a1f3d', socks: '#7fc1ea', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'lion', colors: ['#7a1f3d', '#7fc1ea', '#f7c948'] }, stadium: { name: 'Aston Meadow', capacity: 42000, seats: '#7a1f3d', roof: true }, foreignShare: 0.45 }),
  T({ id: 'bil-leones', name: 'Bilbao Leones', short: 'BIL', city: 'Bilbao', country: 'Spain', league: 'La Primera', rating: 79, style: 'pressing',
    home: { primary: '#e2231a', secondary: '#ffffff', shorts: '#111111', socks: '#111111', pattern: 'stripes' }, away: { primary: '#1d2b4f', secondary: '#4caf50', shorts: '#1d2b4f', socks: '#1d2b4f', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'lion', colors: ['#e2231a', '#ffffff', '#1d2b4f'] }, stadium: { name: 'San Mamés Berria', capacity: 53000, seats: '#e2231a', roof: true }, foreignShare: 0.05 }),
  T({ id: 'rom-lupi', name: 'Roma Lupi', short: 'ROM', city: 'Rome', country: 'Italy', league: 'Serie Nazionale', rating: 81, style: 'counter',
    home: { primary: '#8e1f2f', secondary: '#f0a830', shorts: '#ffffff', socks: '#8e1f2f', pattern: 'solid' }, away: { primary: '#f4f1ea', secondary: '#8e1f2f', shorts: '#f4f1ea', socks: '#f4f1ea', pattern: 'chevron' },
    crest: { shape: 'circle', icon: 'sun', colors: ['#8e1f2f', '#f0a830', '#ffffff'] }, stadium: { name: 'Stadio dei Colli', capacity: 70000, seats: '#8e1f2f', roof: false }, foreignShare: 0.55 }),
  T({ id: 'fra-adler', name: 'Frankfurt Adler', short: 'FRA', city: 'Frankfurt', country: 'Germany', league: 'Bundesklasse', rating: 79, style: 'counter',
    home: { primary: '#111111', secondary: '#e1000f', shorts: '#111111', socks: '#111111', pattern: 'sash' }, away: { primary: '#ffffff', secondary: '#e1000f', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'diamond', icon: 'eagle', colors: ['#111111', '#e1000f', '#ffffff'] }, stadium: { name: 'Waldarena', capacity: 58000, seats: '#e1000f', roof: true }, foreignShare: 0.5 }),
  T({ id: 'lyo-lumiere', name: 'Lyon Lumière', short: 'LYO', city: 'Lyon', country: 'France', league: 'Ligue Nationale', rating: 78, style: 'possession',
    home: { primary: '#ffffff', secondary: '#1b3fa0', shorts: '#ffffff', socks: '#ffffff', pattern: 'chevron' }, away: { primary: '#1b3fa0', secondary: '#e2231a', shorts: '#1b3fa0', socks: '#1b3fa0', pattern: 'solid' },
    crest: { shape: 'hex', icon: 'lion', colors: ['#1b3fa0', '#e2231a', '#ffffff'] }, stadium: { name: 'Parc des Lumières', capacity: 59000, seats: '#1b3fa0', roof: true }, foreignShare: 0.45 }),
  T({ id: 'rot-havenstad', name: 'Rotterdam Havenstad', short: 'ROT', city: 'Rotterdam', country: 'Netherlands', league: 'Eredivisie Noord', rating: 77, style: 'pressing',
    home: { primary: '#e2231a', secondary: '#ffffff', shorts: '#111111', socks: '#111111', pattern: 'halves' }, away: { primary: '#111111', secondary: '#e2231a', shorts: '#111111', socks: '#111111', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'anchor', colors: ['#e2231a', '#ffffff', '#111111'] }, stadium: { name: 'De Haven', capacity: 47000, seats: '#e2231a', roof: true }, foreignShare: 0.4 }),
  T({ id: 'por-dragoes', name: 'Porto Dragões', short: 'POR', city: 'Porto', country: 'Portugal', league: 'Liga Atlântica', rating: 79, style: 'pressing',
    home: { primary: '#1d4ba0', secondary: '#ffffff', shorts: '#1d4ba0', socks: '#1d4ba0', pattern: 'stripes' }, away: { primary: '#f7a21b', secondary: '#1d4ba0', shorts: '#f7a21b', socks: '#f7a21b', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'eagle', colors: ['#1d4ba0', '#ffffff', '#f7c948'] }, stadium: { name: 'Estádio do Dragão Azul', capacity: 50000, seats: '#1d4ba0', roof: true }, foreignShare: 0.5 }),
  T({ id: 'bru-blauwzwart', name: 'Brugge Blauw-Zwart', short: 'BRU', city: 'Bruges', country: 'Belgium', league: 'Pro League Belge', rating: 75, style: 'counter',
    home: { primary: '#0f4ea8', secondary: '#111111', shorts: '#111111', socks: '#111111', pattern: 'stripes' }, away: { primary: '#ffffff', secondary: '#0f4ea8', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'shield', icon: 'tower', colors: ['#0f4ea8', '#111111', '#ffffff'] }, stadium: { name: 'Jan Breydel Park', capacity: 29000, seats: '#0f4ea8', roof: true }, foreignShare: 0.55 }),
  T({ id: 'bxl-mauves', name: 'Bruxelles Mauves', short: 'BXL', city: 'Brussels', country: 'Belgium', league: 'Pro League Belge', rating: 74, style: 'possession',
    home: { primary: '#5b2a86', secondary: '#ffffff', shorts: '#ffffff', socks: '#5b2a86', pattern: 'solid' }, away: { primary: '#ffffff', secondary: '#5b2a86', shorts: '#5b2a86', socks: '#ffffff', pattern: 'pinstripe' },
    crest: { shape: 'circle', icon: 'crown', colors: ['#5b2a86', '#ffffff', '#c9a227'] }, stadium: { name: 'Parc Royal', capacity: 22000, seats: '#5b2a86', roof: true }, foreignShare: 0.5 }),
  T({ id: 'gla-hoops', name: 'Glasgow Hoops', short: 'GLH', city: 'Glasgow', country: 'Scotland', league: 'Caledonian League', rating: 76, style: 'possession',
    home: { primary: '#108a43', secondary: '#ffffff', shorts: '#ffffff', socks: '#ffffff', pattern: 'hoops' }, away: { primary: '#111111', secondary: '#f7c948', shorts: '#111111', socks: '#111111', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'star', colors: ['#108a43', '#ffffff', '#f7c948'] }, stadium: { name: 'Parkside', capacity: 60000, seats: '#108a43', roof: true }, foreignShare: 0.55 }),
  T({ id: 'gla-thistle', name: 'Glasgow Thistle', short: 'GLT', city: 'Glasgow', country: 'Scotland', league: 'Caledonian League', rating: 75, style: 'direct',
    home: { primary: '#1b3fa0', secondary: '#ffffff', shorts: '#ffffff', socks: '#111111', pattern: 'solid' }, away: { primary: '#ffffff', secondary: '#e2231a', shorts: '#ffffff', socks: '#ffffff', pattern: 'sash' },
    crest: { shape: 'shield', icon: 'lion', colors: ['#1b3fa0', '#e2231a', '#ffffff'] }, stadium: { name: 'Thistle Hill', capacity: 50000, seats: '#1b3fa0', roof: true }, foreignShare: 0.55 }),
  T({ id: 'ist-aslanlar', name: 'Istanbul Aslanlar', short: 'IST', city: 'Istanbul', country: 'Turkey', league: 'Süper Lig Anadolu', rating: 78, style: 'counter',
    home: { primary: '#f7a21b', secondary: '#a6192e', shorts: '#a6192e', socks: '#a6192e', pattern: 'halves' }, away: { primary: '#111111', secondary: '#f7a21b', shorts: '#111111', socks: '#111111', pattern: 'solid' },
    crest: { shape: 'circle', icon: 'lion', colors: ['#a6192e', '#f7a21b', '#ffffff'] }, stadium: { name: 'Aslan Arena', capacity: 52000, seats: '#a6192e', roof: true }, foreignShare: 0.5 }),
  T({ id: 'ist-kanaryalar', name: 'Istanbul Kanaryalar', short: 'KAN', city: 'Istanbul', country: 'Turkey', league: 'Süper Lig Anadolu', rating: 77, style: 'pressing',
    home: { primary: '#f7d417', secondary: '#13235a', shorts: '#ffffff', socks: '#13235a', pattern: 'stripes' }, away: { primary: '#13235a', secondary: '#f7d417', shorts: '#13235a', socks: '#13235a', pattern: 'solid' },
    crest: { shape: 'hex', icon: 'star', colors: ['#13235a', '#f7d417', '#ffffff'] }, stadium: { name: 'Kadıköy Park', capacity: 47000, seats: '#f7d417', roof: true }, foreignShare: 0.5 }),
  T({ id: 'mex-aguilas', name: 'Ciudad de México Águilas', short: 'CMX', city: 'Mexico City', country: 'Mexico', league: 'Liga Azteca', rating: 75, style: 'direct',
    home: { primary: '#f7d417', secondary: '#13235a', shorts: '#13235a', socks: '#f7d417', pattern: 'solid' }, away: { primary: '#13235a', secondary: '#f7d417', shorts: '#13235a', socks: '#13235a', pattern: 'chevron' },
    crest: { shape: 'shield', icon: 'eagle', colors: ['#13235a', '#f7d417', '#e2231a'] }, stadium: { name: 'Estadio del Valle', capacity: 83000, seats: '#f7d417', roof: false }, foreignShare: 0.3 }),
  T({ id: 'mty-sultanes', name: 'Monterrey Sultanes', short: 'MTY', city: 'Monterrey', country: 'Mexico', league: 'Liga Azteca', rating: 74, style: 'counter',
    home: { primary: '#13235a', secondary: '#ffffff', shorts: '#13235a', socks: '#13235a', pattern: 'stripes' }, away: { primary: '#ffffff', secondary: '#13235a', shorts: '#ffffff', socks: '#ffffff', pattern: 'solid' },
    crest: { shape: 'diamond', icon: 'tower', colors: ['#13235a', '#ffffff', '#c9a227'] }, stadium: { name: 'Cerro Arena', capacity: 53000, seats: '#13235a', roof: true }, foreignShare: 0.35 }),
];
export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
export const LEAGUES = Array.from(new Set(TEAMS.map((t) => t.league)));

export const SQUAD_TEMPLATE: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST'];
export const STARTING_XI_433: Position[] = ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RW', 'ST', 'LW'];

function attrsFor(pos: Position, rating: number, rng: Rng): PlayerAttributes {
  const n = (bias: number, spread = 6) => Math.round(Math.max(30, Math.min(99, rating + bias + rng.gauss(0, spread))));
  const isGK = pos === 'GK';
  const def = ['CB', 'LB', 'RB', 'CDM'].includes(pos);
  const att = ['ST', 'LW', 'RW', 'CAM'].includes(pos);
  return {
    pace: n(['LW', 'RW', 'LB', 'RB', 'ST'].includes(pos) ? 6 : def ? -4 : 0),
    shooting: n(att ? 6 : def ? -18 : -6),
    passing: n(['CM', 'CAM', 'CDM'].includes(pos) ? 6 : def ? -8 : -2),
    dribbling: n(att ? 6 : def ? -12 : 0),
    defending: n(def ? 8 : att ? -25 : -10),
    physical: n(def ? 6 : 0),
    diving: isGK ? n(4) : 20 + rng.int(0, 20),
    reflexes: isGK ? n(4) : 20 + rng.int(0, 20),
  };
}

function rarityFor(rating: number): PlayerCard['rarity'] { return rating >= 86 ? 'elite' : rating >= 75 ? 'gold' : rating >= 65 ? 'silver' : 'bronze'; }

/** Every club's squad, generated together and deterministically (the same world on the server and in the browser).
 *  Names are allocated across the whole world from large per-nationality pools, least-used first, so surnames rarely
 *  repeat and given names repeat little. The repeats that do happen are mostly brothers: now and then a player is the
 *  brother of someone already in the same league (sometimes in the same squad), sharing surname and nationality. */
function generateWorld(): Map<string, PlayerCard[]> {
  const world = new Map<string, PlayerCard[]>();
  const rng = new Rng('world:rosters:v2');
  const lastUse = new Map<string, number>(); const firstUse = new Map<string, number>();
  type Entry = { nat: string; first: string; last: string; age: number; team: string; card: PlayerCard };
  const byLeague = new Map<string, Entry[]>();
  const leastUsed = (pool: string[], use: Map<string, number>, nat: string, avoid?: Set<string>) => {
    const ok = pool.filter((x) => !avoid?.has(x)); const from = ok.length ? ok : pool;
    let min = Infinity; for (const x of from) min = Math.min(min, use.get(x) ?? 0);
    return rng.pick(from.filter((x) => (use.get(x) ?? 0) === min));
  };
  const names = (n: string) => NAMES[n] ?? NAMES.England;
  for (const team of TEAMS) {
    const trng = new Rng(`roster:${team.id}`);
    const numbers = trng.shuffle(Array.from({ length: 30 }, (_, i) => i + 2));
    const league = byLeague.get(team.league) ?? []; byLeague.set(team.league, league);
    const squad: PlayerCard[] = [];
    SQUAD_TEMPLATE.forEach((pos, idx) => {
      let nat = trng.bool(team.foreignShare) ? trng.pick(FOREIGN_POOL.filter((c) => c !== team.country)) : team.country;
      let age = trng.int(19, 34); let brotherOf: Entry | null = null;
      // Brothers: about one player in 15 has a brother already in the league (sometimes in the same squad).
      if (rng.bool(0.065)) {
        const single = league.filter((p) => league.filter((q) => q.last === p.last).length === 1);
        const pool = rng.bool(0.3) ? single.filter((p) => p.team === team.id) : single.filter((p) => p.team !== team.id);
        if (pool.length) brotherOf = rng.pick(pool);
      }
      let first: string, last: string;
      if (brotherOf) {
        nat = brotherOf.nat; last = brotherOf.last;
        first = leastUsed(names(nat).first, firstUse, nat, new Set(league.filter((p) => p.last === last && p.nat === nat).map((p) => p.first)));
        age = Math.max(18, Math.min(36, brotherOf.age + (rng.bool(0.5) ? 1 : -1) * rng.int(1, 4)));
      } else {
        // a fresh surname: the least used in the world, and never one already in this league (that would read as a brother)
        const inLeague = new Set(league.map((p) => p.last));
        last = leastUsed(names(nat).last, lastUse, nat, inLeague);
        first = leastUsed(names(nat).first, firstUse, nat);
      }
      lastUse.set(last, (lastUse.get(last) ?? 0) + 1);
      firstUse.set(first, (firstUse.get(first) ?? 0) + 1);
      const starter = idx === 0 || (idx >= 2 && idx <= 4) || idx === 5 || idx === 6 || idx === 8 || idx === 9 || idx === 11 || idx === 14 || idx === 15 || idx === 16;
      const rating = Math.round(Math.max(55, Math.min(94, team.rating + (starter ? trng.gauss(0, 3) : trng.gauss(-7, 4)))));
      const card: PlayerCard = {
        id: `${team.id}:${idx}`,
        name: `${first} ${last}`,
        shortName: last.length > 10 ? `${first[0]}. ${last}` : last,
        nationality: nat,
        teamId: team.id,
        position: pos,
        rating,
        number: pos === 'GK' ? (idx === 0 ? 1 : numbers.pop()!) : numbers.pop()!,
        age,
        look: { skin: trng.int(0, 5), hair: trng.int(0, 5), hairColor: trng.int(0, 4), height: trng.range(1.72, 1.94), build: trng.range(0.9, 1.1) },
        attrs: attrsFor(pos, rating, trng),
        rarity: rarityFor(rating),
      };
      if (brotherOf) {
        // family likeness; brothers in the same squad are told apart by an initial on the shirt
        card.look = { ...card.look, skin: brotherOf.card.look.skin, hairColor: brotherOf.card.look.hairColor };
        if (brotherOf.team === team.id) { card.shortName = `${first[0]}. ${last}`; brotherOf.card.shortName = `${brotherOf.first[0]}. ${last}`; }
      }
      squad.push(card);
      league.push({ nat, first, last, age, team: team.id, card });
    });
    world.set(team.id, squad);
  }
  return world;
}
let worldCache: Map<string, PlayerCard[]> | null = null;

/** A club's squad (generated with the rest of the world, deterministically). */
export function generateRoster(team: Team): PlayerCard[] { return rosterOf(team.id); }

export function rosterOf(teamId: string): PlayerCard[] {
  worldCache ??= generateWorld();
  return worldCache.get(teamId)!;
}
export function allPlayers(): PlayerCard[] { return TEAMS.flatMap((t) => rosterOf(t.id)); }
export function playerById(id: string): PlayerCard | undefined { const teamId = id.split(':')[0]; return rosterOf(teamId)?.find((p) => p.id === id); }

/** Pick a starting XI (4-3-3) from a roster: best-rated player per template position. */
export function startingXI(roster: PlayerCard[], positions: Position[] = STARTING_XI_433): PlayerCard[] {
  const taken = new Set<string>();
  const alt: Record<Position, Position[]> = {
    GK: ['GK'], CB: ['CB', 'CDM', 'RB', 'LB'], LB: ['LB', 'RB', 'CB', 'LM'], RB: ['RB', 'LB', 'CB', 'RM'], CDM: ['CDM', 'CM', 'CB'], CM: ['CM', 'CDM', 'CAM'], CAM: ['CAM', 'CM', 'LW', 'RW'],
    LM: ['LM', 'LW', 'CM'], RM: ['RM', 'RW', 'CM'], LW: ['LW', 'LM', 'ST', 'RW'], RW: ['RW', 'RM', 'ST', 'LW'], ST: ['ST', 'LW', 'RW', 'CAM'],
  };
  return positions.map((pos) => {
    for (const p of alt[pos]) {
      const c = roster.filter((x) => x.position === p && !taken.has(x.id)).sort((a, b) => b.rating - a.rating)[0];
      if (c) { taken.add(c.id); return c; }
    }
    const any = roster.filter((x) => !taken.has(x.id)).sort((a, b) => b.rating - a.rating)[0];
    taken.add(any.id); return any;
  });
}

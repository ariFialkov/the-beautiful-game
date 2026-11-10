import { Rng } from './rng';
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
];

export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
export const LEAGUES = Array.from(new Set(TEAMS.map((t) => t.league)));

/* ---------------------------- name pools ---------------------------- */
const NAMES: Record<string, { first: string[]; last: string[] }> = {
  England: { first: ['Harry', 'Jack', 'Oliver', 'Callum', 'Reece', 'Marcus', 'Declan', 'Mason', 'Jude', 'Kyle', 'Jordan', 'Lewis', 'Trent', 'Conor', 'Aaron'], last: ['Walker', 'Stones', 'Hughes', 'Bennett', 'Shaw', 'Barnes', 'Foden', 'Wright', 'Palmer', 'Grealish', 'Mount', 'Mills', 'Hardy', 'Clarke', 'Dawson'] },
  Spain: { first: ['Pablo', 'Álvaro', 'Dani', 'Marcos', 'Sergio', 'Rodrigo', 'Iker', 'Álex', 'Mikel', 'Jordi', 'Nico', 'Unai', 'Pedri', 'Ferran', 'Gavi'], last: ['García', 'Hernández', 'Torres', 'Navarro', 'Ruiz', 'Morales', 'Iglesias', 'Vidal', 'Castro', 'Soler', 'Olmo', 'Llorente', 'Asensio', 'Merino', 'Oyarzabal'] },
  Italy: { first: ['Marco', 'Lorenzo', 'Alessandro', 'Federico', 'Giovanni', 'Nicolò', 'Matteo', 'Davide', 'Sandro', 'Riccardo', 'Gianluca', 'Leonardo', 'Manuel', 'Giacomo', 'Andrea'], last: ['Rossi', 'Bianchi', 'Romano', 'Ricci', 'Conti', 'Esposito', 'Greco', 'Lombardi', 'Barella', 'Moretti', 'Pellegrini', 'Chiesa', 'Scalvini', 'Locatelli', 'Raspadori'] },
  Germany: { first: ['Leon', 'Jonas', 'Florian', 'Kai', 'Joshua', 'Niklas', 'Julian', 'Robin', 'Jamal', 'Maximilian', 'Tim', 'Lukas', 'Benjamin', 'Nico', 'Ilkay'], last: ['Müller', 'Schmidt', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hofmann', 'Koch', 'Richter', 'Wirtz', 'Brandt', 'Kimmich', 'Havertz', 'Gnabry', 'Schlotterbeck'] },
  France: { first: ['Kylian', 'Antoine', 'Ousmane', 'Théo', 'Jules', 'Aurélien', 'Eduardo', 'Hugo', 'Mathis', 'Rayan', 'Warren', 'Bradley', 'Benjamin', 'Dayot', 'Olivier'], last: ['Martin', 'Bernard', 'Dubois', 'Laurent', 'Lefebvre', 'Moreau', 'Girard', 'Fournier', 'Camavinga', 'Thuram', 'Koundé', 'Upamecano', 'Mendy', 'Barcola', 'Zaïre'] },
  Netherlands: { first: ['Virgil', 'Frenkie', 'Cody', 'Xavi', 'Denzel', 'Jurrien', 'Teun', 'Tijjani', 'Daley', 'Jeremie', 'Ryan', 'Lutsharel', 'Micky', 'Joshua', 'Bart'], last: ['de Jong', 'van Dijk', 'Gakpo', 'Simons', 'Dumfries', 'Timber', 'Koopmeiners', 'Reijnders', 'Blind', 'Frimpong', 'Gravenberch', 'Geertruida', 'van de Ven', 'Zirkzee', 'Verbruggen'] },
  Portugal: { first: ['João', 'Bruno', 'Rafael', 'Rúben', 'Bernardo', 'Diogo', 'Gonçalo', 'Nuno', 'Vitinha', 'Pedro', 'Francisco', 'Tiago', 'André', 'Matheus', 'Rúben'], last: ['Silva', 'Fernandes', 'Leão', 'Dias', 'Neves', 'Costa', 'Ramos', 'Mendes', 'Santos', 'Pereira', 'Conceição', 'Trincão', 'Nunes', 'Palhinha', 'Vieira'] },
  USA: { first: ['Christian', 'Weston', 'Tyler', 'Gio', 'Folarin', 'Ricardo', 'Antonee', 'Yunus', 'Chris', 'Tim', 'Brenden', 'Matt', 'Malik', 'Josh', 'Sergiño'], last: ['Pulisic', 'McKennie', 'Adams', 'Reyna', 'Balogun', 'Pepi', 'Robinson', 'Musah', 'Richards', 'Weah', 'Aaronson', 'Turner', 'Tillman', 'Sargent', 'Dest'] },
  Brazil: { first: ['Vinícius', 'Rodrygo', 'Raphinha', 'Endrick', 'Bruno', 'Lucas', 'Gabriel', 'Marquinhos', 'Éder', 'Casemiro', 'Richarlison', 'Matheus', 'Danilo', 'Alisson', 'Savinho'], last: ['Júnior', 'Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Martinelli', 'Paquetá', 'Guimarães', 'Cunha', 'Militão', 'Andrade', 'Ribeiro'] },
  Argentina: { first: ['Lionel', 'Julián', 'Enzo', 'Alexis', 'Rodrigo', 'Lautaro', 'Nicolás', 'Cristian', 'Emiliano', 'Lisandro', 'Nahuel', 'Giovani', 'Thiago', 'Exequiel', 'Leandro'], last: ['Álvarez', 'Fernández', 'Mac Allister', 'De Paul', 'Martínez', 'Otamendi', 'Romero', 'Paredes', 'Molina', 'Lo Celso', 'Almada', 'Palacios', 'Garnacho', 'Tagliafico', 'Acuña'] },
  Japan: { first: ['Takefusa', 'Kaoru', 'Ritsu', 'Wataru', 'Daichi', 'Takumi', 'Hiroki', 'Ayase', 'Ko', 'Junya', 'Keito', 'Reo', 'Yuki', 'Shogo', 'Zion'], last: ['Kubo', 'Mitoma', 'Doan', 'Endo', 'Kamada', 'Minamino', 'Ito', 'Ueda', 'Itakura', 'Nakamura', 'Tanaka', 'Hatate', 'Soma', 'Taniguchi', 'Suzuki'] },
  'Saudi Arabia': { first: ['Salem', 'Saud', 'Firas', 'Ali', 'Abdullah', 'Mohammed', 'Turki', 'Nasser', 'Fahad', 'Sultan', 'Hassan', 'Yasser', 'Khalid', 'Abdulrahman', 'Marwan'], last: ['Al-Dawsari', 'Al-Buraikan', 'Al-Shehri', 'Al-Hassan', 'Al-Malki', 'Al-Najei', 'Al-Ghannam', 'Al-Oboud', 'Al-Shahrani', 'Kanno', 'Al-Harbi', 'Al-Bulayhi', 'Al-Tambakti', 'Al-Amri', 'Madu'] },
  Nigeria: { first: ['Victor', 'Ademola', 'Samuel', 'Kelechi', 'Alex', 'Wilfred', 'Calvin', 'Frank', 'Taiwo', 'Moses'], last: ['Osimhen', 'Lookman', 'Chukwueze', 'Iheanacho', 'Iwobi', 'Ndidi', 'Bassey', 'Onyeka', 'Awoniyi', 'Simon'] },
  Senegal: { first: ['Sadio', 'Kalidou', 'Idrissa', 'Ismaïla', 'Boulaye', 'Nicolas', 'Iliman', 'Pape', 'Habib', 'Lamine'], last: ['Mané', 'Koulibaly', 'Gueye', 'Sarr', 'Dia', 'Jackson', 'Ndiaye', 'Diallo', 'Camara', 'Diatta'] },
  Belgium: { first: ['Kevin', 'Romelu', 'Jérémy', 'Leandro', 'Youri', 'Charles', 'Amadou', 'Arthur', 'Loïs', 'Johan'], last: ['De Bruyne', 'Lukaku', 'Doku', 'Trossard', 'Tielemans', 'De Ketelaere', 'Onana', 'Theate', 'Openda', 'Bakayoko'] },
  Croatia: { first: ['Luka', 'Joško', 'Mateo', 'Ivan', 'Andrej', 'Marcelo', 'Lovro', 'Bruno', 'Josip', 'Borna'], last: ['Modrić', 'Gvardiol', 'Kovačić', 'Perišić', 'Kramarić', 'Brozović', 'Majer', 'Petković', 'Stanišić', 'Sosa'] },
  'South Korea': { first: ['Heung-min', 'Min-jae', 'Kang-in', 'Hwang', 'Woo-yeong', 'Jin-su', 'Sang-ho', 'Seung-ho', 'Hyun-woo', 'Tae-hwan'], last: ['Son', 'Kim', 'Lee', 'Hee-chan', 'Jeong', 'Park', 'Na', 'Paik', 'Jo', 'Oh'] },
  Mexico: { first: ['Hirving', 'Edson', 'Santiago', 'Raúl', 'César', 'Johan', 'Luis', 'Jorge', 'Orbelín', 'Uriel'], last: ['Lozano', 'Álvarez', 'Giménez', 'Jiménez', 'Montes', 'Vásquez', 'Chávez', 'Sánchez', 'Pineda', 'Antuna'] },
  Norway: { first: ['Erling', 'Martin', 'Alexander', 'Sander', 'Antonio', 'Oscar', 'Kristoffer', 'Fredrik', 'Jørgen', 'Leo'], last: ['Haaland', 'Ødegaard', 'Sørloth', 'Berge', 'Nusa', 'Bobb', 'Ajer', 'Aursnes', 'Larsen', 'Østigård'] },
  Uruguay: { first: ['Federico', 'Darwin', 'Ronald', 'Manuel', 'Rodrigo', 'Facundo', 'Matías', 'Nicolás', 'Maximiliano', 'Sebastián'], last: ['Valverde', 'Núñez', 'Araújo', 'Ugarte', 'Bentancur', 'Pellistri', 'Viña', 'de la Cruz', 'Gómez', 'Cáceres'] },
};
const FOREIGN_POOL = ['Nigeria', 'Senegal', 'Belgium', 'Croatia', 'South Korea', 'Mexico', 'Norway', 'Uruguay', 'Brazil', 'Argentina', 'France', 'Spain', 'Portugal', 'Netherlands', 'England', 'Germany', 'Italy'];

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

/** Deterministically generate a club's squad from its id. */
export function generateRoster(team: Team): PlayerCard[] {
  const rng = new Rng(`roster:${team.id}`);
  const used = new Set<string>();
  const numbers = rng.shuffle(Array.from({ length: 30 }, (_, i) => i + 2));
  return SQUAD_TEMPLATE.map((pos, idx) => {
    const foreign = rng.bool(team.foreignShare);
    const nat = foreign ? rng.pick(FOREIGN_POOL.filter((c) => c !== team.country)) : team.country;
    const pool = NAMES[nat] ?? NAMES.England;
    let first = rng.pick(pool.first); let last = rng.pick(pool.last);
    let guard = 0;
    while (used.has(`${first} ${last}`) && guard++ < 20) { first = rng.pick(pool.first); last = rng.pick(pool.last); }
    used.add(`${first} ${last}`);
    const starter = idx === 0 || (idx >= 2 && idx <= 4) || idx === 5 || idx === 6 || idx === 8 || idx === 9 || idx === 11 || idx === 14 || idx === 15 || idx === 16;
    const rating = Math.round(Math.max(55, Math.min(94, team.rating + (starter ? rng.gauss(0, 3) : rng.gauss(-7, 4)))));
    return {
      id: `${team.id}:${idx}`,
      name: `${first} ${last}`,
      shortName: last.length > 10 ? `${first[0]}. ${last}` : last,
      nationality: nat,
      teamId: team.id,
      position: pos,
      rating,
      number: pos === 'GK' ? (idx === 0 ? 1 : numbers.pop()!) : numbers.pop()!,
      age: rng.int(19, 34),
      look: { skin: rng.int(0, 5), hair: rng.int(0, 5), hairColor: rng.int(0, 4), height: rng.range(1.72, 1.94), build: rng.range(0.9, 1.1) },
      attrs: attrsFor(pos, rating, rng),
      rarity: rarityFor(rating),
    };
  });
}

const rosterCache = new Map<string, PlayerCard[]>();
export function rosterOf(teamId: string): PlayerCard[] {
  let r = rosterCache.get(teamId);
  if (!r) { r = generateRoster(TEAM_BY_ID[teamId]); rosterCache.set(teamId, r); }
  return r;
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

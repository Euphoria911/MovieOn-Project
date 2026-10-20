/**
 * Demo catalog.
 *
 * LEGAL NOTE: The four Blender Foundation films are released under CC-BY and may be
 * redistributed with attribution. Every other title below is a FICTIONAL placeholder that
 * re-uses those sample videos so the UI can be demonstrated. Replace it with content you
 * hold distribution rights for before any public launch (see docs/01-planning-and-requirements.md).
 */
import bcrypt from 'bcryptjs';
import { slugify } from './util.js';

const BASE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
const V = {
  bunny: `${BASE}/BigBuckBunny.mp4`,
  dream: `${BASE}/ElephantsDream.mp4`,
  sintel: `${BASE}/Sintel.mp4`,
  steel: `${BASE}/TearsOfSteel.mp4`,
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
};
const CYCLE = [V.bunny, V.dream, V.sintel, V.steel, V.hls];

const DEMO = '[Demo placeholder] ';

// Content tier per demo title (free = everyone, otherwise the plan that unlocks it).
const TIER = {
  'Big Buck Bunny': 'free',
  'Sintel': 'free',
  'Tears of Steel': 'free',
  'Elephants Dream': 'free',
  'Midnight Courier': 'silver',
  'Harbor Lights': 'silver',
  'Orbit Station': 'gold',
  'The Last Cartographer': 'silver',
  'Kitchen Wars': 'free',
  'Sakura Circuit': 'gold',
  'Blade of the Tide': 'diamond',
  'Moonlit Cafe': 'silver',
  'Iron Aegis': 'gold',
};

const MOVIES = [
  {
    name: 'Big Buck Bunny', year: 2008, age: '0+', dur: 10, hue: [135, 75], featured: 1,
    genres: ['Animation', 'Comedy', 'Family'], video: V.bunny,
    synopsis: 'A giant, gentle rabbit is pushed too far by three mischievous rodents. Open movie by the Blender Foundation (CC-BY).',
  },
  {
    name: 'Sintel', year: 2010, age: '12+', dur: 15, hue: [265, 330], featured: 1,
    genres: ['Animation', 'Fantasy', 'Adventure'], video: V.sintel,
    synopsis: 'A lonely young woman searches the world for the dragon she once befriended. Open movie by the Blender Foundation (CC-BY).',
  },
  {
    name: 'Tears of Steel', year: 2012, age: '12+', dur: 12, hue: [200, 20], featured: 1,
    genres: ['Sci-Fi', 'Action'], video: V.steel,
    synopsis: 'In a future Amsterdam, a group of warriors and scientists tries to save the world with a bold experiment. Open movie by the Blender Foundation (CC-BY).',
  },
  {
    name: 'Elephants Dream', year: 2006, age: '12+', dur: 11, hue: [20, 290], featured: 0,
    genres: ['Animation', 'Sci-Fi'], video: V.dream,
    synopsis: 'Two strange characters explore a capricious and seemingly infinite machine. The first Blender open movie (CC-BY).',
  },
  {
    name: 'Midnight Courier', year: 2024, age: '16+', dur: 10, hue: [230, 190], featured: 0,
    genres: ['Thriller', 'Drama'], video: V.hls,
    synopsis: `${DEMO}A night-shift courier receives a parcel that is not meant to be opened. Streams through the adaptive HLS demo source.`,
  },
];

const SERIES = [
  {
    type: 'series', name: 'Harbor Lights', year: 2023, age: '16+', hue: [215, 40], featured: 1,
    genres: ['Drama', 'Mystery'],
    synopsis: `${DEMO}Three families on a fading port town discover the lighthouse has been keeping a secret for fifty years.`,
    seasons: [
      ['The Last Ferry', 'Salt and Rust', 'Low Tide'],
      ['The Keeper', 'Storm Warning'],
    ],
  },
  {
    type: 'series', name: 'Orbit Station', year: 2025, age: '12+', hue: [255, 175], featured: 0,
    genres: ['Sci-Fi', 'Drama'],
    synopsis: `${DEMO}The crew of a research station must decide whether to answer a signal that should not exist.`,
    seasons: [['Docking', 'Quiet Frequency', 'Blackout', 'Return Window']],
  },
  {
    type: 'series', name: 'The Last Cartographer', year: 2022, age: '12+', hue: [35, 150], featured: 0,
    genres: ['Adventure', 'Mystery'],
    synopsis: `${DEMO}A retired mapmaker is pulled back for one final expedition to chart a coastline that moves.`,
    seasons: [['Blank Edge', 'The Compass Lies', 'Uncharted']],
  },
  {
    type: 'series', name: 'Kitchen Wars', year: 2024, age: '6+', hue: [8, 50], featured: 0,
    genres: ['Comedy', 'Family'],
    synopsis: `${DEMO}Two rival diners on the same street, one shared dumpster, and a city-wide cooking contest.`,
    seasons: [['Opening Day', 'Health Inspector', 'Grand Final']],
  },
];

const ANIME = [
  {
    type: 'anime', name: 'Sakura Circuit', year: 2025, age: '12+', hue: [335, 285], featured: 1,
    genres: ['Action', 'Sci-Fi', 'Shonen'],
    synopsis: `${DEMO}A high-school mechanic discovers that the cherry-blossom grid powering Neo-Kyoto is alive.`,
    seasons: [['Spark', 'Overclock', 'Ghost in the Grid', 'Reboot']],
  },
  {
    type: 'anime', name: 'Blade of the Tide', year: 2024, age: '16+', hue: [195, 245], featured: 0,
    genres: ['Fantasy', 'Adventure', 'Action'],
    synopsis: `${DEMO}A swordswoman bound to the sea must carry a drowned kingdom's last memory to the shore.`,
    seasons: [['Salt Oath', 'The Drowned Court', 'Ebb']],
  },
  {
    type: 'anime', name: 'Moonlit Cafe', year: 2023, age: '6+', hue: [45, 320], featured: 0,
    genres: ['Slice of Life', 'Romance', 'Comedy'],
    synopsis: `${DEMO}A tiny cafe opens only at night, and each customer leaves with exactly the wrong order — and the right memory.`,
    seasons: [['First Cup', 'Rainy Regulars', 'Closing Time']],
  },
  {
    type: 'anime', name: 'Iron Aegis', year: 2022, age: '16+', hue: [215, 5], featured: 0,
    genres: ['Mecha', 'Action', 'Sci-Fi'],
    synopsis: `${DEMO}When the walls fall, a teenage pilot inherits the last shield-class mecha and a debt to the city.`,
    seasons: [['Deployment', 'Breach', 'Aegis Protocol']],
  },
];

/** Insert the demo catalog. No-op when titles already exist. Returns number of titles inserted. */
export function seedCatalog(db) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM titles').get().c;
  if (existing > 0) return 0;

  const insTitle = db.prepare(`INSERT INTO titles
    (slug, type, name, synopsis, year, age_rating, duration_min, video_url, hue1, hue2, featured, views, created_at, min_tier)
    VALUES (@slug, @type, @name, @synopsis, @year, @age, @dur, @video, @h1, @h2, @featured, @views, @created, @tier)`);
  const insGenre = db.prepare('INSERT OR IGNORE INTO genres (name) VALUES (?)');
  const getGenre = db.prepare('SELECT id FROM genres WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO title_genres (title_id, genre_id) VALUES (?, ?)');
  const insEp = db.prepare(`INSERT INTO episodes
    (title_id, season, number, name, synopsis, duration_min, video_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  let n = 0;
  let vIdx = 0;
  const all = [
    ...MOVIES.map((m) => ({ ...m, type: 'movie' })),
    ...SERIES,
    ...ANIME,
  ];

  db.exec('BEGIN');
  try {
    all.forEach((t, i) => {
      const created = new Date(Date.UTC(2026, 9, 20) - i * 86400000 * 3)
        .toISOString().replace('T', ' ').slice(0, 19);
      const info = insTitle.run({
        slug: slugify(t.name),
        type: t.type,
        name: t.name,
        synopsis: t.synopsis,
        year: t.year,
        age: t.age,
        dur: t.type === 'movie' ? t.dur : null,
        video: t.type === 'movie' ? t.video : null,
        h1: t.hue[0],
        h2: t.hue[1],
        featured: t.featured ? 1 : 0,
        views: 40 + ((i * 37) % 160),
        created,
        tier: TIER[t.name] ?? 'free',
      });
      const id = Number(info.lastInsertRowid);
      for (const g of t.genres) {
        insGenre.run(g);
        link.run(id, getGenre.get(g).id);
      }
      if (t.seasons) {
        t.seasons.forEach((eps, sIdx) => {
          eps.forEach((epName, eIdx) => {
            insEp.run(
              id, sIdx + 1, eIdx + 1, epName,
              `${epName} — episode ${eIdx + 1} of season ${sIdx + 1}.`,
              10 + ((eIdx * 3) % 8),
              CYCLE[vIdx++ % CYCLE.length],
            );
          });
        });
      }
      n++;
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

/** Create the admin account if it does not exist. */
export function ensureAdmin(db, { email, password, username = 'Admin' }) {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (row) return false;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(email, username, hash);
  return true;
}

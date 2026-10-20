import { openDb } from './db.js';
import { seedCatalog } from './seed.js';

const db = openDb(process.env.DB_PATH ?? './data/movieon.db');
const n = seedCatalog(db);
console.log(n ? `Inserted ${n} demo titles.` : 'Catalog already has titles — nothing to do.');
db.close();

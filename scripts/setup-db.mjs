import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectRoot, 'data'));
const dbPath = path.join(dataDir, 'canada.db');

fs.mkdirSync(dataDir, { recursive: true });
const db = initDatabase(dbPath);
db.close();
console.log(`[setup-db] Database ready: ${dbPath}`);

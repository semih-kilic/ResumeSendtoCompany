import toml from 'toml';
import fs from 'fs';

const raw = fs.readFileSync('./config.toml', 'utf-8');
const config = toml.parse(raw);
console.log('limitbreak_url:', config.limitbreak_url);
console.log('limitbreak_key:', config.limitbreak_key);

const fs = require('fs');
const path = require('path');
const statePath = path.join('/home/ubuntu/app/data', 'maps_sync.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const lastRun = new Date(state.lastRun);
const now = new Date();
const hoursSince = (now - state.lastRun) / (1000 * 60 * 60);
console.log('Last run:', lastRun.toISOString());
console.log('Hours since last run:', hoursSince.toFixed(1));
console.log('State:', JSON.stringify(state, null, 2));

// Force reset
state.lastRun = 0;
fs.writeFileSync(statePath, JSON.stringify(state));
console.log('\n✅ Cooldown reset. Maps sweep will run on next cycle.');

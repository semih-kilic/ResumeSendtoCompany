// Test AIAdvisor module directly
import { AIAdvisor } from './ai-advisor.js';
import fs from 'fs';
import toml from 'toml'; // Wait, let's see if toml is in package.json

// Parse config manually to avoid dependency errors if toml is not present
const configContent = fs.readFileSync('./config.toml', 'utf-8');
const config = {};
configContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([a-zA-Z_0-9]+)\s*=\s*"([^"]+)"/);
  if (match) {
    config[match[1]] = match[2];
  } else {
    // try matching without quotes
    const numMatch = line.match(/^\s*([a-zA-Z_0-9]+)\s*=\s*([0-9a-zA-Z_.-]+)/);
    if (numMatch) {
      config[numMatch[1]] = numMatch[2] === 'true' ? true : numMatch[2] === 'false' ? false : numMatch[2];
    }
  }
});

console.log('Parsed config keys:', Object.keys(config));

const advisor = new AIAdvisor(config);

console.log('\n--- TESTING GEMINI (gemini-2.5-flash) ---');
const intro = await advisor.generateIntro('Shopify', 'Shopify is a leading global commerce company, providing trusted tools to start, grow, market, and manage a retail business of any size.');
console.log('Gemini Intro Result:', intro);

console.log('\n--- TESTING DYNAMIC CV SUMMARY ---');
const cvSummary = await advisor.generateDynamicCVSummary('Shopify', 'E-commerce platform and retail software Solutions', 'IT Systems Administrator with 5+ years of experience in system stabilization and infrastructure management.');
console.log('CV Summary Result:', cvSummary);

console.log('\n--- TESTING SENTIMENT ANALYSIS ---');
const sentiment = await advisor.analyzeSentiment('Hello, yes, we would like to schedule a call on Wednesday at 10 AM to discuss your application.', 'IT Support position');
console.log('Sentiment Result:', sentiment);

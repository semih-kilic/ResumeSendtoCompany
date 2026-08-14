#!/usr/bin/env node
/**
 * ⚡ Test Adaptive Provider Engine
 * Verifies all 3 tiers are working
 */

import AdaptiveProviderEngine from './adaptive-provider-engine.js';

const config = {
  scraperapi_key: 'test_invalid_key', // Will fail
  scrapingbee_key: 'test_invalid_key', // Will fail
  zenrows_key: 'test_invalid_key', // Will fail
  brightdata_free_key: 'brd-customer-test:free-zone', // May work
  oxylabs_free_key: 'customer-test:free-zone', // May work
};

const logger = {
  log: (msg) => console.log(`📝 ${msg}`),
  info: (msg) => console.log(`ℹ️  ${msg}`),
  warn: (msg) => console.log(`⚠️  ${msg}`),
  error: (msg) => console.log(`❌ ${msg}`),
  debug: (msg) => console.log(`🔍 ${msg}`),
};

async function test() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ADAPTIVE PROVIDER ENGINE - TEST                    ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const engine = new AdaptiveProviderEngine(config, logger);

  console.log('🧪 Testing with sample URL: https://example.com\n');

  try {
    const result = await engine.fetch('https://example.com', {
      'User-Agent': 'Mozilla/5.0 Test',
    });

    if (result.success) {
      console.log(`\n✅ SUCCESS via ${result.source}`);
      console.log(`📊 Response size: ${result.data.length} bytes`);
    } else {
      console.log(`\n❌ FAILED after all tiers`);
      console.log(`📊 Last source: ${result.source}`);
    }

    console.log('\n📊 Engine Status:');
    console.log(JSON.stringify(engine.getStatus(), null, 2));

  } catch (e) {
    console.error(`\n❌ Test Error: ${e.message}`);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  TEST COMPLETE                                       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

test().catch(console.error);

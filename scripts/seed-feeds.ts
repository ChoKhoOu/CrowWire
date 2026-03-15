import { loadFeeds } from '../src/config/feeds.js';

const feeds = loadFeeds();
console.log('Loaded feeds:');
for (const feed of feeds) {
  console.log(`  - ${feed.name} (${feed.source_type}) [${feed.enabled ? 'enabled' : 'disabled'}]`);
}
console.log(`Total: ${feeds.length} feeds`);

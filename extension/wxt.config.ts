import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Dropship eBay Helper',
    description: 'Save products from Amazon/Walmart/eBay and fill eBay Sandbox listing forms. Never auto-lists.',
    permissions: ['storage', 'sidePanel', 'activeTab', 'scripting', 'tabs'],
    host_permissions: [
      'https://*.amazon.com/*',
      'https://*.walmart.com/*',
      'https://*.ebay.com/*',
      'https://*.sandbox.ebay.com/*',
      'https://*.media-amazon.com/*',
      'https://dropship-api.chucla27.workers.dev/*',
      'http://127.0.0.1:8787/*',
      'http://localhost:8787/*',
    ],
  },
});

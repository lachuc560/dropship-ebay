import { defineContentScript } from 'wxt/sandbox';
import { fillListing, readAccountName, type FillPayload } from '../src/lib/ebay-fill';
import selectors from '../src/config/ebay-selectors.json';

// Chỉ chạy trên sandbox.ebay.com (dev/test). Không bao giờ chạy trên ebay.com thật (quy tắc mục 8).
// Chỉ điền form khi side panel yêu cầu. Không tự chạy nền.
export default defineContentScript({
  matches: ['https://*.sandbox.ebay.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'EBAY_ACCOUNT') {
        sendResponse({ account: readAccountName(selectors.account_name) });
        return false;
      }
      if (msg?.type === 'EBAY_FILL') {
        const payload = msg.payload as FillPayload;
        fillListing(payload)
          .then((results) => sendResponse({ results }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true; // trả lời bất đồng bộ
      }
      return false;
    });
  },
});

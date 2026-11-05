import { defineContentScript } from 'wxt/sandbox';
import { crawlWalmart } from '../src/adapters/walmart';

// Content script chỉ chạy trên trang sản phẩm Walmart, và chỉ khi side panel yêu cầu.
export default defineContentScript({
  matches: ['https://*.walmart.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'CRAWL_WALMART') return false;
      try {
        sendResponse(crawlWalmart());
      } catch (err) {
        sendResponse({ error: `Lỗi khi đọc trang Walmart: ${String(err)}` });
      }
      return false;
    });
  },
});

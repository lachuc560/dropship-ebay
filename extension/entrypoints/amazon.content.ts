import { defineContentScript } from 'wxt/sandbox';
import { crawlAmazon } from '../src/adapters/amazon';

// Content script chỉ chạy trên trang sản phẩm Amazon, và chỉ khi side panel yêu cầu.
// Không chạy nền, không tự mở tab (mục 4.1).
export default defineContentScript({
  matches: ['https://*.amazon.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'CRAWL_AMAZON') return false;
      try {
        sendResponse(crawlAmazon());
      } catch (err) {
        sendResponse({ error: `Lỗi khi đọc trang: ${String(err)}` });
      }
      return false;
    });
  },
});

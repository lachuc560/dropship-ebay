import { defineBackground } from 'wxt/sandbox';

export default defineBackground(() => {
  // Phase 0: chỉ mở side panel khi bấm icon extension.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('sidePanel setup failed', err));
});

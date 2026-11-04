// Mục 4.4: điền form tạo listing eBay Sandbox. Extension CHỈ điền, không bao giờ bấm List/Submit/Revise.
// Form của eBay là React, nên gán giá trị bằng native setter rồi phát sự kiện input/change.

import selectors from '../config/ebay-selectors.json';

export type FieldKey = keyof typeof selectors.fields;

export interface FieldResult {
  field: string;
  ok: boolean;
  reason?: string;
}

export interface FillPayload {
  title: string;
  sku: string;
  price: number;
  quantity: number;
  condition: string;
  description_html: string;
  item_specifics: Record<string, string>;
  handling_time?: string;
  category?: string;
}

// Khoảng nghỉ giữa các trường (mục 4.4: 300–800ms), tránh điền tất cả cùng lúc.
export function jitterDelay(): Promise<void> {
  const ms = 300 + Math.floor(Math.random() * 500);
  return new Promise((r) => setTimeout(r, ms));
}

// Rào chắn: không bao giờ thao tác với nút submit/list/revise, kể cả khi selector cấu hình sai.
export function isForbidden(el: Element): boolean {
  const forbidden = selectors.forbidden_selectors as string[];
  if (forbidden.some((sel) => {
    try { return el.matches(sel); } catch { return false; }
  })) return true;
  const text = (el.textContent ?? '').trim().toLowerCase();
  return /^(list it|submit|revise|list item|list)$/.test(text) && el.tagName === 'BUTTON';
}

// Tìm phần tử đầu tiên khớp trong danh sách selector, bỏ qua phần tử bị cấm.
export function findField(keys: string[]): HTMLElement | null {
  for (const sel of keys) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && !isForbidden(el)) return el;
  }
  return null;
}

// Chờ phần tử xuất hiện (form eBay tải chậm, một số trường chỉ hiện sau khi chọn category).
export function waitForField(keys: string[], timeoutMs = 8000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = findField(keys);
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const el = findField(keys);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// Gán giá trị cho input/textarea kiểu React bằng native setter, rồi phát sự kiện.
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) throw new Error('không tìm thấy native setter');
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Điền một trường và trả về kết quả để hiển thị trong bảng.
export async function fillText(field: string, keys: string[], value: string): Promise<FieldResult> {
  if (!value) return { field, ok: false, reason: 'không có dữ liệu' };
  const el = await waitForField(keys);
  if (!el) return { field, ok: false, reason: 'không tìm thấy ô trên form (kiểm tra selector)' };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, value);
    return { field, ok: true };
  }
  return { field, ok: false, reason: 'phần tử không phải ô nhập (cần điền tay hoặc chỉnh selector)' };
}

// Điền toàn bộ theo thứ tự, có độ trễ, rồi trả về bảng kết quả.
export async function fillListing(payload: FillPayload): Promise<FieldResult[]> {
  const f = selectors.fields;
  const steps: Array<[string, string[], string]> = [
    ['title', f.title, payload.title],
    ['sku', f.sku, payload.sku],
    ['price', f.price, String(payload.price)],
    ['quantity', f.quantity, String(payload.quantity)],
    ['condition', f.condition, payload.condition],
    ['description', f.description, payload.description_html],
  ];
  if (payload.handling_time) steps.push(['handling_time', f.handling_time, payload.handling_time]);

  const results: FieldResult[] = [];
  for (const [field, keys, value] of steps) {
    results.push(await fillText(field, keys, value));
    await jitterDelay();
  }

  // Item specifics: điền theo label nếu eBay hiển thị dạng cặp label/input.
  for (const [name, value] of Object.entries(payload.item_specifics)) {
    results.push(await fillSpecific(name, value));
    await jitterDelay();
  }
  return results;
}

// Tìm ô item specific theo nhãn (label) hiển thị trên form, rồi điền.
export async function fillSpecific(name: string, value: string): Promise<FieldResult> {
  const field = `specific:${name}`;
  const labels = Array.from(document.querySelectorAll('label'));
  const label = labels.find((l) => (l.textContent ?? '').trim().toLowerCase().startsWith(name.toLowerCase()));
  if (!label) return { field, ok: false, reason: 'không thấy nhãn trên form' };
  const forId = label.getAttribute('for');
  const input = (forId ? document.getElementById(forId) : label.parentElement?.querySelector('input, textarea')) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!input || isForbidden(input)) return { field, ok: false, reason: 'không tìm thấy ô nhập cạnh nhãn' };
  setNativeValue(input, value);
  return { field, ok: true };
}

// Lấy tên tài khoản eBay đang đăng nhập (để seller xác nhận đúng shop trước khi điền).
export function readAccountName(keys: string[]): string | null {
  const el = findField(keys);
  return el ? (el.textContent ?? '').trim() || null : null;
}

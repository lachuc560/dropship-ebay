// Mục 4.3: validate sau khi AI trả kết quả.
//   - title ≤ 80 ký tự
//   - đủ item specifics bắt buộc của category (lấy từ category_templates)
//   - không chứa từ cấm (lấy từ settings)
//   - description không có <script> hoặc link ra ngoài eBay (mục 1.2)

import type { ListingDraft } from './ai';

export interface ValidateOptions {
  title_max_chars: number;
  banned_words: string[];
  required_specifics: string[];
}

export function validateDraft(draft: ListingDraft, opts: ValidateOptions): string[] {
  const errors: string[] = [];

  if (!draft.title) errors.push('thiếu title');
  if (draft.title.length > opts.title_max_chars) {
    errors.push(`title dài ${draft.title.length} ký tự, vượt ${opts.title_max_chars}`);
  }
  if (draft.title && draft.title === draft.title.toUpperCase() && /[A-Z]/.test(draft.title)) {
    errors.push('title viết HOA toàn bộ');
  }

  for (const key of opts.required_specifics) {
    const v = draft.item_specifics[key];
    if (!v || !String(v).trim()) errors.push(`thiếu item specific bắt buộc: ${key}`);
  }

  const haystack = `${draft.title} ${draft.description_html} ${draft.keywords.join(' ')}`.toLowerCase();
  for (const w of opts.banned_words) {
    if (w && haystack.includes(w.toLowerCase())) errors.push(`chứa từ cấm: ${w}`);
  }

  if (/<script\b/i.test(draft.description_html)) errors.push('mô tả chứa <script>');
  if (/href\s*=\s*["']https?:\/\//i.test(draft.description_html)) errors.push('mô tả chứa link ra ngoài');

  return errors;
}

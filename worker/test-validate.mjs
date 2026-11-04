// Kiểm tra validate của mục 4.3 (chạy: node test-validate.mjs). Giữ đồng bộ với src/validate.ts.

function validateDraft(draft, opts) {
  const errors = [];
  if (!draft.title) errors.push('thiếu title');
  if (draft.title.length > opts.title_max_chars) errors.push(`title dài ${draft.title.length} ký tự, vượt ${opts.title_max_chars}`);
  if (draft.title && draft.title === draft.title.toUpperCase() && /[A-Z]/.test(draft.title)) errors.push('title viết HOA toàn bộ');
  for (const key of opts.required_specifics) {
    const v = draft.item_specifics[key];
    if (!v || !String(v).trim()) errors.push(`thiếu item specific bắt buộc: ${key}`);
  }
  const haystack = `${draft.title} ${draft.description_html} ${draft.keywords.join(' ')}`.toLowerCase();
  for (const w of opts.banned_words) if (w && haystack.includes(w.toLowerCase())) errors.push(`chứa từ cấm: ${w}`);
  if (/<script\b/i.test(draft.description_html)) errors.push('mô tả chứa <script>');
  if (/href\s*=\s*["']https?:\/\//i.test(draft.description_html)) errors.push('mô tả chứa link ra ngoài');
  return errors;
}

const opts = { title_max_chars: 80, banned_words: ['free shipping guaranteed'], required_specifics: ['Brand', 'Type'] };
const good = { title: 'Vitamix Ascent X4 Blender 48 oz', item_specifics: { Brand: 'Vitamix', Type: 'Blender' }, description_html: '<div>Good blender</div>', keywords: ['blender'] };

const cases = [
  ['hợp lệ không lỗi', good, []],
  ['title quá 80 ký tự', { ...good, title: 'a'.repeat(81) }, ['title dài 81 ký tự, vượt 80']],
  ['title viết HOA toàn bộ', { ...good, title: 'VITAMIX BLENDER' }, ['title viết HOA toàn bộ']],
  ['thiếu specific bắt buộc', { ...good, item_specifics: { Brand: 'Vitamix' } }, ['thiếu item specific bắt buộc: Type']],
  ['chứa từ cấm', { ...good, description_html: '<div>free shipping guaranteed</div>' }, ['chứa từ cấm: free shipping guaranteed']],
  ['mô tả có <script>', { ...good, description_html: '<script>x()</script>' }, ['mô tả chứa <script>']],
  ['mô tả có link ra ngoài', { ...good, description_html: '<a href="https://evil.example">x</a>' }, ['mô tả chứa link ra ngoài']],
];

let failed = 0;
for (const [label, draft, expected] of cases) {
  const got = validateDraft(draft, opts);
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(pass ? 'PASS' : 'FAIL', label.padEnd(28), '->', JSON.stringify(got), pass ? '' : `(expected ${JSON.stringify(expected)})`);
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

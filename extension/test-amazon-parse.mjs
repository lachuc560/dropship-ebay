// Kiểm tra logic parse giá, ASIN, currency của adapter Amazon (chạy: node test-amazon-parse.mjs).
// Bản sao thuần JS của hàm trong src/adapters/amazon.ts để chạy được ngoài trình duyệt.
// Giữ đồng bộ với amazon.ts khi sửa logic.

export function parsePrice(raw) {
  const digits = raw.replace(/[^0-9.,]/g, '');
  if (!digits) return undefined;
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized;
  if (lastDot !== -1 && lastComma !== -1) {
    normalized = lastDot > lastComma
      ? digits.replace(/,/g, '')
      : digits.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    const after = digits.length - lastComma - 1;
    normalized = after === 2 && digits.indexOf(',') === lastComma
      ? digits.replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const after = digits.length - lastDot - 1;
    normalized = (digits.indexOf('.') !== lastDot || after === 3)
      ? digits.replace(/\./g, '')
      : digits;
  } else {
    normalized = digits;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function detectCurrency(raw) {
  if (/VND|₫/i.test(raw)) return 'VND';
  if (/US\s*\$|\$/.test(raw)) return 'USD';
  if (/£/.test(raw)) return 'GBP';
  if (/€/.test(raw)) return 'EUR';
  return undefined;
}

export function parseAsin(url) {
  const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : undefined;
}

// [input, expected]
const priceCases = [
  // Giá thật từ ảnh chụp Amazon
  ['$279.00', 279],
  ['$1,199.00', 1199],
  ['VND 18,033,512', 18033512],
  ['VND18,033,512', 18033512],
  ['VND 9,739,823', 9739823],
  ['VND 23,186,312', 23186312],
  // Trường hợp khác
  ['US $12.50', 12.5],
  ['$5', 5],
  ['1.299,99', 1299.99],
  ['1,299.99', 1299.99],
  ['', undefined],
  ['abc', undefined],
];

const currencyCases = [
  ['$279.00', 'USD'],
  ['VND 18,033,512', 'VND'],
  ['VND18,033,512', 'VND'],
  ['£40', 'GBP'],
  ['€40', 'EUR'],
  ['40', undefined],
];

const asinCases = [
  ['https://www.amazon.com/dp/B0C1234567/ref=x', 'B0C1234567'],
  ['https://www.amazon.com/gp/product/b0c1234567?th=1', 'B0C1234567'],
  ['https://www.amazon.com/s?k=shoe', undefined],
];

let failed = 0;
const check = (label, input, got, expected) => {
  const pass = got === expected;
  if (!pass) failed++;
  console.log(pass ? 'PASS' : 'FAIL', label.padEnd(9), JSON.stringify(input).padEnd(44), '->', got, pass ? '' : `(expected ${expected})`);
};
for (const [i, e] of priceCases) check('price', i, parsePrice(i), e);
for (const [i, e] of currencyCases) check('currency', i, detectCurrency(i), e);
for (const [i, e] of asinCases) check('asin', i, parseAsin(i), e);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

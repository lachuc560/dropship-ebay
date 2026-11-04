// Kiểm tra công thức giá mục 4.5 (chạy: node test-pricing.mjs). Giữ đồng bộ với src/pricing.ts.

function roundToEnding(value, ending) {
  if (ending !== '.99') return Math.round(value * 100) / 100;
  const whole = Math.floor(value);
  const candidate = whole + 0.99;
  return candidate >= value ? candidate : whole + 1 + 0.99;
}

function computePrice({ source_price, shipping_cost = 0, settings }) {
  const tax = (source_price + shipping_cost) * settings.tax_estimate_pct;
  const landed_cost = source_price + shipping_cost + tax;
  const raw = (landed_cost * (1 + settings.profit_pct)) / (1 - settings.ebay_fee_pct);
  const sale_price = roundToEnding(raw, settings.price_rounding);
  return { landed_cost, raw, sale_price };
}

const base = { profit_pct: 0.25, ebay_fee_pct: 0.15, tax_estimate_pct: 0, price_rounding: '.99' };
let failed = 0;
const check = (label, got, expected) => {
  const pass = Math.abs(got - expected) < 0.005;
  if (!pass) failed++;
  console.log(pass ? 'PASS' : 'FAIL', label.padEnd(44), '->', got, pass ? '' : `(expected ${expected})`);
};

// 1) Công thức gốc, không làm tròn: 100 × 1.25 ÷ 0.85 = 147.0588...
const r1 = computePrice({ source_price: 100, settings: base });
check('raw: 100 * 1.25 / 0.85 = 147.0588', r1.raw, 147.0588235);
// 2) Làm tròn .99 lên: 147.06 → 147.99
check('round .99: 147.06 -> 147.99', r1.sale_price, 147.99);

// 3) Có ship và thuế: (50 + 10 + 10%*60) = 66; 66 * 1.25 / 0.85 = 97.0588 -> 97.99
const r2 = computePrice({ source_price: 50, shipping_cost: 10, settings: { ...base, tax_estimate_pct: 0.1 } });
check('with ship+tax landed=66', r2.landed_cost, 66);
check('with ship+tax: 66*1.25/0.85 -> 97.99', r2.sale_price, 97.99);

// 4) Giá đúng .99 không bị đẩy thêm: roundToEnding(10.99) = 10.99
check('exact .99 kept: 10.99 -> 10.99', roundToEnding(10.99, '.99'), 10.99);
// 5) Giá sát ngưỡng: 10.995 -> 11.99 (không được thành 10.99 vì thấp hơn giá tính)
check('just above .99: 10.995 -> 11.99', roundToEnding(10.995, '.99'), 11.99);

// 6) Lợi nhuận thực nhận > 0 với giá 147.99: 147.99 - 15%*147.99 - 100 = 25.79
const fee = 147.99 * 0.15;
check('net profit after eBay fee ~ 25.79', 147.99 - fee - 100, 25.79);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

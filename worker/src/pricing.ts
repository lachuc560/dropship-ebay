// Mục 4.5: tính giá bán.
//   Giá bán = (Giá nguồn + Phí ship nguồn + Thuế ước tính) × (1 + % Lợi nhuận) ÷ (1 − % Phí eBay)
// Làm tròn theo kiểu ".99" (ví dụ 123.4 → 122.99 hoặc 123.99 tuỳ quy tắc).

export interface PricingSettings {
  profit_pct: number;     // 0.25 = 25%
  ebay_fee_pct: number;   // 0.15 = 15%
  tax_estimate_pct: number;
  price_rounding: string; // ".99"
}

export interface PriceBreakdown {
  source_price: number;
  shipping_cost: number;
  tax: number;
  landed_cost: number;    // tổng giá vốn
  profit: number;         // lợi nhuận dự kiến (trước phí eBay)
  ebay_fee: number;
  sale_price: number;     // giá bán sau làm tròn
  expected_profit: number;// lợi nhuận thực nhận sau phí eBay
}

// Đọc cấu hình từ bảng settings, thiếu thì dùng mặc định của plan. Trả về số, không đoán khi sai kiểu.
export function parseSettings(rows: Array<{ key: string; value: string }>): PricingSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, fallback: number) => {
    const n = Number(map.get(k));
    return map.has(k) && Number.isFinite(n) ? n : fallback;
  };
  return {
    profit_pct: num('profit_pct', 0.25),
    ebay_fee_pct: num('ebay_fee_pct', 0.15),
    tax_estimate_pct: num('tax_estimate_pct', 0),
    price_rounding: map.get('price_rounding') ?? '.99',
  };
}

// Làm tròn lên về dạng X.99 (kiểu phổ biến cho listing). Ví dụ 123.4 → 123.99; 124.00 → 124.99.
export function roundToEnding(value: number, ending: string): number {
  if (ending !== '.99') return Math.round(value * 100) / 100;
  const whole = Math.floor(value);
  const candidate = whole + 0.99;
  return candidate >= value ? candidate : whole + 1 + 0.99;
}

export function computePrice(input: {
  source_price: number;
  shipping_cost?: number;
  settings: PricingSettings;
}): PriceBreakdown {
  const { source_price, settings } = input;
  const shipping_cost = input.shipping_cost ?? 0;

  if (!Number.isFinite(source_price) || source_price <= 0) {
    throw new Error('giá nguồn không hợp lệ');
  }
  if (settings.ebay_fee_pct >= 1) throw new Error('phí eBay phải nhỏ hơn 100%');

  const tax = (source_price + shipping_cost) * settings.tax_estimate_pct;
  const landed_cost = source_price + shipping_cost + tax;
  const profit = landed_cost * settings.profit_pct;

  // Theo công thức mục 4.5: (giá vốn) × (1 + lợi nhuận) ÷ (1 − phí eBay).
  const raw = (landed_cost * (1 + settings.profit_pct)) / (1 - settings.ebay_fee_pct);
  const sale_price = roundToEnding(raw, settings.price_rounding);

  const ebay_fee = sale_price * settings.ebay_fee_pct;
  const expected_profit = sale_price - ebay_fee - landed_cost;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    source_price: r2(source_price),
    shipping_cost: r2(shipping_cost),
    tax: r2(tax),
    landed_cost: r2(landed_cost),
    profit: r2(profit),
    ebay_fee: r2(ebay_fee),
    sale_price,
    expected_profit: r2(expected_profit),
  };
}

// Tiện ích dùng chung cho mọi adapter nguồn (Amazon, Walmart).
// Thứ tự ưu tiên khi đọc trang (mục 4.1): JSON-LD schema.org/Product trước, CSS selector sau.

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function firstMatch(selectorList: string[]): Element | null {
  for (const sel of selectorList) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Chuyển chuỗi giá thành số. Hỗ trợ:
//   "$1,199.00" -> 1199      (dấu phẩy nghìn, dấu chấm thập phân)
//   "VND 18,033,512" -> 18033512
//   "1.299,99" -> 1299.99    (kiểu châu Âu)
// Trả về undefined nếu không đọc được.
export function parsePrice(raw: string): number | undefined {
  const digits = raw.replace(/[^0-9.,]/g, '');
  if (!digits) return undefined;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized: string;

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

// Nhận diện đơn vị tiền từ ký hiệu. Không đoán nếu không rõ.
export function detectCurrency(raw: string): string | undefined {
  if (/VND|₫/i.test(raw)) return 'VND';
  if (/US\s*\$|\$/.test(raw)) return 'USD';
  if (/£/.test(raw)) return 'GBP';
  if (/€/.test(raw)) return 'EUR';
  return undefined;
}

// Kiểu tối thiểu của schema.org/Product dùng chung.
export interface JsonLdProduct {
  name?: string;
  image?: string | string[] | Array<{ url?: string }>;
  brand?: { name?: string } | string;
  description?: string;
  sku?: string;
  productID?: string;
  offers?:
    | { price?: string | number; priceCurrency?: string; availability?: string }
    | Array<{ price?: string | number; priceCurrency?: string; availability?: string }>;
  aggregateRating?: unknown;
  [key: string]: unknown;
}

// Đọc JSON-LD Product từ trang. Hỗ trợ @graph, mảng, và @type dạng mảng. Trả về null nếu không có.
export function readJsonLdProduct(): JsonLdProduct | null {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const candidates = Array.isArray(data) ? data : (data['@graph'] ?? [data]);
      for (const item of candidates) {
        const type = item?.['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return item as JsonLdProduct;
      }
    } catch {
      // JSON-LD lỗi thì bỏ qua, sẽ dùng selector.
    }
  }
  return null;
}

// Lấy ảnh từ JSON-LD (dạng chuỗi, mảng chuỗi hoặc mảng object có url), bỏ trùng, tối đa 12.
export function imagesFromJsonLd(ld: JsonLdProduct | null): string[] {
  if (!ld?.image) return [];
  const list = Array.isArray(ld.image) ? ld.image : [ld.image];
  const urls = list
    .map((i) => (typeof i === 'string' ? i : i?.url))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
  return Array.from(new Set(urls)).slice(0, 12);
}

// Lấy offer đầu tiên từ JSON-LD (offers có thể là object hoặc mảng).
export function firstOffer(ld: JsonLdProduct | null) {
  if (!ld?.offers) return undefined;
  return Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
}

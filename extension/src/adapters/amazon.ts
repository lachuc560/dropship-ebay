import selectors from '../config/selectors.json';
import type { CrawledProduct } from '../../../shared/types';

// Adapter Amazon: đọc dữ liệu của trang sản phẩm đang mở (1 click = 1 sản phẩm).
// Thứ tự: JSON-LD schema.org/Product trước, rồi mới tới CSS selector (mục 4.1).

const S = selectors.amazon;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstMatch(selectorList: string[]): Element | null {
  for (const sel of selectorList) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Chuyển chuỗi giá thành số. Hỗ trợ:
//   "$1,199.00" -> 1199      (dấu phẩy nghìn, dấu chấm thập phân)
//   "VND 18,033,512" -> 18033512 (đồng, không có phần thập phân)
//   "1.299,99" -> 1299.99    (kiểu châu Âu)
// Trả về undefined nếu không đọc được.
export function parsePrice(raw: string): number | undefined {
  const digits = raw.replace(/[^0-9.,]/g, '');
  if (!digits) return undefined;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized: string;

  if (lastDot !== -1 && lastComma !== -1) {
    // Có cả hai: dấu nào đứng sau là dấu thập phân, dấu còn lại là phân cách nghìn.
    normalized = lastDot > lastComma
      ? digits.replace(/,/g, '')
      : digits.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    // Chỉ có dấu phẩy: nếu đúng 2 chữ số sau cùng thì là thập phân, còn lại là nghìn.
    const after = digits.length - lastComma - 1;
    normalized = after === 2 && digits.indexOf(',') === lastComma
      ? digits.replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (lastDot !== -1) {
    // Chỉ có dấu chấm: tương tự, nhiều dấu chấm hoặc đúng 3 số sau nghìn thì bỏ dấu chấm.
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

// Nhận diện đơn vị tiền từ ký hiệu trên trang. Không đoán nếu không rõ (trả undefined).
export function detectCurrency(raw: string): string | undefined {
  if (/VND|₫/i.test(raw)) return 'VND';
  if (/US\s*\$|\$/.test(raw)) return 'USD';
  if (/£/.test(raw)) return 'GBP';
  if (/€/.test(raw)) return 'EUR';
  return undefined;
}

// Lấy ASIN từ URL: /dp/ASIN hoặc /gp/product/ASIN.
export function parseAsin(url: string): string | undefined {
  const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : undefined;
}

interface JsonLdProduct {
  name?: string;
  image?: string | string[];
  brand?: { name?: string } | string;
  description?: string;
  offers?: { price?: string | number; priceCurrency?: string; availability?: string } | Array<{ price?: string | number; priceCurrency?: string; availability?: string }>;
}

function readJsonLd(): JsonLdProduct | null {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const items = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const item of items) {
        const type = item['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return item as JsonLdProduct;
      }
    } catch {
      // JSON-LD lỗi thì bỏ qua, sẽ dùng selector.
    }
  }
  return null;
}

function collectImages(ld: JsonLdProduct | null): string[] {
  const urls: string[] = [];
  if (ld?.image) urls.push(...(Array.isArray(ld.image) ? ld.image : [ld.image]));
  if (urls.length === 0) {
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(S.images.join(',')))) {
      // Amazon dùng data-old-hires hoặc src; ưu tiên bản độ phân giải cao.
      const src = img.getAttribute('data-old-hires') || img.src;
      if (src && !src.startsWith('data:')) urls.push(src);
    }
  }
  // Bỏ trùng, giữ thứ tự (ảnh chính đứng đầu).
  return Array.from(new Set(urls)).slice(0, 12);
}

// Thông tin giao hàng hiển thị gần khối giá. Chỉ lấy text, không đoán khi trống.
function readShipping(): string | undefined {
  const el = document.querySelector('#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage, #shippingMessageInsideBuyBox_feature_div');
  const t = text(el);
  return t ? t.slice(0, 300) : undefined;
}

function collectSpecs(): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const row of Array.from(document.querySelectorAll(S.specs_rows.join(',')))) {
    const th = row.querySelector('th, span.a-text-bold');
    const td = row.querySelector('td, span:not(.a-text-bold)');
    const key = text(th).replace(/:$/, '');
    const value = text(td);
    if (key && value && key.length < 80) specs[key] = value;
  }
  return specs;
}

export function crawlAmazon(): CrawledProduct | { error: string } {
  const url = location.href;
  const asin = parseAsin(url);
  if (!asin) return { error: 'Không tìm thấy ASIN trong URL. Hãy mở trang chi tiết sản phẩm (/dp/...).' };

  const ld = readJsonLd();
  const offer = Array.isArray(ld?.offers) ? ld?.offers[0] : ld?.offers;

  const title = (ld?.name ?? '') || text(firstMatch(S.title));
  if (!title) return { error: 'Không đọc được tiêu đề sản phẩm.' };

  const priceText = text(firstMatch(S.price));
  const priceRaw = offer?.price != null ? Number(offer.price) : parsePrice(priceText);
  const currency = offer?.priceCurrency ?? detectCurrency(priceText);

  const brandLd = typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name;
  const brand = brandLd || text(firstMatch(S.brand)).replace(/^(Brand:|Visit the|Thương hiệu:)\s*/i, '').replace(/\s*Store$/i, '');

  const bullets = Array.from(document.querySelectorAll(S.bullets.join(',')))
    .map((el) => text(el))
    .filter(Boolean);

  const availText = text(firstMatch(S.availability)).toLowerCase();
  const inStock = offer?.availability
    ? /InStock/i.test(offer.availability)
    : availText ? !/unavailable|out of stock/.test(availText) : undefined;

  const images = collectImages(ld);

  return {
    source: 'amazon',
    source_url: url.split('?')[0],
    source_id: asin,
    title_raw: title,
    price_raw: priceRaw !== undefined && Number.isFinite(priceRaw) ? priceRaw : undefined,
    currency,
    images,
    bullets: bullets.length ? bullets : undefined,
    description_raw: ld?.description || text(firstMatch(S.description)) || undefined,
    specs: collectSpecs(),
    brand: brand || undefined,
    in_stock: inStock,
    shipping_info: readShipping(),
    raw: {
      json_ld: ld,
      url,
    },
  };
}

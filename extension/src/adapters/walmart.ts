import selectors from '../config/walmart-selectors.json';
import type { CrawledProduct } from '../../../shared/types';
import {
  detectCurrency,
  firstMatch,
  firstOffer,
  imagesFromJsonLd,
  parsePrice,
  readJsonLdProduct,
  text,
} from './common';

// Adapter Walmart: đọc trang sản phẩm đang mở (1 click = 1 sản phẩm).
// Thứ tự: JSON-LD schema.org/Product trước, selector dự phòng sau. Không đoán khi thiếu dữ liệu.

// ID sản phẩm Walmart nằm trong URL: /ip/<slug>/<ID> hoặc /ip/<ID>.
export function parseWalmartId(url: string): string | undefined {
  const m = url.match(/\/ip\/(?:[^/]+\/)?(\d{5,})(?:[/?#]|$)/);
  return m ? m[1] : undefined;
}

export function crawlWalmart(): CrawledProduct | { error: string } {
  const url = location.href;
  const id = parseWalmartId(url);
  if (!id) return { error: 'Không tìm thấy ID sản phẩm Walmart trong URL (cần dạng /ip/.../<ID>).' };

  const ld = readJsonLdProduct();
  const offer = firstOffer(ld);

  const title = (ld?.name ?? '') || text(firstMatch(selectors.title));
  if (!title) return { error: 'Không đọc được tiêu đề sản phẩm Walmart.' };

  const priceText = text(firstMatch(selectors.price));
  const priceRaw = offer?.price != null ? Number(offer.price) : parsePrice(priceText);
  const currency = offer?.priceCurrency ?? detectCurrency(priceText);

  const brandLd = typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name;
  const brand = brandLd || text(firstMatch(selectors.brand)) || undefined;

  const bullets = Array.from(document.querySelectorAll(selectors.bullets.join(',')))
    .map((el) => text(el))
    .filter(Boolean);

  const images = imagesFromJsonLd(ld);
  // Ảnh chính đứng đầu: quét theo thứ tự ưu tiên của selector, gom tất cả thumbnail, loại trùng.
  // Lưu ý: không gộp mọi selector vào một query để giữ đúng thứ tự ưu tiên.
  // Loại ảnh gợi ý của sản phẩm khác (productTileImage, responsiveHeader) bằng class của chính ảnh hoặc thẻ cha.
  const excluded = selectors.exclude_images as string[];
  const isExcluded = (img: HTMLImageElement) =>
    excluded.some((cls) => img.classList.contains(cls) || !!img.closest(`.${cls}`));

  const fallbackImages = images.length
    ? images
    : Array.from(new Set(
        selectors.images.flatMap((sel) =>
          Array.from(document.querySelectorAll<HTMLImageElement>(sel))
            .filter((img) => !isExcluded(img))
            .map((img) => img.src)
            .filter((s) => s.startsWith('http') && !s.includes('data:')),
        ),
      )).slice(0, 12);

  const availability = offer?.availability
    ? /InStock/i.test(offer.availability)
    : undefined;

  return {
    source: 'walmart',
    source_url: url.split('?')[0],
    source_id: id,
    title_raw: title,
    price_raw: priceRaw !== undefined && Number.isFinite(priceRaw) ? priceRaw : undefined,
    currency,
    images: fallbackImages,
    bullets: bullets.length ? bullets : undefined,
    description_raw: ld?.description || text(firstMatch(selectors.description)) || undefined,
    brand,
    in_stock: availability,
    raw: { json_ld: ld, url },
  };
}

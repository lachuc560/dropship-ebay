// Format chuẩn cho mọi adapter nguồn (mục 4.1 của plan).
// Dùng chung giữa extension và worker.

export type SourceSite = 'amazon' | 'walmart' | 'ebay';

export interface ProductVariant {
  name: string;          // ví dụ "Size: M"
  price?: number;
}

export interface CrawledProduct {
  source: SourceSite;
  source_url: string;
  source_id: string;     // ASIN (Amazon) / Item ID (eBay) / Walmart ID
  title_raw: string;
  price_raw?: number;
  currency?: string;
  images: string[];      // URL, đúng thứ tự, ảnh chính đứng đầu
  bullets?: string[];
  description_raw?: string;
  specs?: Record<string, string>;
  brand?: string;
  variants?: ProductVariant[];
  in_stock?: boolean;
  shipping_info?: string;
  raw: unknown;          // toàn bộ dữ liệu đọc được, để debug
}

export interface SavedProduct {
  id: number;
  source: SourceSite;
  source_url: string;
  source_id: string;
  title_raw: string;
  price_raw: number | null;
  currency: string | null;
  status: string;
  created_at: string;
}

export type SaveResult =
  | { ok: true; product: SavedProduct; duplicate: false }
  | { ok: true; product: SavedProduct; duplicate: true }
  | { ok: false; error: string };

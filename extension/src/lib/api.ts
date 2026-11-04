import type { CrawledProduct, SavedProduct, SaveResult } from '../../../shared/types';

// Địa chỉ Worker trên Cloudflare (deploy). Đổi về http://127.0.0.1:8787 nếu muốn test local.
export const API_BASE = 'https://dropship-api.chucla27.workers.dev';

export async function saveProduct(product: CrawledProduct): Promise<SaveResult> {
  try {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });
    const data = (await res.json()) as { ok: boolean; duplicate?: boolean; product?: SavedProduct; error?: string };
    if (!res.ok || !data.ok || !data.product) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, product: data.product, duplicate: Boolean(data.duplicate) } as SaveResult;
  } catch (err) {
    return { ok: false, error: `Không kết nối được Worker (${API_BASE}). ${String(err)}` };
  }
}

export async function listProducts(): Promise<SavedProduct[]> {
  const res = await fetch(`${API_BASE}/products?limit=50`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { products: SavedProduct[] };
  return data.products;
}

export interface DraftView {
  title: string | null;
  category_id: string | null;
  item_specifics: string | null;   // JSON
  description_html: string | null;
  price: number | null;
  sku: string;
  validation_errors: string | null; // JSON array
  approved_at: string | null;
}

export async function getDraft(productId: number): Promise<DraftView | null> {
  const res = await fetch(`${API_BASE}/products/${productId}/draft`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { draft: DraftView };
  return data.draft;
}

// Tạo draft bằng AI (Worker gọi Groq, validate, tính giá). Trả về cả khi AI chưa đạt để hiển thị lỗi.
export async function createDraft(productId: number): Promise<{ ok: boolean; errors: string[]; error?: string }> {
  const res = await fetch(`${API_BASE}/products/${productId}/draft`, { method: 'POST' });
  const data = (await res.json()) as { ok: boolean; errors?: string[]; error?: string };
  return { ok: data.ok, errors: data.errors ?? [], error: data.error };
}

// Duyệt draft. Worker chỉ duyệt khi không còn lỗi (mục 4.3).
export async function approveDraft(productId: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/products/${productId}/approve`, { method: 'POST' });
  const data = (await res.json()) as { ok: boolean; error?: string };
  return { ok: data.ok, error: data.error };
}

// Tải ảnh gốc bằng fetch trong trình duyệt (mục 4.2), rồi gửi file lên Worker.
// Trình duyệt dùng cookie/session của trang nguồn nên ít bị chặn hơn server.
export async function downloadAndUploadImage(
  productId: number,
  sourceUrl: string,
  position: number,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const src = await fetch(sourceUrl, { credentials: 'include' });
    if (!src.ok) return { ok: false, error: `tải ảnh lỗi HTTP ${src.status}` };
    const blob = await src.blob();
    if (!blob.type.startsWith('image/')) return { ok: false, error: `không phải ảnh (${blob.type})` };

    const form = new FormData();
    form.append('file', blob, `image-${position}`);
    form.append('position', String(position));

    const res = await fetch(`${API_BASE}/products/${productId}/upload-image`, { method: 'POST', body: form });
    const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, url: data.url };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

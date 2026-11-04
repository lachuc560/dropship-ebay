// Phase 2 (mục 4.2): xử lý và lưu ảnh lên R2.
//   - Chuyển sang JPG, cạnh dài tối đa 1600px, không phóng to ảnh nhỏ hơn.
//   - Xoá metadata (EXIF/GPS): Cloudflare Images không giữ metadata khi xuất JPEG.
//   - Đặt tên theo SKU: {sku}/{thứ-tự}.jpg
//   - Tối đa 12 ảnh mỗi sản phẩm.

export const MAX_IMAGES_PER_PRODUCT = 12;
export const MAX_EDGE_PX = 1600;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // 15 MB mỗi ảnh gốc, tránh tải quá lớn

export interface ProcessedImage {
  position: number;
  r2_key: string;
  url: string;
  width: number | null;
  height: number | null;
}

// Key R2 theo quy ước của plan: {sku}/{thứ-tự}.jpg
export function imageKey(sku: string, position: number): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sku)) throw new Error(`SKU không hợp lệ: ${sku}`);
  return `${sku}/${position}.jpg`;
}

// URL công khai. Nếu chưa cấu hình domain, trả về key tương đối để không đoán URL.
export function publicUrl(base: string, key: string): string {
  return base ? `${base.replace(/\/$/, '')}/${key}` : key;
}

// Tải ảnh gốc từ URL nguồn. Chỉ chấp nhận http(s) và ảnh, có giới hạn kích thước.
export async function fetchSource(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!/^https?:\/\//.test(url)) throw new Error('URL ảnh không hợp lệ');
  // Một số CDN (Wikimedia, Amazon) chặn yêu cầu không có User-Agent rõ ràng.
  const res = await fetch(url, {
    headers: {
      Accept: 'image/*',
      'User-Agent': 'DropshipEbayHelper/0.1 (image pipeline; contact: dev)',
    },
  });
  if (!res.ok) throw new Error(`Tải ảnh lỗi HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) throw new Error(`Không phải ảnh: ${contentType}`);

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('Ảnh rỗng');
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('Ảnh quá lớn');
  return { bytes, contentType };
}

// Resize + chuyển JPG bằng Cloudflare Images binding. Không phóng to ảnh nhỏ (scale-down).
// Cloudflare Images không trả kích thước trong kết quả, nên width/height để null thay vì đoán.
export async function toJpeg(images: ImagesBinding, bytes: ArrayBuffer): Promise<{ data: ArrayBuffer; width: null; height: null }> {
  const result = await images
    .input(new Blob([bytes]).stream())
    .transform({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'scale-down' })
    .output({ format: 'image/jpeg', quality: 85 });

  const data = await result.response().arrayBuffer();
  return { data, width: null, height: null };
}

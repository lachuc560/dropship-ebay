import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_SOURCE_BYTES,
  fetchSource,
  imageKey,
  publicUrl,
  toJpeg,
  type ProcessedImage,
} from './images';
import { generateListing, type ListingDraft } from './ai';
import { computePrice, parseSettings, type PricingSettings } from './pricing';
import { validateDraft } from './validate';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  IMAGES: ImagesBinding;
  ENVIRONMENT: string;
  EBAY_ENV: string;
  PUBLIC_IMAGE_BASE: string;
  // Secret đặt bằng `wrangler secret put GROQ_API_KEY`. KHÔNG để trong wrangler.toml.
  GROQ_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// Extension gọi từ origin chrome-extension:// nên cần CORS.
app.use('*', cors({ origin: (origin) => origin ?? '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'dropship-api',
    environment: c.env.ENVIRONMENT,
    ebay_env: c.env.EBAY_ENV,
  }),
);

app.get('/health/db', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

const SOURCES = ['amazon', 'walmart', 'ebay'] as const;

// Payload đúng format chuẩn của mục 4.1 (shared/types.ts).
interface CrawledProductBody {
  source: string;
  source_url: string;
  source_id: string;
  title_raw: string;
  price_raw?: number | null;
  currency?: string | null;
  images?: string[];
  bullets?: string[];
  description_raw?: string | null;
  specs?: Record<string, string>;
  brand?: string | null;
  variants?: unknown[];
  in_stock?: boolean | null;
  shipping_info?: string | null;
  raw?: unknown;
}

// Chuẩn hoá: giá trị rỗng, chuỗi "null"/"undefined" hay NaN đều thành null thật.
function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || s === 'NaN') return null;
  return s;
}

function cleanNumber(v: unknown): number | null {
  if (v == null || v === '' || v === 'null') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Kiểm tra các trường bắt buộc theo mục 4.1.
function validate(body: Partial<CrawledProductBody>): string | null {
  if (!body.source || !(SOURCES as readonly string[]).includes(body.source)) return 'source không hợp lệ';
  if (!clean(body.source_url)) return 'thiếu source_url';
  if (!clean(body.source_id)) return 'thiếu source_id';
  if (!clean(body.title_raw)) return 'thiếu title_raw';
  return null;
}

// POST /products: lưu sản phẩm đầy đủ theo mục 4.1 và ảnh vào bảng images (theo thứ tự).
// Trùng (source, source_id) thì trả về bản cũ, không tạo bản mới (mục 5).
app.post('/products', async (c) => {
  const body = await c.req.json<Partial<CrawledProductBody>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: 'JSON không hợp lệ' }, 400);

  const err = validate(body);
  if (err) return c.json({ ok: false, error: err }, 400);

  const source = body.source!;
  const sourceId = clean(body.source_id)!;

  const existing = await c.env.DB
    .prepare('SELECT * FROM products WHERE source = ? AND source_id = ?')
    .bind(source, sourceId)
    .first();
  if (existing) return c.json({ ok: true, duplicate: true, product: existing });

  const images = (body.images ?? []).filter((u) => typeof u === 'string' && u.startsWith('http')).slice(0, 12);
  const bullets = (body.bullets ?? []).map((b) => clean(b)).filter((b): b is string => b !== null);
  const specs = body.specs && typeof body.specs === 'object' ? body.specs : {};
  const inStock = typeof body.in_stock === 'boolean' ? (body.in_stock ? 1 : 0) : null;

  // Ghi sản phẩm trước để lấy id, rồi ghi ảnh. Dùng batch cho phần ảnh.
  const product = await c.env.DB
    .prepare(
      `INSERT INTO products
         (source, source_url, source_id, title_raw, price_raw, currency, raw_json, status,
          brand, bullets_json, description_raw, specs_json, in_stock, shipping_info, variants_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'crawled', ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      source,
      clean(body.source_url),
      sourceId,
      clean(body.title_raw),
      cleanNumber(body.price_raw),
      clean(body.currency),
      JSON.stringify({ raw: body.raw ?? null }),
      clean(body.brand),
      JSON.stringify(bullets),
      clean(body.description_raw),
      JSON.stringify(specs),
      inStock,
      clean(body.shipping_info),
      JSON.stringify(body.variants ?? []),
    )
    .first<{ id: number }>();

  if (!product) return c.json({ ok: false, error: 'Không ghi được sản phẩm' }, 500);

  // Ảnh: lưu URL gốc vào bảng images theo thứ tự. Upload lên R2 là việc của Phase 2.
  if (images.length > 0) {
    const stmt = c.env.DB.prepare(
      `INSERT INTO images (product_id, position, r2_key, url) VALUES (?, ?, ?, ?)`,
    );
    await c.env.DB.batch(
      images.map((url, i) => stmt.bind(product.id, i + 1, `pending/${sourceId}/${i + 1}`, url)),
    );
  }

  return c.json({ ok: true, duplicate: false, product, images_saved: images.length }, 201);
});

// GET /products: danh sách sản phẩm đã lưu, mới nhất trước.
app.get('/products', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, source, source_url, source_id, title_raw, price_raw, currency, status, created_at
       FROM products ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return c.json({ ok: true, products: rows.results });
});

// GET /products/:id: chi tiết đầy đủ kèm ảnh, để kiểm tra dữ liệu đã lưu đúng trường.
app.get('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return c.json({ ok: false, error: 'không tìm thấy' }, 404);
  const images = await c.env.DB
    .prepare('SELECT position, url FROM images WHERE product_id = ? ORDER BY position')
    .bind(id)
    .all();
  return c.json({ ok: true, product, images: images.results });
});

// POST /products/:id/upload-image: nhận 1 ảnh đã được extension tải bằng trình duyệt (mục 4.2).
// Form-data: file (ảnh), position (số thứ tự, 1..12). Worker resize/JPG rồi lưu R2 theo {sku}/{position}.jpg.
// Đây là đường chính: trình duyệt đã đăng nhập nên ít bị Amazon chặn hơn server tự tải.
app.post('/products/:id/upload-image', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'id không hợp lệ' }, 400);

  const product = await c.env.DB.prepare('SELECT id, source_id FROM products WHERE id = ?').bind(id).first<{ id: number; source_id: string }>();
  if (!product) return c.json({ ok: false, error: 'không tìm thấy sản phẩm' }, 404);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (err) {
    return c.json({ ok: false, error: `cần multipart/form-data: ${String(err)}`, content_type: c.req.header('content-type') ?? null }, 400);
  }

  const file = form.get('file');
  const position = Number(form.get('position'));
  // Kiểm tra theo khả năng (có arrayBuffer và type) thay vì instanceof, vì kiểu của FormData trong Workers không khớp File.
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return c.json({ ok: false, error: 'thiếu file ảnh' }, 400);
  }
  const blob = file as Blob;
  if (!blob.type.startsWith('image/')) return c.json({ ok: false, error: `không phải ảnh: ${blob.type}` }, 400);
  if (blob.size === 0 || blob.size > MAX_SOURCE_BYTES) return c.json({ ok: false, error: 'ảnh rỗng hoặc quá lớn' }, 400);
  if (!Number.isInteger(position) || position < 1 || position > MAX_IMAGES_PER_PRODUCT) {
    return c.json({ ok: false, error: `position phải từ 1 đến ${MAX_IMAGES_PER_PRODUCT}` }, 400);
  }

  try {
    const key = imageKey(product.source_id, position);
    const jpg = await toJpeg(c.env.IMAGES, await blob.arrayBuffer());

    await c.env.R2.put(key, jpg.data, {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
    });

    const url = publicUrl(c.env.PUBLIC_IMAGE_BASE, key);

    // Ghi/cập nhật ảnh tại đúng vị trí; nếu chưa có dòng thì tạo mới.
    const existing = await c.env.DB
      .prepare('SELECT id FROM images WHERE product_id = ? AND position = ?')
      .bind(id, position)
      .first<{ id: number }>();
    if (existing) {
      await c.env.DB.prepare('UPDATE images SET r2_key = ?, url = ? WHERE id = ?').bind(key, url, existing.id).run();
    } else {
      await c.env.DB
        .prepare('INSERT INTO images (product_id, position, r2_key, url) VALUES (?, ?, ?, ?)')
        .bind(id, position, key, url)
        .run();
    }

    await c.env.DB.prepare("UPDATE products SET status = 'images_ready' WHERE id = ?").bind(id).run();
    return c.json({ ok: true, position, key, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await c.env.DB
      .prepare('INSERT INTO logs (product_id, step, status, message) VALUES (?, ?, ?, ?)')
      .bind(id, 'images', 'error', `ảnh ${position}: ${message}`)
      .run();
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /products/:id/images: Phase 2 (mục 4.2), đường dự phòng: Worker tự tải ảnh từ URL đã lưu.
// Tải ảnh gốc từ URL đã lưu ở bảng images, xử lý (JPG, ≤1600px), lưu R2 theo {sku}/{N}.jpg,
// cập nhật bảng images và chuyển trạng thái sản phẩm sang images_ready.
// Lỗi một ảnh không làm hỏng các ảnh khác: ảnh lỗi được ghi vào logs.
app.post('/products/:id/images', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'id không hợp lệ' }, 400);

  const product = await c.env.DB.prepare('SELECT id, source_id FROM products WHERE id = ?').bind(id).first<{ id: number; source_id: string }>();
  if (!product) return c.json({ ok: false, error: 'không tìm thấy sản phẩm' }, 404);

  // SKU = source_id (ASIN) khi chưa có draft. Draft/SKU riêng sẽ có ở Phase 3.
  const sku = product.source_id;

  const rows = await c.env.DB
    .prepare('SELECT id, position, url FROM images WHERE product_id = ? ORDER BY position LIMIT ?')
    .bind(id, MAX_IMAGES_PER_PRODUCT)
    .all<{ id: number; position: number; url: string }>();

  const results: Array<{ position: number; ok: boolean; url?: string; error?: string }> = [];
  const processed: ProcessedImage[] = [];

  for (const row of rows.results) {
    try {
      const key = imageKey(sku, row.position);
      const src = await fetchSource(row.url);
      const jpg = await toJpeg(c.env.IMAGES, src.bytes);

      await c.env.R2.put(key, jpg.data, {
        httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      });

      const url = publicUrl(c.env.PUBLIC_IMAGE_BASE, key);
      await c.env.DB
        .prepare('UPDATE images SET r2_key = ?, url = ?, width = ?, height = ? WHERE id = ?')
        .bind(key, url, jpg.width || null, jpg.height || null, row.id)
        .run();

      processed.push({ position: row.position, r2_key: key, url, width: jpg.width || null, height: jpg.height || null });
      results.push({ position: row.position, ok: true, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await c.env.DB
        .prepare('INSERT INTO logs (product_id, step, status, message) VALUES (?, ?, ?, ?)')
        .bind(id, 'images', 'error', `ảnh ${row.position}: ${message}`)
        .run();
      results.push({ position: row.position, ok: false, error: message });
    }
  }

  // Chỉ chuyển sang images_ready khi có ít nhất một ảnh thành công.
  if (processed.length > 0) {
    await c.env.DB.prepare("UPDATE products SET status = 'images_ready' WHERE id = ?").bind(id).run();
  }

  return c.json({
    ok: processed.length > 0,
    sku,
    processed: processed.length,
    failed: results.length - processed.length,
    results,
  });
});

// ---------- Phase 3: AI tối ưu listing + tính giá + duyệt (mục 4.3, 4.5) ----------

const MAX_AI_ATTEMPTS = 2; // lần đầu + 1 lần retry khi validate fail

async function loadSettings(db: D1Database): Promise<{ pricing: PricingSettings; raw: Map<string, string> }> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const raw = new Map(rows.results.map((r) => [r.key, r.value]));
  return { pricing: parseSettings(rows.results), raw };
}

// POST /products/:id/draft: tạo draft bằng AI, validate (retry 1 lần), tính giá bán.
app.post('/products/:id/draft', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'id không hợp lệ' }, 400);

  const product = await c.env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(id)
    .first<{ id: number; source_id: string; title_raw: string; brand: string | null; bullets_json: string | null; description_raw: string | null; specs_json: string | null; price_raw: number | null; status: string }>();
  if (!product) return c.json({ ok: false, error: 'không tìm thấy sản phẩm' }, 404);
  if (product.price_raw == null) return c.json({ ok: false, error: 'sản phẩm chưa có giá nguồn, không tính được giá bán' }, 400);

  if (!c.env.GROQ_API_KEY) return c.json({ ok: false, error: 'chưa cấu hình GROQ_API_KEY (wrangler secret put)' }, 500);

  const { pricing, raw } = await loadSettings(c.env.DB);
  const model = raw.get('ai_model') ?? 'llama-3.3-70b-versatile';
  const titleMax = Number(raw.get('title_max_chars') ?? 80);
  const banned = (() => { try { return JSON.parse(raw.get('banned_words') ?? '[]') as string[]; } catch { return []; } })();

  // Mẫu item specifics bắt buộc theo category (nếu đã có). Chưa có thì không ép, nhưng ghi nhận.
  const tpl = await c.env.DB.prepare('SELECT required_specifics FROM category_templates LIMIT 1').first<{ required_specifics: string }>();
  const required: string[] = tpl ? (JSON.parse(tpl.required_specifics) as string[]) : [];

  const input = {
    title_raw: product.title_raw,
    brand: product.brand,
    bullets: product.bullets_json ? (JSON.parse(product.bullets_json) as string[]) : [],
    specs: product.specs_json ? (JSON.parse(product.specs_json) as Record<string, string>) : {},
    description_raw: product.description_raw,
  };

  let draft: ListingDraft | null = null;
  let aiCost = 0;
  let errors: string[] = [];
  let attempts = 0;

  while (attempts < MAX_AI_ATTEMPTS) {
    attempts++;
    try {
      const result = await generateListing(c.env.GROQ_API_KEY, model, input, errors.length ? errors : undefined);
      draft = result.draft;
      aiCost += result.cost_usd;
    } catch (err) {
      errors = [`AI: ${err instanceof Error ? err.message : String(err)}`];
      break;
    }
    errors = validateDraft(draft, { title_max_chars: titleMax, banned_words: banned, required_specifics: required });
    if (errors.length === 0) break;
  }

  const status = errors.length === 0 && draft ? 'ai_done' : 'error';
  const sku = product.source_id;
  const price = computePrice({ source_price: product.price_raw, settings: pricing });

  // Ghi draft (ghi đè nếu đã có cho sản phẩm này).
  const existing = await c.env.DB.prepare('SELECT id FROM drafts WHERE product_id = ?').bind(id).first<{ id: number }>();
  const params = [
    sku,
    draft?.title ?? null,
    draft?.category_suggestion ?? null,
    JSON.stringify(draft?.item_specifics ?? {}),
    draft?.condition ?? 'New',
    draft?.description_html ?? null,
    price.sale_price,
    aiCost,
    JSON.stringify(errors),
    attempts,
    product.price_raw,
  ] as const;

  if (existing) {
    await c.env.DB
      .prepare(`UPDATE drafts SET sku=?, title=?, category_id=?, item_specifics=?, condition=?, description_html=?, price=?, ai_cost=?, validation_errors=?, attempts=?, source_price=?, approved_by=NULL, approved_at=NULL WHERE id=?`)
      .bind(...params, existing.id)
      .run();
  } else {
    await c.env.DB
      .prepare(`INSERT INTO drafts (product_id, sku, title, category_id, item_specifics, condition, description_html, price, ai_cost, validation_errors, attempts, source_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ...params)
      .run();
  }

  await c.env.DB.prepare('UPDATE products SET status = ? WHERE id = ?').bind(status, id).run();
  await c.env.DB
    .prepare('INSERT INTO logs (product_id, step, status, message) VALUES (?, ?, ?, ?)')
    .bind(id, 'ai', status === 'ai_done' ? 'ok' : 'error', errors.length ? errors.join('; ') : `ai_cost=${aiCost.toFixed(5)} attempts=${attempts}`)
    .run();

  return c.json({
    ok: status === 'ai_done',
    status,
    attempts,
    errors,
    ai_cost_usd: Number(aiCost.toFixed(5)),
    pricing: price,
    draft: draft ? { ...draft, sku, price: price.sale_price } : null,
  }, status === 'ai_done' ? 200 : 422);
});

// GET /products/:id/draft: xem draft để side panel hiển thị và chỉnh sửa.
app.get('/products/:id/draft', async (c) => {
  const id = Number(c.req.param('id'));
  const draft = await c.env.DB.prepare('SELECT * FROM drafts WHERE product_id = ?').bind(id).first();
  if (!draft) return c.json({ ok: false, error: 'chưa có draft' }, 404);
  return c.json({ ok: true, draft });
});

// POST /products/:id/approve: người duyệt xác nhận draft. Chỉ duyệt khi draft không có lỗi (mục 4.3).
app.post('/products/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  const draft = await c.env.DB.prepare('SELECT id, validation_errors FROM drafts WHERE product_id = ?').bind(id).first<{ id: number; validation_errors: string | null }>();
  if (!draft) return c.json({ ok: false, error: 'chưa có draft' }, 404);

  const errors = draft.validation_errors ? (JSON.parse(draft.validation_errors) as string[]) : [];
  if (errors.length > 0) return c.json({ ok: false, error: 'draft còn lỗi, không thể duyệt', errors }, 409);

  await c.env.DB.prepare("UPDATE drafts SET approved_at = datetime('now') WHERE id = ?").bind(draft.id).run();
  await c.env.DB.prepare("UPDATE products SET status = 'approved' WHERE id = ?").bind(id).run();
  return c.json({ ok: true, status: 'approved' });
});

export default app;

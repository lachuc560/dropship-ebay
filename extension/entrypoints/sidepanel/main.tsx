import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  approveDraft,
  createDraft,
  downloadAndUploadImage,
  getDraft,
  listProducts,
  saveProduct,
  type DraftView,
} from '../../src/lib/api';
import type { FieldResult } from '../../src/lib/ebay-fill';
import type { CrawledProduct, SavedProduct } from '../../../shared/types';

// Gửi lệnh điền form đến content script eBay Sandbox. Trả về bảng kết quả hoặc lỗi.
async function fillEbayForm(productId: number): Promise<{ results?: FieldResult[]; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang mở');
  if (!tab.url?.includes('sandbox.ebay.com')) throw new Error('Hãy mở trang tạo listing trên sandbox.ebay.com trước.');
  const tabId: number = tab.id;

  const draft = await getDraft(productId);
  if (!draft || !draft.title) throw new Error('Sản phẩm chưa có draft AI hợp lệ. Tạo draft trước.');
  if (draft.validation_errors) {
    const errs = JSON.parse(draft.validation_errors) as string[];
    if (errs.length > 0) throw new Error(`Draft còn lỗi: ${errs.join('; ')}`);
  }

  const payload = {
    title: draft.title,
    sku: draft.sku,
    price: draft.price ?? 0,
    quantity: 1,
    condition: 'New',
    description_html: draft.description_html ?? '',
    item_specifics: draft.item_specifics ? JSON.parse(draft.item_specifics) : {},
  };

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'EBAY_FILL', payload }, (response: { results?: FieldResult[]; error?: string }) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

// Lấy tab đang mở và yêu cầu content script đọc trang Amazon.
// Nếu tab mở trước khi extension được load/reload, content script chưa có mặt:
// khi đó tự inject bằng chrome.scripting rồi gửi lại.
async function crawlActiveTab(): Promise<CrawledProduct> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Không tìm thấy tab đang mở.');
  if (!/^https:\/\/([^/]+\.)?amazon\.com\//.test(tab.url)) {
    throw new Error('Tab hiện tại không phải Amazon. Hãy mở trang sản phẩm Amazon trước khi lưu.');
  }
  const tabId = tab.id;

  const request = () =>
    chrome.tabs.sendMessage(tabId, { type: 'CRAWL_AMAZON' }) as Promise<CrawledProduct | { error: string }>;

  let result: CrawledProduct | { error: string };
  try {
    result = await request();
  } catch {
    // Chưa có content script trong tab này: inject rồi thử lại một lần.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/amazon.js'] });
    result = await request();
  }

  if ('error' in result) throw new Error(result.error);
  return result;
}

const MAX_IMAGES = 12;

function App() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  // Sản phẩm vừa lưu và danh sách URL ảnh gốc (chờ bước tải ảnh).
  const [pending, setPending] = useState<{ id: number; images: string[]; title: string } | null>(null);
  // Draft đang xem: productId + nội dung draft (null nếu chưa có).
  const [draftView, setDraftView] = useState<{ productId: number; draft: DraftView | null } | null>(null);
  // Kết quả điền form eBay (bảng OK/lỗi theo từng trường).
  const [fillResults, setFillResults] = useState<FieldResult[]>([]);

  const refresh = useCallback(async () => {
    try {
      setProducts(await listProducts());
    } catch (err) {
      setMessage({ kind: 'err', text: `Không tải được danh sách: ${String(err)}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave() {
    setBusy(true);
    setMessage({ kind: 'info', text: 'Đang đọc trang...' });
    try {
      const crawled = await crawlActiveTab();
      const result = await saveProduct(crawled);
      if (!result.ok) throw new Error(result.error);
      setMessage(
        result.duplicate
          ? { kind: 'info', text: `Sản phẩm này đã có trong hệ thống (#${result.product.id}).` }
          : { kind: 'ok', text: `Đã lưu: ${result.product.title_raw.slice(0, 60)}` },
      );
      setPending({
        id: result.product.id,
        images: crawled.images.slice(0, MAX_IMAGES),
        title: result.product.title_raw,
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // Tải từng ảnh gốc bằng trình duyệt rồi gửi lên Worker (mục 4.2). Lỗi một ảnh không dừng các ảnh khác.
  async function onUploadImages() {
    if (!pending) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < pending.images.length; i++) {
      setMessage({ kind: 'info', text: `Đang tải ảnh ${i + 1}/${pending.images.length}...` });
      const r = await downloadAndUploadImage(pending.id, pending.images[i], i + 1);
      if (r.ok) ok++;
      else failed.push(`ảnh ${i + 1}: ${r.error}`);
    }
    setMessage(
      failed.length === 0
        ? { kind: 'ok', text: `Đã tải ${ok} ảnh lên.` }
        : { kind: 'err', text: `Tải được ${ok} ảnh. Lỗi: ${failed.join('; ')}` },
    );
    setBusy(false);
    await refresh();
  }

  // Tạo draft AI cho một sản phẩm, rồi tải lại draft để hiển thị.
  async function onCreateDraft(productId: number) {
    setBusy(true);
    setMessage({ kind: 'info', text: `Đang tạo draft cho #${productId} bằng AI...` });
    const r = await createDraft(productId);
    if (!r.ok) {
      setMessage({
        kind: 'err',
        text: r.error ?? `Draft chưa đạt: ${r.errors.join('; ') || 'lỗi không rõ'}`,
      });
    } else {
      setMessage({ kind: 'ok', text: `Draft #${productId} đã sẵn sàng để xem và duyệt.` });
    }
    await showDraft(productId);
    setBusy(false);
    await refresh();
  }

  // Lấy draft của sản phẩm để hiển thị bên dưới danh sách.
  async function showDraft(productId: number) {
    try {
      const d = await getDraft(productId);
      setDraftView({ productId, draft: d });
    } catch (err) {
      setMessage({ kind: 'err', text: `Không tải được draft: ${String(err)}` });
    }
  }

  // Điền form eBay Sandbox cho sản phẩm đã duyệt.
  async function onFillEbay(productId: number) {
    setBusy(true);
    setMessage({ kind: 'info', text: `Đang điền form eBay cho #${productId}...` });
    try {
      const r = await fillEbayForm(productId);
      if (r.error) throw new Error(r.error);
      const okCount = r.results?.filter((f) => f.ok).length ?? 0;
      const failCount = r.results?.filter((f) => !f.ok).length ?? 0;
      setMessage(
        failCount === 0
          ? { kind: 'ok', text: `Đã điền xong #${productId}. ${okCount} trường OK.` }
          : { kind: 'err', text: `#${productId}: ${okCount} OK, ${failCount} lỗi. Xem bảng bên dưới.` },
      );
      setFillResults(r.results ?? []);
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // Duyệt draft đang xem.
  async function onApprove() {
    if (!draftView) return;
    setBusy(true);
    const r = await approveDraft(draftView.productId);
    setMessage(
      r.ok
        ? { kind: 'ok', text: `Đã duyệt #${draftView.productId}.` }
        : { kind: 'err', text: r.error ?? 'Không duyệt được.' },
    );
    await showDraft(draftView.productId);
    setBusy(false);
    await refresh();
  }

  const specifics = draftView?.draft?.item_specifics ? safeJson<Record<string, string>>(draftView.draft.item_specifics) : {};
  const errs = draftView?.draft?.validation_errors ? safeJson<string[]>(draftView.draft.validation_errors) : [];

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, fontSize: 14 }}>
      <h2 style={{ margin: '0 0 8px' }}>Dropship eBay Helper</h2>

      <button onClick={onSave} disabled={busy} style={{ padding: '6px 12px', cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Đang xử lý...' : 'Lưu sản phẩm'}
      </button>

      {pending && (
        <button
          onClick={onUploadImages}
          disabled={busy}
          style={{ padding: '6px 12px', marginLeft: 8, cursor: busy ? 'wait' : 'pointer' }}
        >
          Tải {pending.images.length} ảnh lên
        </button>
      )}

      {message && (
        <p
          style={{
            marginTop: 10,
            color: message.kind === 'err' ? '#b00020' : message.kind === 'ok' ? '#1b5e20' : '#333',
          }}
        >
          {message.text}
        </p>
      )}

      <h3 style={{ margin: '16px 0 6px' }}>Đã lưu ({products.length})</h3>
      <ul style={{ paddingLeft: 16, margin: 0 }}>
        {products.map((p) => (
          <li key={p.id} style={{ marginBottom: 10 }}>
            <div>{p.title_raw}</div>
            <small>
              {p.source} · {p.source_id} · {p.price_raw != null ? `${p.price_raw} ${p.currency ?? ''}` : 'không rõ giá'} ·{' '}
              {p.status}
            </small>
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => onCreateDraft(p.id)}
                disabled={busy}
                style={{ padding: '3px 8px', fontSize: 12, marginRight: 6, cursor: busy ? 'wait' : 'pointer' }}
              >
                Tạo draft AI
              </button>
              <button
                onClick={() => showDraft(p.id)}
                disabled={busy}
                style={{ padding: '3px 8px', fontSize: 12, marginRight: 6, cursor: busy ? 'wait' : 'pointer' }}
              >
                Xem draft
              </button>
              <button
                onClick={() => onFillEbay(p.id)}
                disabled={busy}
                style={{ padding: '3px 8px', fontSize: 12, cursor: busy ? 'wait' : 'pointer' }}
              >
                Điền form eBay
              </button>
            </div>
          </li>
        ))}
      </ul>
      {products.length === 0 && <p style={{ color: '#666' }}>Chưa có sản phẩm nào.</p>}

      {fillResults.length > 0 && (
        <section style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 10 }}>
          <h3 style={{ margin: '0 0 6px' }}>Kết quả điền form</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Trường</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {fillResults.map((f) => (
                <tr key={f.field} style={{ background: f.ok ? 'transparent' : '#ffebee' }}>
                  <td style={{ padding: '2px 4px' }}>{f.field}</td>
                  <td style={{ padding: '2px 4px', color: f.ok ? '#1b5e20' : '#b00020' }}>
                    {f.ok ? 'OK' : `Lỗi: ${f.reason ?? 'không rõ'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {draftView && (
        <section style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 10 }}>
          <h3 style={{ margin: '0 0 6px' }}>Draft #{draftView.productId}</h3>
          {!draftView.draft ? (
            <p style={{ color: '#666' }}>Chưa có draft. Bấm "Tạo draft AI".</p>
          ) : (
            <>
              <p style={{ margin: '4px 0' }}>
                <b>Title</b> ({draftView.draft.title?.length ?? 0}/80): {draftView.draft.title}
              </p>
              <p style={{ margin: '4px 0' }}>
                <b>Giá bán</b>: {draftView.draft.price ?? '—'} · <b>SKU</b>: {draftView.draft.sku}
              </p>
              <p style={{ margin: '4px 0' }}>
                <b>Category gợi ý</b>: {draftView.draft.category_id ?? '—'}
              </p>
              <div style={{ margin: '4px 0' }}>
                <b>Item specifics</b>
                <ul style={{ margin: '2px 0 0 16px', padding: 0 }}>
                  {Object.entries(specifics).map(([k, v]) => (
                    <li key={k}>
                      {k}: {v}
                    </li>
                  ))}
                </ul>
              </div>
              {errs.length > 0 && (
                <p style={{ color: '#b00020', margin: '4px 0' }}>Lỗi kiểm tra: {errs.join('; ')}</p>
              )}
              {draftView.draft.approved_at ? (
                <p style={{ color: '#1b5e20', margin: '4px 0' }}>Đã duyệt lúc {draftView.draft.approved_at}</p>
              ) : (
                <button
                  onClick={onApprove}
                  disabled={busy || errs.length > 0}
                  style={{ padding: '6px 12px', marginTop: 6, cursor: busy || errs.length ? 'not-allowed' : 'pointer' }}
                >
                  Duyệt draft
                </button>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function safeJson<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

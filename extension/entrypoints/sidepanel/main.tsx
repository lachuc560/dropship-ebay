import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  approveDraft,
  clearImages,
  createDraft,
  deleteProduct,
  downloadAndUploadImage,
  getCandidates,
  getDraft,
  listProducts,
  saveProduct,
  setSelection,
  type CandidatesView,
  type DraftView,
} from '../../src/lib/api';
import type { FieldResult } from '../../src/lib/ebay-fill';
import type { CrawledProduct, SavedProduct } from '../../../shared/types';

// ---------- Logic nghiệp vụ (không thay đổi hành vi) ----------

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

// Lấy tab đang mở và yêu cầu content script đọc trang Amazon/Walmart.
// Nếu content script chưa có trong tab (tab mở trước khi load extension), tự inject rồi thử lại.
async function crawlActiveTab(): Promise<CrawledProduct> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Không tìm thấy tab đang mở.');

  const site = /^https:\/\/([^/]+\.)?amazon\.com\//.test(tab.url)
    ? { type: 'CRAWL_AMAZON', file: 'content-scripts/amazon.js' }
    : /^https:\/\/([^/]+\.)?walmart\.com\//.test(tab.url)
      ? { type: 'CRAWL_WALMART', file: 'content-scripts/walmart.js' }
      : null;
  if (!site) {
    throw new Error('Tab hiện tại không phải Amazon hoặc Walmart. Hãy mở trang sản phẩm trước khi lưu.');
  }
  const tabId = tab.id;

  const request = () =>
    chrome.tabs.sendMessage(tabId, { type: site.type }) as Promise<CrawledProduct | { error: string }>;

  let result: CrawledProduct | { error: string };
  try {
    result = await request();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [site.file] });
    result = await request();
  }

  if ('error' in result) throw new Error(result.error);
  return result;
}

const MAX_IMAGES = 12;

// ---------- Giao diện ----------

const COLORS = {
  bg: '#f5f6f8',
  card: '#ffffff',
  border: '#e4e7eb',
  text: '#1f2328',
  muted: '#6b7280',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  success: '#15803d',
  successBg: '#ecfdf3',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  info: '#1e40af',
  infoBg: '#eff6ff',
  warn: '#b45309',
};

// Nhãn và màu cho từng trạng thái sản phẩm.
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  crawled: { label: 'Đã lưu', color: '#374151', bg: '#e5e7eb' },
  images_ready: { label: 'Có ảnh', color: '#1e40af', bg: '#dbeafe' },
  ai_done: { label: 'Có draft', color: '#6d28d9', bg: '#ede9fe' },
  approved: { label: 'Đã duyệt', color: '#166534', bg: '#dcfce7' },
  filled: { label: 'Đã điền', color: '#166534', bg: '#dcfce7' },
  listed: { label: 'Đã đăng', color: '#166534', bg: '#bbf7d0' },
  error: { label: 'Lỗi', color: '#991b1b', bg: '#fee2e2' },
};

const s = {
  page: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 13,
    color: COLORS.text,
    background: COLORS.bg,
    minHeight: '100vh',
    padding: 12,
    boxSizing: 'border-box' as const,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  count: { fontSize: 12, color: COLORS.muted },
  card: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  sectionTitle: { margin: '0 0 8px', fontSize: 13, fontWeight: 600 },
  muted: { color: COLORS.muted, fontSize: 12 },
  row: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' },
};

function btn(variant: 'primary' | 'secondary' | 'danger' | 'ghost', disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '5px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
  };
  if (variant === 'primary') return { ...base, background: COLORS.primary, color: '#fff' };
  if (variant === 'danger') return { ...base, background: COLORS.dangerBg, color: COLORS.danger, borderColor: '#fecaca' };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: COLORS.primary, padding: '4px 6px' };
  return { ...base, background: '#fff', color: COLORS.text, borderColor: COLORS.border };
}

function Badge({ status }: { status: string }) {
  const st = STATUS[status] ?? { label: status, color: '#374151', bg: '#e5e7eb' };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10, color: st.color, background: st.bg }}>
      {st.label}
    </span>
  );
}

function Banner({ kind, text }: { kind: 'ok' | 'err' | 'info'; text: string }) {
  const c = kind === 'ok' ? { fg: COLORS.success, bg: COLORS.successBg } : kind === 'err' ? { fg: COLORS.danger, bg: COLORS.dangerBg } : { fg: COLORS.info, bg: COLORS.infoBg };
  return (
    <div style={{ background: c.bg, color: c.fg, borderRadius: 6, padding: '8px 10px', marginBottom: 10, fontSize: 12, lineHeight: 1.4 }}>
      {text}
    </div>
  );
}

function App() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState<{ id: number; images: string[]; title: string } | null>(null);
  const [draftView, setDraftView] = useState<{ productId: number; draft: DraftView | null } | null>(null);
  const [fillResults, setFillResults] = useState<FieldResult[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cand, setCand] = useState<CandidatesView | null>(null);

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

  async function showDraft(productId: number) {
    try {
      const d = await getDraft(productId);
      setDraftView({ productId, draft: d });
    } catch (err) {
      setMessage({ kind: 'err', text: `Không tải được draft: ${String(err)}` });
    }
  }

  async function onToggleCandidates(productId: number) {
    if (expandedId === productId) {
      setExpandedId(null);
      setCand(null);
      return;
    }
    setExpandedId(productId);
    setCand(null);
    try {
      setCand(await getCandidates(productId));
    } catch (err) {
      setMessage({ kind: 'err', text: `Không tải được danh sách ảnh: ${String(err)}` });
    }
  }

  async function onToggleImage(productId: number, position: number) {
    if (!cand) return;
    const next = cand.images.map((i) => (i.position === position ? { ...i, selected: !i.selected } : i));
    const picked = next.filter((i) => i.selected).map((i) => i.position);
    if (picked.length > cand.max) {
      setMessage({ kind: 'err', text: `Chỉ được chọn tối đa ${cand.max} ảnh.` });
      return;
    }
    setCand({ ...cand, images: next, selected_count: picked.length });
    const r = await setSelection(productId, picked);
    if (!r.ok) setMessage({ kind: 'err', text: r.error ?? 'Không lưu được lựa chọn ảnh.' });
  }

  async function onUploadSelected(productId: number) {
    if (!cand) return;
    const chosen = cand.images.filter((i) => i.selected);
    if (chosen.length === 0) {
      setMessage({ kind: 'err', text: 'Chưa chọn ảnh nào.' });
      return;
    }
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      setMessage({ kind: 'info', text: `Đang tải ảnh ${i + 1}/${chosen.length}...` });
      const r = await downloadAndUploadImage(productId, chosen[i].url, chosen[i].position);
      if (r.ok) ok++;
      else failed.push(`ảnh ${chosen[i].position}: ${r.error}`);
    }
    setMessage(
      failed.length === 0
        ? { kind: 'ok', text: `Đã tải ${ok} ảnh cho #${productId}.` }
        : { kind: 'err', text: `Tải được ${ok}/${chosen.length} ảnh. Lỗi: ${failed.join('; ')}` },
    );
    setBusy(false);
    try {
      setCand(await getCandidates(productId));
    } catch {
      // Giữ nguyên danh sách hiện tại nếu không tải lại được.
    }
    await refresh();
  }

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

  async function onDeleteProduct(p: SavedProduct) {
    const ok = window.confirm(
      `Xoá sản phẩm #${p.id} (${p.source_id})?\n\n${p.title_raw.slice(0, 80)}\n\nẢnh đã tải lên sẽ bị xoá. Không hoàn tác được.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await deleteProduct(p.id);
      if (!r.ok) throw new Error(r.error ?? 'Không xoá được');
      if (draftView?.productId === p.id) setDraftView(null);
      if (pending?.id === p.id) setPending(null);
      if (expandedId === p.id) {
        setExpandedId(null);
        setCand(null);
      }
      setMessage({ kind: 'ok', text: `Đã xoá sản phẩm #${p.id}.` });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRefreshImages(p: SavedProduct) {
    setBusy(true);
    try {
      setMessage({ kind: 'info', text: `Đang lấy ảnh mới cho #${p.id}...` });
      const crawled = await crawlActiveTab();
      if (crawled.source_id !== p.source_id) {
        throw new Error(`Trang đang mở là ${crawled.source_id}, không phải sản phẩm #${p.id} (${p.source_id}). Mở đúng trang rồi thử lại.`);
      }
      const images = crawled.images.slice(0, MAX_IMAGES);
      if (images.length === 0) throw new Error('Không tìm thấy ảnh trên trang. Đã giữ nguyên ảnh cũ.');

      const cleared = await clearImages(p.id);
      if (!cleared.ok) throw new Error(cleared.error ?? 'Không xoá được ảnh cũ');

      let ok = 0;
      const failed: string[] = [];
      for (let i = 0; i < images.length; i++) {
        setMessage({ kind: 'info', text: `Đang tải ảnh ${i + 1}/${images.length}...` });
        const r = await downloadAndUploadImage(p.id, images[i], i + 1);
        if (r.ok) ok++;
        else failed.push(`ảnh ${i + 1}: ${r.error}`);
      }
      setMessage(
        failed.length === 0
          ? { kind: 'ok', text: `Đã cập nhật ${ok} ảnh cho #${p.id}.` }
          : { kind: 'err', text: `Cập nhật ${ok}/${images.length} ảnh. Lỗi: ${failed.join('; ')}` },
      );
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onCreateDraft(productId: number) {
    setBusy(true);
    setMessage({ kind: 'info', text: `Đang tạo draft cho #${productId} bằng AI...` });
    const r = await createDraft(productId);
    if (!r.ok) {
      setMessage({ kind: 'err', text: r.error ?? `Draft chưa đạt: ${r.errors.join('; ') || 'lỗi không rõ'}` });
    } else {
      setMessage({ kind: 'ok', text: `Draft #${productId} đã sẵn sàng để xem và duyệt.` });
    }
    await showDraft(productId);
    setBusy(false);
    await refresh();
  }

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

  async function onApprove() {
    if (!draftView) return;
    setBusy(true);
    const r = await approveDraft(draftView.productId);
    setMessage(r.ok ? { kind: 'ok', text: `Đã duyệt #${draftView.productId}.` } : { kind: 'err', text: r.error ?? 'Không duyệt được.' });
    await showDraft(draftView.productId);
    setBusy(false);
    await refresh();
  }

  const specifics = draftView?.draft?.item_specifics ? safeJson<Record<string, string>>(draftView.draft.item_specifics) : {};
  const errs = draftView?.draft?.validation_errors ? safeJson<string[]>(draftView.draft.validation_errors) : [];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Dropship eBay Helper</h1>
        <span style={s.count}>{products.length} sản phẩm</span>
      </div>

      <div style={{ ...s.card, ...s.row }}>
        <button onClick={onSave} disabled={busy} style={btn('primary', busy)}>
          {busy ? 'Đang xử lý...' : '+ Lưu sản phẩm'}
        </button>
        {pending && (
          <button onClick={onUploadImages} disabled={busy} style={btn('secondary', busy)}>
            Tải {pending.images.length} ảnh lên
          </button>
        )}
      </div>

      {message && <Banner kind={message.kind} text={message.text} />}

      <div style={s.sectionTitle}>Sản phẩm đã lưu</div>
      {products.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', color: COLORS.muted }}>
          Chưa có sản phẩm nào. Mở trang Amazon hoặc Walmart rồi bấm <b>Lưu sản phẩm</b>.
        </div>
      )}

      {products.map((p) => (
        <div key={p.id} style={s.card}>
          <div style={{ fontWeight: 600, lineHeight: 1.35, marginBottom: 4 }}>{p.title_raw}</div>
          <div style={{ ...s.row, marginBottom: 8 }}>
            <Badge status={p.status} />
            <span style={s.muted}>
              {p.source} · {p.source_id}
            </span>
            <span style={{ ...s.muted, marginLeft: 'auto', color: COLORS.text, fontWeight: 600 }}>
              {p.price_raw != null ? `${p.price_raw} ${p.currency ?? ''}` : 'không rõ giá'}
            </span>
          </div>

          <div style={{ ...s.row, marginBottom: 6 }}>
            <button onClick={() => onToggleCandidates(p.id)} disabled={busy} style={btn('secondary', busy)}>
              {expandedId === p.id ? 'Đóng ảnh' : 'Chọn ảnh'}
            </button>
            <button onClick={() => onCreateDraft(p.id)} disabled={busy} style={btn('secondary', busy)}>
              Tạo draft AI
            </button>
            <button onClick={() => onFillEbay(p.id)} disabled={busy} style={btn('primary', busy)}>
              Điền eBay
            </button>
          </div>

          <div style={{ ...s.row, gap: 2 }}>
            <button onClick={() => showDraft(p.id)} disabled={busy} style={btn('ghost', busy)}>
              Xem draft
            </button>
            <button
              onClick={() => onRefreshImages(p)}
              disabled={busy}
              title="Mở đúng trang sản phẩm này trước khi bấm"
              style={btn('ghost', busy)}
            >
              Cập nhật ảnh
            </button>
            <button onClick={() => onDeleteProduct(p)} disabled={busy} style={{ ...btn('ghost', busy), color: COLORS.danger, marginLeft: 'auto' }}>
              Xoá
            </button>
          </div>

          {expandedId === p.id && (
            <div style={{ marginTop: 8, padding: 8, background: COLORS.bg, borderRadius: 6, border: `1px solid ${COLORS.border}` }}>
              {!cand ? (
                <span style={s.muted}>Đang tải danh sách ảnh...</span>
              ) : (
                <>
                  <div style={{ ...s.row, justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12 }}>
                      Có thể lưu <b>{cand.count}</b> ảnh · đã chọn <b>{cand.selected_count}</b>/{cand.max}
                    </span>
                  </div>
                  {cand.count === 0 && (
                    <span style={s.muted}>Chưa có ảnh ứng viên. Hãy lưu lại sản phẩm từ trang gốc.</span>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {cand.images.map((img) => (
                      <label
                        key={img.position}
                        style={{
                          position: 'relative',
                          border: img.selected ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
                          borderRadius: 6,
                          padding: 3,
                          background: '#fff',
                          cursor: busy ? 'wait' : 'pointer',
                          textAlign: 'center',
                          opacity: img.selected ? 1 : 0.6,
                        }}
                      >
                        <img src={img.url} alt={`ảnh ${img.position}`} style={{ width: '100%', height: 52, objectFit: 'contain', display: 'block' }} />
                        <div style={{ fontSize: 11, marginTop: 2 }}>
                          <input
                            type="checkbox"
                            checked={img.selected}
                            disabled={busy}
                            onChange={() => onToggleImage(p.id, img.position)}
                            style={{ margin: 0, verticalAlign: 'middle' }}
                          />{' '}
                          #{img.position}
                          {img.uploaded ? ' ✓' : ''}
                        </div>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => onUploadSelected(p.id)}
                    disabled={busy || cand.selected_count === 0}
                    style={{ ...btn('primary', busy || cand.selected_count === 0), marginTop: 8, width: '100%' }}
                  >
                    Tải {cand.selected_count} ảnh đã chọn
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {fillResults.length > 0 && (
        <div style={s.card}>
          <div style={s.sectionTitle}>Kết quả điền form eBay</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {fillResults.map((f) => (
                <tr key={f.field} style={{ background: f.ok ? 'transparent' : COLORS.dangerBg, borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '4px 6px' }}>{f.field}</td>
                  <td style={{ padding: '4px 6px', color: f.ok ? COLORS.success : COLORS.danger, fontWeight: 500 }}>
                    {f.ok ? 'OK' : `Lỗi: ${f.reason ?? 'không rõ'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draftView && (
        <div style={s.card}>
          <div style={{ ...s.row, justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={s.sectionTitle}>Draft #{draftView.productId}</span>
            <button onClick={() => setDraftView(null)} style={btn('ghost')}>
              Đóng
            </button>
          </div>
          {!draftView.draft ? (
            <span style={s.muted}>Chưa có draft. Bấm "Tạo draft AI".</span>
          ) : (
            <>
              <div style={{ marginBottom: 6, lineHeight: 1.4 }}>
                <b>{draftView.draft.title}</b>
                <div style={s.muted}>{draftView.draft.title?.length ?? 0}/80 ký tự</div>
              </div>
              <div style={{ ...s.row, marginBottom: 6 }}>
                <span>
                  Giá bán: <b>{draftView.draft.price ?? '—'}</b>
                </span>
                <span style={s.muted}>SKU {draftView.draft.sku}</span>
              </div>
              {draftView.draft.category_id && <div style={{ marginBottom: 6 }}>Category: {draftView.draft.category_id}</div>}
              {Object.keys(specifics).length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Item specifics</div>
                  {Object.entries(specifics).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 12 }}>
                      <span style={s.muted}>{k}:</span> {v}
                    </div>
                  ))}
                </div>
              )}
              {errs.length > 0 && <Banner kind="err" text={`Lỗi kiểm tra: ${errs.join('; ')}`} />}
              {draftView.draft.approved_at ? (
                <Banner kind="ok" text={`Đã duyệt lúc ${draftView.draft.approved_at}`} />
              ) : (
                <button onClick={onApprove} disabled={busy || errs.length > 0} style={btn('primary', busy || errs.length > 0)}>
                  Duyệt draft
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function safeJson<T>(str: string): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return {} as T;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Mục 4.3: AI tối ưu listing. Gọi Groq từ backend (key là secret của Worker, không nằm ở extension).
// Groq dùng API tương thích OpenAI. Output ép JSON (response_format = json_object), sau đó validate.
// Không đạt thì gọi lại 1 lần (xem index.ts).

export interface ListingDraft {
  title: string;
  category_suggestion: string;
  item_specifics: Record<string, string>;
  condition: string;
  description_html: string;
  keywords: string[];
}

export interface AiResult {
  draft: ListingDraft;
  cost_usd: number;
  raw_text: string;
}

// Giá tham chiếu (USD / 1M token). Gói miễn phí không tính tiền nên thực tế thường là 0.
const PRICE_PER_MTOK = { input: 0.1, output: 0.3 };

const SYSTEM_PROMPT = `Bạn tối ưu tin đăng eBay (US). Chỉ trả về MỘT object JSON, không có chữ nào khác, đúng schema:
{
  "title": string (tối đa 80 ký tự, keyword chính ở đầu, không VIẾT HOA TOÀN BỘ, không ký tự đặc biệt thừa),
  "category_suggestion": string,
  "item_specifics": object (key-value, ví dụ Brand, Type, Color),
  "condition": "New",
  "description_html": string (HTML đơn giản, KHÔNG có <script>, KHÔNG có link ra ngoài),
  "keywords": string[]
}`;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function generateListing(
  apiKey: string,
  model: string,
  input: { title_raw: string; brand?: string | null; bullets?: string[]; specs?: Record<string, string>; description_raw?: string | null },
  feedback?: string[],
): Promise<AiResult> {
  const userText = [
    `Tiêu đề gốc: ${input.title_raw}`,
    input.brand ? `Thương hiệu: ${input.brand}` : '',
    input.bullets?.length ? `Đặc điểm:\n- ${input.bullets.join('\n- ')}` : '',
    input.specs && Object.keys(input.specs).length ? `Thông số: ${JSON.stringify(input.specs)}` : '',
    input.description_raw ? `Mô tả gốc: ${input.description_raw.slice(0, 2000)}` : '',
    feedback?.length ? `Lần trước chưa đạt, cần sửa: ${feedback.join('; ')}` : '',
  ].filter(Boolean).join('\n');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI lỗi HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  const draft = parseDraftJson(text);

  const inTok = data.usage?.prompt_tokens ?? 0;
  const outTok = data.usage?.completion_tokens ?? 0;
  const cost_usd = (inTok * PRICE_PER_MTOK.input + outTok * PRICE_PER_MTOK.output) / 1_000_000;

  return { draft, cost_usd, raw_text: text };
}

// Lấy JSON từ text trả về. Chấp nhận khi model bọc trong ```json ... ```.
export function parseDraftJson(text: string): ListingDraft {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error('AI không trả về JSON hợp lệ');
  }
  const o = obj as Partial<ListingDraft>;
  return {
    title: typeof o.title === 'string' ? o.title : '',
    category_suggestion: typeof o.category_suggestion === 'string' ? o.category_suggestion : '',
    item_specifics: o.item_specifics && typeof o.item_specifics === 'object' ? (o.item_specifics as Record<string, string>) : {},
    condition: typeof o.condition === 'string' ? o.condition : 'New',
    description_html: typeof o.description_html === 'string' ? o.description_html : '',
    keywords: Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === 'string') : [],
  };
}

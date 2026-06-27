// Gemini request builder — ported VERBATIM from the n8n "Build Gemini request"
// node. The system prompt is the proven asset (hook ≤50 chars, banned phrases,
// copyThreads EN ≤480, copyX EN ≤280, conditional lead-form CTA); do NOT reword.
//
// Source mapping vs the n8n Sheet row:
//   product/angle/leadsForm  ← Campaign  (were Sheet columns)
//   lengthSpec/feedback/status ← Post
import type { PostWithCampaign } from '../db/repos/post-repo.ts';

export interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: Record<string, unknown>;
}

// length keyword/raw-count → Vietnamese length spec (verbatim from n8n).
export function lengthSpecFor(lengthRaw: string): string {
  const l = lengthRaw.trim().toLowerCase();
  if (!l) return 'khoảng 130-220 từ';
  if (['short', 'ngắn', 'ngan'].includes(l)) return 'ngắn gọn, khoảng 80-130 từ';
  if (['medium', 'vừa', 'vua'].includes(l)) return 'khoảng 130-220 từ';
  if (['long', 'dài', 'dai'].includes(l)) return 'dài, khoảng 220-320 từ';
  if (/^\d+$/.test(l)) return `khoảng ${l} từ (cho phép lệch ±15%)`;
  return 'khoảng 130-220 từ';
}

export function buildGeminiBody(post: PostWithCampaign): GeminiRequestBody {
  const product = (post.campaign.product ?? '').trim();
  const angle = (post.campaign.angle ?? '').trim();
  const leadsForm = (post.campaign.leadsForm ?? '').trim();
  const feedback = (post.feedback ?? '').trim();
  const isRework = post.status === 'rework';
  if (!product) throw new Error('mkt_copygen: campaign missing product');

  const lengthSpec = lengthSpecFor(post.lengthSpec ?? '');

  const system = [
    'Bạn là copywriter mạng xã hội cho Data Agentic Solutions (DAIS) — công ty làm nền tảng & giải pháp công nghệ dễ dùng, triển khai gọn, bám vận hành thực tế.',
    'Viết 1 bài đăng Facebook/Threads có tính kéo tương tác cao. Viết như MỘT CON NGƯỜI đang chia sẻ, KHÔNG phải brand đang quảng cáo.',
    'ĐỊNH DẠNG (guardrail cứng): KHÔNG dùng HTML/markdown (không <br>, <b>, **). Chỉ newline thật để tách dòng. Câu ngắn (<20 từ). Nhiều khoảng trắng giữa các dòng cho dễ đọc trên mobile.',
    'CẤU TRÚC NỀN cho copyVi (copyEn dịch tương đương tự nhiên, giữ cùng sức nặng hook): HOOK dòng đầu TỐI ĐA 50 KÝ TỰ (kể cả emoji & dấu câu) — là số/tình huống cụ thể, câu trái chiều, hoặc thừa nhận nỗi đau; không vòng vo, không tên sản phẩm ở hook. Sau đó: dòng trống; re-hook đào sâu; dòng trống; thân 2-3 dòng emoji-led nói KẾT QUẢ vận hành cho con người (không liệt kê tính năng); dòng trống; 1 dòng chốt; 1 câu hỏi CỤ THỂ gây thảo luận (tránh "bạn nghĩ sao?"); 1 CTA duy nhất; dòng cuối 4-6 hashtag bắt đầu #DAIS.',
    `YÊU CẦU ĐỘ DÀI: copyVi ${lengthSpec}. Tổng 4-6 emoji. TUYỆT ĐỐI tránh sáo rỗng và các từ: "giải pháp đột phá", "khám phá", "thay đổi cuộc chơi", "nâng tầm", "tối ưu hiệu suất tức thì". Không bịa số liệu, KHÔNG bịa % hay con số nếu brief không cung cấp, không hứa hẹn quá mức.`,
    'BẢN THREADS RIÊNG (copyThreads): viết MỘT phiên bản RÚT GỌN tự thân cho Threads, TỐI ĐA 480 ký tự (mục tiêu 300-450). KHÔNG cắt từ copyVi — viết lại: 1 hook mạnh ≤50 ký tự, 1-2 dòng thân nói kết quả, 1 câu chốt + 1 CTA, 2-3 hashtag #DAIS. Phải đứng được như một post hoàn chỉnh, không cụt câu, không thiếu CTA. VIẾT BẰNG TIẾNG ANH (Threads audience chủ yếu dùng tiếng Anh) — KHÔNG dùng tiếng Việt; giữ cùng thông điệp & sức nặng hook như copyVi nhưng diễn đạt tự nhiên bằng tiếng Anh.',
    'BẢN X/TWITTER RIÊNG (copyX): viết MỘT tweet tự thân cho X, TỐI ĐA 280 KÝ TỰ (kể cả emoji/hashtag) — KHÔNG được vượt 280. 1 hook ≤50 ký tự, 1 câu giá trị, 1 CTA ngắn (vd "link in bio"), 1-2 hashtag #DAIS. KHÔNG chèn URL thật vào text (X tính phí cao cho post có link). VIẾT BẰNG TIẾNG ANH, đứng độc lập, không cụt câu.',
    'ƯU TIÊN BRIEF: Nếu phần "Góc tiếp cận (angle)" có yêu cầu riêng về bố cục / giọng / cách kể / điểm nhấn → TUÂN THEO brief đó (linh hoạt cấu trúc nền), MIỄN vẫn giữ guardrail cứng (không HTML, hook ≤50 ký tự, tránh sáo rỗng, đúng độ dài). Angle ưu tiên cao hơn cấu trúc nền.',
  ];
  if (leadsForm) {
    system.push(
      `LINK THU LEAD: bài này có form thu lead = ${leadsForm}. Trong CTA của copyVi, copyEn VÀ copyThreads, dùng ĐÚNG link này (viết nguyên URL) làm lời kêu gọi để lại thông tin / đăng ký — KHÔNG dùng "link in bio" cho 3 bản đó. copyThreads vẫn phải ≤480 ký tự KỂ CẢ link (rút gọn phần thân để chừa chỗ cho URL, không cụt câu). RIÊNG copyX: TUYỆT ĐỐI KHÔNG chèn URL thật (X tính phí cao cho link) — giữ "link in bio". Mỗi bản chỉ 1 CTA, không spam link.`,
    );
  }
  const systemText = system.join('\n');

  let user = `Sản phẩm/dịch vụ: ${product}\nGóc tiếp cận (angle): ${angle || '(tự chọn góc phù hợp, nhấn lợi ích vận hành)'}\nViết copyVi và copyEn.`;
  if (isRework && feedback) {
    user += `\n\nLƯU Ý: bản trước đã bị TỪ CHỐI. Feedback của người duyệt: "${feedback}". Hãy viết lại để KHẮC PHỤC đúng các điểm này, đừng lặp lại lỗi cũ.`;
  } else if (isRework) {
    user += `\n\nLƯU Ý: bản trước đã bị từ chối (không có ghi chú cụ thể). Hãy viết một phiên bản KHÁC HẲN về hook và cách tiếp cận.`;
  }

  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          copyVi: { type: 'STRING' },
          copyEn: { type: 'STRING' },
          copyThreads: { type: 'STRING' },
          copyX: { type: 'STRING' },
        },
        required: ['copyVi', 'copyEn', 'copyThreads', 'copyX'],
      },
    },
  };
}

# Atria — Kế hoạch MVP (Marketing Flow + Leads)

> **Đây là gì?** Kế hoạch triển khai MVP để merge vào dự án code hiện tại. MVP = luồng marketing trọn vẹn (vertical slice) + Lead Collector.
>
> **Phạm vi:** 8 agent trong luồng marketing, xếp theo thứ tự xây dựng hợp lý.
>
> **Cách dùng:** đọc từ trên xuống. Mỗi giai đoạn xây trên nền giai đoạn trước.

> 📘 *Vertical slice (lát cắt dọc):* làm trọn vẹn MỘT luồng từ đầu đến cuối, thay vì nửa vời nhiều luồng.
> 📘 *Build order (thứ tự xây dựng):* trình tự làm sao cho phần trước hỗ trợ phần sau.

---

## Tổng quan luồng MVP

Luồng đầu-cuối mà MVP phải chạy được:

**Người dùng ra lệnh → Atria hiểu → chuẩn bị nội dung → đăng bài → thu thập leads**

Chi tiết 8 agent theo chuỗi:

- Memory (nền) → Product Expert (hiểu sản phẩm) → Researcher (nghiên cứu) → Strategist (chiến lược) → Editor (viết) → Publisher (đăng) → Lead Collector (thu leads)

---

## Thứ tự xây dựng: 4 lớp

### 🏗️ Lớp 1 — Nền móng (xây trước tiên)

Đây là phần mọi agent khác dựa vào. Không có lớp này, các agent khác không hoạt động tốt.

- **Memory Agent**
  - Vai trò: lưu hồ sơ người dùng &amp; sản phẩm, cho mọi agent tham chiếu.
  - Cần: database (✅ đã có trong backbone).
  - Quyết định đã chốt: lưu chọn lọc theo thói quen; hỏi trước khi xóa; người dùng xem/sửa có giới hạn.
  - **Việc cần làm:** thiết lập cấu trúc lưu hồ sơ + cơ chế đọc/ghi cho agent khác.

- **Product Expert Agent**
  - Vai trò: học &amp; nắm sản phẩm của người dùng (điểm khác biệt của Atria).
  - Cách hoạt động: kích hoạt theo ngữ cảnh, tự đánh giá khi nào đủ, người dùng xác nhận.
  - **Việc cần làm:** cơ chế hỏi-học qua hội thoại + ghi vào Memory.

> 💡 Lý do xây trước: đây là "bộ nhớ" và "hiểu biết nền" — mọi agent sau đều cần đọc từ đây.

### 🧠 Lớp 2 — Chuẩn bị (xây thứ hai)

Phần "suy nghĩ" tạo ra chiến lược &amp; định hướng.

- **Researcher Agent**
  - Vai trò: nghiên cứu thị trường &amp; đối thủ.
  - Nguồn dữ liệu (đã chốt): web search + người dùng cung cấp (giai đoạn đầu).
  - **Việc cần làm:** kết nối web search + nhận tài liệu người dùng → tạo báo cáo insight.

- **Strategist Agent**
  - Vai trò: lập chiến lược marketing + chấm điểm leads.
  - Chấm điểm (đã chốt): người dùng tự định nghĩa tiêu chí + có gợi ý sẵn.
  - **Việc cần làm:** tạo chiến lược từ insight + cơ chế chấm điểm leads tùy chỉnh.

### ✍️ Lớp 3 — Sản xuất &amp; đăng (xây thứ ba)

Phần tạo ra kết quả người dùng thấy được.

- **Editor Agent**
  - Vai trò: viết nội dung marketing (bài đăng, email).
  - Giọng văn (đã chốt): viết mẫu ngắn → người dùng duyệt → viết hàng loạt.
  - **Việc cần làm:** sinh nội dung theo chiến lược + bước duyệt giọng văn.

- **Publisher Agent**
  - Vai trò: đăng nội dung lên nền tảng social.
  - Thời điểm đăng (đã chốt): Atria đề xuất giờ tối ưu → người dùng duyệt.
  - Tình trạng: ✅ đã chạy được trong backbone.
  - **Việc cần làm:** wire-up với luồng mới + bước duyệt trước khi đăng + gợi ý giờ tối ưu.
  - **An toàn:** Approval Gate, Preview, Rate Limit theo gói.

### 🎯 Lớp 4 — Thu thập kết quả (xây thứ tư)

Phần biến hoạt động marketing thành giá trị kinh doanh.

- **Lead Collector Agent**
  - Vai trò: thu thập leads — CHỈ từ người opt-in.
  - Nguồn opt-in (đã chốt): form, import, comment từ khóa (vd "Atria AI").
  - Lưu trữ &amp; bảo mật (đã chốt): database sẵn có + 3 nguyên tắc (mã hóa, phân quyền, không lưu thừa).
  - Tình trạng: ⏳ đang làm trong backbone.
  - **Việc cần làm:** hoàn thiện cơ chế thu thập opt-in + lưu bảo mật.
  - ⚠️ *Cần dev hiểu bảo mật hoặc tư vấn chuyên môn.*

---

## Phần điều phối (Orchestration) — xây song song

Ngoài 8 agent, MVP cần "bộ não" điều phối của Atria (đây là phần bạn đang refactor):

- **Luồng 3 giai đoạn** (đã có tài liệu riêng): Hiểu &amp; chọn → Sắp xếp &amp; chạy → Gom &amp; hiển thị.
- **2 điểm chốt người dùng:** xác nhận đầu việc + duyệt phương án.
- **Phương án nhiều mức:** đưa 2-3 phương án kèm ước tính token &amp; credit.

> Đây là phần bạn đã xác định là trọng tâm refactor. Kế hoạch agent ở trên "cắm" vào luồng điều phối này.

---

## Phần chi phí &amp; an toàn — bắt buộc trong MVP

Không phải agent, nhưng bắt buộc có để MVP an toàn &amp; bền vững:

- **Mô hình credit:** ước tính trước khi chạy + hiển thị chi phí (đã có tài liệu).
- **5 lớp an toàn:** Approval Gate, Rate Limit, Preview, Kill Switch, Audit Log (đã có tài liệu).
- **Duyệt thủ công** mọi hành động thật (đăng/gửi/thu thập).

---

## Bảng tổng hợp: thứ tự &amp; trạng thái

| Lớp | Agent | Tình trạng backbone | Việc chính |
|---|---|---|---|
| 1 | Memory | ✅ database có | Cấu trúc lưu hồ sơ |
| 1 | Product Expert | 🔧 mới | Hỏi-học qua hội thoại |
| 2 | Researcher | 🔧 mới | Web search + tài liệu |
| 2 | Strategist | 🔧 mới | Chiến lược + chấm điểm |
| 3 | Editor | 🔧 mới | Sinh nội dung + duyệt giọng văn |
| 3 | Publisher | ✅ đã chạy | Wire-up + duyệt trước đăng |
| 4 | Lead Collector | ⏳ đang làm | Thu opt-in + bảo mật |
| — | Orchestration | 🔧 đang refactor | Luồng 3 giai đoạn + 2 điểm chốt |

---

## Gợi ý cách tiếp cận khi implement (cho PM)

- **Bắt đầu từ Lớp 1** (Memory + Product Expert) — vì mọi thứ dựa vào đây.
- **Test từng lớp** trước khi sang lớp sau (đảm bảo nền vững).
- **Publisher đã chạy** → wire-up sớm để thấy kết quả nhanh, tạo động lực.
- **Lead Collector để gần cuối** → vì cần bảo mật cẩn thận, không vội.
- **Orchestration làm song song** → vì nó là "chất keo" nối mọi agent.

> 📘 *Iterative development (phát triển lặp):* làm từng phần nhỏ, test, rồi mở rộng. An toàn hơn làm hết một lúc.

---

## Câu hỏi cần rà soát với dev (feasibility)

Khi merge vào code, cùng dev kiểm tra:

- Cấu trúc Memory hiện tại có đủ linh hoạt cho hồ sơ người dùng &amp; sản phẩm không?
- Luồng điều phối mới có khớp với backbone đang có không?
- Product Expert (kích hoạt theo ngữ cảnh) implement thế nào trong hệ thống hiện tại?
- Bảo mật Lead Collector cần thêm gì so với hiện tại?

> 📘 *Feasibility check:* xác nhận ý tưởng làm được về kỹ thuật/thời gian. PM làm việc này CÙNG dev.

---

*Kế hoạch MVP xây dựng cùng bạn, dựa trên toàn bộ quyết định đã chốt. Sẵn sàng để merge vào dự án code cho v2.*

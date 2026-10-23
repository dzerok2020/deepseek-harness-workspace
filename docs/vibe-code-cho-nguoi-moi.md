# Vibe Code Cho Người Mới — Hệ Thống Của Bạn (bản tối ưu)

> Viết riêng cho bạn ngày 06/10/2026, dựa trên video *「如何使用 AI 写代码」* + cẩm nang
> *Quy Trình Vibe Coding Thực Chiến* + trạng thái thật của hệ thống DeepSeek Harness này
> (đã kiểm chứng từng mục trên máy, không phải lý thuyết).

---

## 1. Bạn đã có gì sẵn (đã kiểm chứng trên máy)

| Thành phần | Việc nó làm giúp bạn | Khi nào dùng |
|---|---|---|
| Skill `four-phase-build` | Điều phối trọn quy trình 4 pha lấy **nguyên văn từ video bạn xem** | Bắt đầu dự án mới |
| Skill `four-phase-env-setup` → `product-plan` → `tech-plan` → `implement` | Từng bước: Git+AGENTS.md → MVP → Tech → Code+test | Được gọi tự động khi đi theo quy trình |
| Plugin `dsh-vibe-guard` (đang bật) | Chặn lệnh phá huỷ (`git push --force`, `rm -rf ~`…) và **ép AI chạy test thật đạt rồi mới được báo "xong"** | Luôn chạy ngầm |
| Skill `webapp-testing` + plugin `browser-skill` | AI tự mở app, bấm thử, chụp màn hình — "Chrome plugin" mà video nhắc | Bước 4 (tự test) |
| Skill `prompt-intake` | Hiểu tiếng Việt thô, viết tắt, không dấu — không cần viết prompt chuẩn | Mọi lúc |
| Skill `handoff` / `retro` / `code-review` | Lưu tiến độ giữa chừng, tổng kết buổi làm, soi lại code | Khi phiên dài / kết buổi |
| Git, Node, Python, Playwright | Đã cài và chạy được trên máy này | Bước 1 & 4 |
| CLI `graphify` (gói `graphifyy`) | Vẽ đồ thị hàm/file từ mã nguồn, không cần AI. Hỏi: `graphify explain "tên"` hoặc `graphify god-nodes` | Khi code đã nhiều, muốn biết hàm nào nối với hàm nào |
| Skill `ponytail` | Bắt AI sửa ít nhất có thể, không thêm thư viện cho vài dòng code | Mọi lần viết hoặc sửa code |

**Kết luận:** hệ thống đã đáp ứng đủ quy trình 5 bước. Việc của bạn chỉ là đi đúng lộ trình và giữ vai trò **người nghiệm thu cuối cùng**.

---

## 2. Quy trình 5 bước → lệnh mẫu để bạn gõ (copy-paste được)

### Bước 1 — Dựng môi trường
Gõ: **"Tôi muốn làm app đọc sách TXT đơn giản. Dựng môi trường theo quy trình 4 bước."**
→ AI sẽ: tạo thư mục dự án, `git init`, viết `AGENTS.md` (luật: mỗi thay đổi 1 commit + phải test trước khi giao), commit đầu tiên.

### Bước 2 — Chốt sản phẩm (MVP)
Gõ: **"Lên phương án sản phẩm."**
→ AI sẽ hỏi bạn chọn (a/b) thay vì tự đoán. Bạn chỉ cần trả lời câu hỏi về:
- **Giữ ở MVP:** tính năng cốt lõi nhất (vd: đọc file .txt, cuộn dọc, tự lưu vị trí đọc)
- **Hoãn lại:** mọi thứ hay nhưng không thiết yếu (EPUB, dark mode, mục lục…)
- **Có làm Demo HTML không:** app nặng backend → làm; app đơn giản → bỏ qua

Kết quả: file `docs/product-plan.md` — "kim chỉ nam" chống lệch hướng.

### Bước 3 — Chốt kỹ thuật
Mở **phiên mới** (để não AI sạch), gõ: **"Đọc docs/product-plan.md và chọn phương án kỹ thuật."**
→ AI so sánh ưu/nhược (Electron vs Tauri, React+Vite+TS…), bạn chọn (a/b), ra `docs/tech-plan.md`.

### Bước 4 — Triển khai (AI tự test)
Gõ: **"Triển khai."**
→ AI đọc 2 file plan, code từng lát nhỏ, mỗi lát: viết test → chạy test → commit. Plugin vibe-guard không cho AI nói "xong" khi chưa có lệnh test **đạt**. Bạn sẽ thấy bảng tiến độ từng lát.

### Bước 5 — Nghiệm thu bằng tay (phần của BẠN)
Chạy app thật (`npm start`…), thử như người dùng bình thường. Gặp lỗi → **paste nguyên văn thông báo lỗi** vào chat kèm mô tả hành vi sai ("bị lỗi rồi: khi bấm nút X thì không có gì xảy ra, log: ..."). Nhờ có Git, AI sửa không phá tính năng cũ.

---

## 3. Dự án đang sống: sửa lỗi, thêm chức năng, cải tiến

Quy trình 5 bước ở trên là cho **dự án mới**. Khi dự án đã chạy, mỗi loại việc có đường đi ngắn hơn — nhưng luật `AGENTS.md` vẫn y nguyên: **mỗi thay đổi 1 commit + toàn bộ test đạt trước khi báo xong** (vibe-guard vẫn canh chừng).

### Sửa lỗi (bug) — 4 nhịp đập
1. **Báo đúng cách:** paste nguyên văn thông báo lỗi + nói rõ "đang làm gì / mong đợi gì / thực tế xảy ra gì".
2. Gõ: **"Tái hiện lỗi này bằng test trước, chưa sửa vội."** — AI viết 1 test chạy ra đúng lỗi đó (không sửa mò). Skill `systematic-debugging` dẫn AI đi lần lượt: tái hiện → giả thuyết → thử nghiệm.
3. Gõ: **"Sửa cho test này pass."** — sửa nhỏ, có chủ đích.
4. Gõ: **"Chạy toàn bộ test rồi commit."** — commit kiểu `fix: <mô tả>`. Giữ lại test vừa viết — đó là "vaccine" giúp lỗi không bao giờ tái phát.

### Thêm chức năng mới
- Gõ: **"Tôi muốn thêm <X>. Ước lượng giúp việc nhỏ hay lớn?"**
- **Việc nhỏ** (xong trong 1 buổi): chu trình mini — nói rõ hành vi mong muốn → test trước → code → toàn bộ test đạt → commit `feat: <mô tả>`.
- **Việc lớn:** cập nhật `docs/product-plan.md` trước (gõ: **"cập nhật plan cho tính năng <X> rồi mới code"**) — tránh kế hoạch lệch khỏi kim chỉ nam.
- **Nâng cấp tính năng có sẵn** (đổi cách nó hoạt động): coi như "thêm hành vi mới" — viết test cho hành vi mới trước rồi mới sửa; ảnh hưởng lớn thì cập nhật plan trước.
- Dù nhỏ hay lớn, luôn yêu cầu: **"chạy TOÀN BỘ test, không chỉ test mới"** — để chắc không phá tính năng cũ.

### Cải tiến / nâng cấp (refactor)
- Phân biệt 3 việc dễ nhầm: **sửa lỗi** = hành vi sai → đúng; **thêm chức năng** = hành vi mới; **refactor** = hành vi *giữ nguyên*, code sạch hơn.
- Quy tắc vàng: **không trộn refactor với thêm tính năng trong 1 commit** — mỗi việc một commit, hỏng gì rollback đúng cái đó.
- Gõ: **"Refactor <phần Y>, không được đổi hành vi — sau mỗi bước chạy test."**
- Nâng cấp thư viện/dependency: từng gói một, mỗi gói 1 commit riêng (hỏng thì khoanh vùng được ngay).

### Bảng chọn nhanh — việc gì gõ đó

| Tình huống | Bạn gõ | AI sẽ làm |
|---|---|---|
| Dự án mới từ con số 0 | "Dựng môi trường theo quy trình 4 bước" | Chạy trọn 5 bước ở phần 2 |
| Sửa lỗi | "bị lỗi rồi: <paste log>" | Tái hiện bằng test → sửa → toàn bộ test đạt |
| Thêm chức năng nhỏ | "thêm <X>" | Chu trình mini: test trước → code → commit |
| Thêm chức năng lớn | "cập nhật plan cho <X> rồi mới code" | Sửa product-plan → kỹ thuật → code |
| Cải tiến / nâng cấp | "refactor <Y>, giữ nguyên hành vi" | Mỗi bước chạy test, hành vi không đổi |
| Kết buổi làm | "retro" | Tổng kết, rút kinh nghiệm |

---

## 4. Lộ trình nâng cao kỹ năng (mục tiêu của bạn)

### Cấp 1 — Tuần lễ đầu: "Chạy được quy trình" ✅ mục tiêu của bạn ngay bây giờ
- Làm trọn 5 bước với **app nhỏ thật** (todo list, đọc TXT, tính tiền bữa ăn…).
- Kỷ luật duy nhất phải nhớ: **không one-shot prompting** ("làm app đọc sách" một câu rồi ngồi chờ) — đó là cạm bẫy số 1 trong cẩm nang.
- Sau mỗi buổi: gõ **"retro"** — AI tổng kết buổi làm giúp bạn rút kinh nghiệm.

### Cấp 2 — "Hiểu mình đang duyệt gì" (sau 2–4 dự án nhỏ)
- Trước khi nghiệm thu, gõ: **"giải thích thay đổi này cho tôi"** — AI giải thích diff bằng tiếng Việt.
- Học yêu cầu **test trước**: gõ "viết test trước rồi mới code" (skill `tdd`).
- Gõ: **"review code này"** — để AI tự soi trước khi bạn duyệt (skill `code-review`).
- Bắt đầu tự sửa lỗi nhỏ: xem AI debug bằng skill `systematic-debugging`, học cách nó đặt giả thuyết.

### Cấp 3 — "Tự thiết kế được" (dần dần)
- Đọc/hiểu kiến trúc: skill `codebase-design`, `domain-modeling`, `improve-codebase-architecture`.
- Quyết định lưu vết: skill `recording-architecture-decisions` (ADR).
- Nâng cao: `security` (`code-security-audit`), `performance-optimization`, `ci-cd-and-automation`.
- Khi muốn "khó tính hơn": gõ **"grill this plan"** — AI phản biện kế hoạch của bạn trước khi code (skill `grilling`).

---

## 5. Từ điển 60 giây cho người mới

| Thuật ngữ | Nghĩa ngắn gọn |
|---|---|
| **commit** | "Chụp ảnh" trạng thái code tại một thời điểm, để rollback được |
| **rollback** | Quay về commit cũ khi bản mới hỏng |
| **MVP** | Bản nhỏ nhất nhưng dùng được thật |
| **test / unit test** | Đoạn code tự động kiểm tra code khác có đúng không |
| **lint / typecheck** | Máy soi lỗi style / sai kiểu dữ liệu trước khi chạy |
| **build** | Biến mã nguồn thành chương trình chạy được |
| **diff** | Bảng so sánh code trước/sau khi AI sửa |
| **AGENTS.md** | "Luật nhà" đặt ở gốc dự án, AI đọc đầu mỗi phiên |
| **edge-case** | Tình huống biên hiếm gặp (file rỗng, mạng đứt…) |

---

## 6. 4 lỗi người mới hay mắc — và hệ thống này đã chắn giúp bạn

1. **One-shot prompting** → Hệ thống: quy trình 4 bước buộc chốt MVP trước khi code.
2. **Tin AI "tôi đã xong"** → vibe-guard **không cho đóng phiên** khi chưa có lệnh test đạt (bạn đã thấy nó hoạt động ở lượt trước).
3. **Sợ lệnh phá huỷ** → vibe-guard chặn trước `git push --force`, `reset --hard`, `rm -rf`…
4. **Gõ prompt sai chính tả lo AI hiểu nhầm** → skill `prompt-intake` + luật ngôn ngữ trong AGENTS.md hiểu tiếng Việt thô, không bắt lỗi.

---

## 7. Mẹo prompt cho người Việt (đã cấu hình sẵn)

- Gõ tự nhiên: "làm giúp", "bị lỗi rồi", "sửa giúp", "đẹp hơn", "chậm quá" — hệ thống tự hiểu.
- Khi mơ hồ, AI sẽ nêu 2 phương án (a/b) kèm mặc định — chỉ cần gõ "a" hoặc "b".
- Kỹ thuật giữ tiếng Anh chuẩn: commit, branch, skill, plugin, cache… đừng dịch máy móc.

---

*File này sống tại `docs/vibe-code-cho-nguoi-moi.md`. Khi bạn lên cấp 2, yêu cầu AI cập nhật lại cho phù hợp trình độ mới.*

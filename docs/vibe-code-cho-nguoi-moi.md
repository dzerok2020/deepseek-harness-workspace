# Vibe Code Cho Người Mới — Hệ Thống Của Bạn (bản tối ưu)

> Viết riêng cho bạn ngày 06/10/2026, cập nhật hiện trạng ngày 24/10/2026, dựa trên video
> *「如何使用 AI 写代码」* + cẩm nang *Quy Trình Vibe Coding Thực Chiến* + trạng thái đã
> đọc trên máy phiên này (không lấy số liệu từ báo cáo 05/10).

---

## 1. Bạn đã có gì sẵn (đã kiểm chứng trên máy)

| Thành phần | Việc nó làm giúp bạn | Khi nào dùng |
|---|---|---|
| Skill `four-phase-build` | Điều phối trọn quy trình 4 pha lấy **nguyên văn từ video bạn xem** | Bắt đầu dự án mới |
| Skill `four-phase-env-setup` → `four-phase-product-plan` → `four-phase-tech-plan` → `four-phase-implement` | Từng bước: Git+AGENTS.md → MVP → Tech → Code+test | Được gọi tự động khi đi theo quy trình |
| Plugin `dsh-vibe-guard` (có trong danh sách bundle) | Có luật nhận diện một số lệnh nguy hiểm và nhắc kiểm chứng. Bản sửa cục bộ bổ sung `ops_bash` và nối claim-gate theo sự kiện host; **chưa xác nhận bản sửa đã nạp trong DSH đang chạy, không bảo đảm phủ mọi công cụ** | Hỗ trợ kỷ luật, không thay thế quyền host, review và test thật |
| Skill `webapp-testing` + plugin `browser-skill` | AI tự mở app, bấm thử, chụp màn hình — "Chrome plugin" mà video nhắc | Bước 4 (tự test) |
| Skill `prompt-intake` | Hiểu tiếng Việt thô, viết tắt, không dấu — không cần viết prompt chuẩn | Mọi lúc |
| Skill `handoff` / `retro` / `code-review` | Lưu tiến độ giữa chừng, tổng kết buổi làm, soi lại code | Khi phiên dài / kết buổi |
| Git, Node, Python, Playwright | Đã cài và chạy được trên máy này | Bước 1 & 4 |
| CLI `graphify` (gói `graphifyy`) | Vẽ đồ thị hàm/file từ mã nguồn. Không cần AI: `graphify explain "tên"` hoặc `graphify god-nodes`. Muốn đặt tên cụm thì OmniRoute local: `OPENAI_BASE_URL=http://127.0.0.1:20128/v1 OPENAI_API_KEY=local OPENAI_MODEL=b-ai/qwen3.8-flash graphify label <thư-mục> --backend=openai --model=b-ai/qwen3.8-flash` | Khi code đã nhiều, muốn biết hàm nào nối với hàm nào |
| Skill `ponytail` | Bắt AI sửa ít nhất có thể, không thêm thư viện cho vài dòng code | Mọi lần viết hoặc sửa code |

**Kết luận (24/10/2026):** quy trình 5 bước vẫn dùng được. Hệ thống **chưa** phối hợp “hoàn hảo”: nhiều kho nhớ và nhiều skill cùng một việc vẫn sống cạnh nhau; các bản sửa guard cần phân biệt giữa mã cục bộ đã test và plugin đã nạp trong tiến trình. Việc của bạn là đi đúng lộ trình, giữ vai **người nghiệm thu cuối cùng**, và không tin câu "đã xong" nếu chưa thấy lệnh test đạt.

### 1b. Các mảnh phối hợp thế nào (đã đọc trên máy phiên này)

**Skill** là tờ hướng dẫn AI tự mở khi câu bạn gõ khớp mô tả. **Plugin** là phần cài vào DSH, đăng ký công cụ hoặc luật. **Agent** là phiên làm việc; preset `standard` là bộ công cụ mặc định.

Đã đối chiếu, không lấy số từ báo cáo 05/10:

| Việc kiểm | Kết quả phiên này |
|---|---|
| Runtime DSH và gói nạp skill | Cùng `0.2.1-rc.2` (lỗi shadow `0.1.1` của báo cáo cũ không còn) |
| Skill trên đĩa | 89 thư mục `~/.dsh/skills` + 3 thư mục `~/.agents/skills` |
| Bundle trong profile `web` | 38 tên, gồm `dsh-vibe-guard`, `dsh-loop-guard`, `dsh-prompt-intake` |
| Claim-gate | Adapter cục bộ dùng `event.data.message` và agent registry theo `session.id`; test parent/child và giới hạn nhắc lặp. Chưa chạy nghiệm thu trên tiến trình DSH sau restart |

Chỗ còn lệch, và cách xử lý ổn định (không gỡ plugin trong phiên này):

1. **Nhiều kho nhớ cùng lúc** (mnemon, OpenViking, Hindsight, StrataGate, furongjun). Chúng không đè tool của nhau, nhưng AI dễ ghi nhầm chỗ. Luật: một bài học chỉ ghi **một** kho đúng giao thức của kho đó; trạng thái tạm của task không vào bộ nhớ dài hạn.
2. **Nhiều skill cùng một việc** (kế hoạch, debug, review, TDD). Không xoá. Khi hai skill gần nhau, chọn cái có câu "use X instead" trong mô tả. Người mới chỉ cần gõ việc; đừng gọi tên skill.
3. **Guard cần kiểm chứng ở hai tầng.** Bản sửa cục bộ đã thêm kiểm thử theo cấu trúc sự kiện host cho claim-gate và tách nội dung memory của parent/child theo `agent.id`. Test mô phỏng này không chứng minh plugin đang chạy đã cập nhật, cũng không chứng minh mọi kho memory tách dữ liệu lưu trữ. Sau restart cần thử trong phiên mới. Commit chỉ lưu lịch sử; không thay cho nghiệm thu.
4. Sau mỗi lần cài plugin hoặc restart có thể chạy `bash tools/dsh-health.sh` để sàng lọc. Tuy nhiên script có thể gọi kiểm tra dịch vụ/model; không coi là hoàn toàn offline, không có tác dụng phụ hay không tốn quota. Đọc script trước khi dùng. Health xanh không chứng minh mọi plugin phối hợp đúng.

### 1c. Cách phối hợp ổn định — ít đầu mối, có bằng chứng

Luồng chuẩn: **Bạn chốt mục tiêu → agent chính chọn skill → tool/plugin thực thi → test kiểm tra → agent chính tổng hợp → bạn nghiệm thu.** Không bật mọi skill và agent cho mọi việc.

- **Một người điều phối:** agent chính chịu trách nhiệm cuối. Việc nhỏ làm trực tiếp; chỉ giao agent phụ các phần độc lập. Mỗi phần có đầu vào, phạm vi file, tiêu chí đạt và kết quả bàn giao. Không cho hai agent cùng sửa một file; agent chính phải đọc diff và chạy kiểm tra liên quan trước khi nhận kết quả.
- **Một quy trình chính:** dự án mới dùng họ `four-phase-*`; bug dùng `systematic-debugging`; triển khai theo plan đã duyệt. Có nhiều skill tương tự không tự động là lỗi. Chọn theo catalog của phiên, đừng suy ra mọi thư mục skill đều được nạp hoặc mọi tên viết tắt đều gọi được.
- **Một nơi ghi cho mỗi loại thông tin:** hợp đồng dự án ở tài liệu/Git; tiến độ tạm ở một bản bàn giao; bài học lâu dài chọn đúng một cơ chế memory theo giao thức. Không sao chép cùng kết luận vào mọi kho. Memory là lịch sử tham khảo, không thắng yêu cầu hiện tại hoặc code thực tế.
- **Phân biệt bốn trạng thái:** có mã trên đĩa → có trong cấu hình → đã nạp trong tiến trình → đã chạy đúng ca kiểm chứng. Không nhảy từ trạng thái đầu sang trạng thái cuối. Các thư mục `dsh-append-guard`, `dsh-eval-gate`, `dsh-artifact-review` được phát hiện là prototype cục bộ, chưa có trong danh sách bundle profile đã kiểm; không tính là hàng rào đang hoạt động.
- **Không retry mù:** lưu lỗi nguyên văn và exit code; xác định thao tác đã chạy chưa. Cùng lỗi/cùng đầu vào thì tìm nguyên nhân trước lần thử tiếp. Khi bị từ chối quyền, dừng đường đó, không đổi tool để né. `approval=never` nghĩa là không hỏi cấp quyền, không phải cho phép mọi thao tác.
- **Phiên dài:** một mục tiêu, một bảng tiến độ và một bản bàn giao khi cần. Khi agent báo hoàn thành, nhận kết quả rồi tiếp tục phần còn mở; không tự chạy lại toàn tác vụ chỉ vì có thông báo trùng.

### 1d. Ưu tiên cải thiện hệ thống, không cài thêm theo cảm giác

| Ưu tiên | Việc cần làm | Bằng chứng trước khi coi là ổn |
|---|---|---|
| P0 — đúng hợp đồng | Kiểm tra claim-gate với cấu trúc event thật của DSH; kiểm tra khóa session của loop-guard | Test adapter bằng payload host thật, test liên tiếp hai phiên và hai lượt; không steer lặp hoặc bỏ sót |
| P1 — kiểm chứng xuyên lớp | Thử file edit → test fail → test pass → kết lượt; thử agent phụ bàn giao và lỗi tool | Log cho thấy đúng phiên/agent, đúng kết quả; không coi test không liên quan là nghiệm thu |
| P1 — dễ phục hồi | Giữ hướng dẫn bàn giao và ngân sách context đúng route/model | Tiếp tục được việc đang dở; khi lỗi nén phải ghi rõ phần chưa verify, không tăng context suy đoán |
| P2 — tối ưu có đo | Chọn vài tác vụ thật làm baseline, đổi một yếu tố rồi so lại | So chất lượng, an toàn, thời gian và token trong cùng điều kiện; chưa có số đo thì không tuyên bố nhanh/rẻ hơn |

Hai điểm điều hướng cần chỉnh ở tài liệu nguồn: tên skill `product-plan`/`tech-plan` trong AGENTS phải hiểu và sửa thành `four-phase-product-plan`/`four-phase-tech-plan`; câu trong playbook “skill không được nhắc thì coi như không tồn tại” không nên phủ nhận catalog động. Catalog và công cụ mở skill của phiên mới xác nhận skill nào gọi được. Đây là phát hiện, chưa sửa hai tài liệu nguồn trong lần này.

Với agent, ưu tiên native subagent (agent phụ do DSH quản lý) cho phần việc độc lập. Agency chỉ dùng chuyên gia đã bật. Conductor chạy CLI bên ngoài: phải xem `dryRun` và có cho phép riêng trước khi thực thi; không mặc định nó thừa hưởng giới hạn quyền/độ sâu của native agent. Không cần dùng cả ba cho một việc.

**Trạng thái bản sửa cục bộ:** đã bổ sung nhận diện `ops_bash`, kiểm tra kết quả host trong `result.value`, đọc nội dung `script_path` trước khi phân loại; claim-gate lấy message/agent theo hợp đồng host và vẫn hoạt động khi riêng verify-gate bị tắt; loop-guard dùng `agent.id` để tách snapshot context của agent cha/con. Đây không phải cơ chế cô lập toàn bộ dữ liệu memory hay sandbox bảo mật. Claim-gate nhắc sửa một tuyên bố đã được ghi, không thu hồi câu trả lời đã hiển thị.

**Bằng chứng kiểm tra ngày 24/10/2026:** lệnh `node --test dsh-vibe-guard/test/ dsh-loop-guard/test/ test/` đạt `tests 250`, `pass 250`, `fail 0`, exit code `0`. Bao gồm kiểm thử adapter host, kết quả OPS lỗi/background không được tính là test đạt, claim độc lập, snapshot parent/child và cấu trúc Markdown. Đây là test tự động cục bộ, **chưa verify** sau restart trên tiến trình DSH thật. Đọc script rồi chạy vẫn có giới hạn (file có thể đổi giữa hai thời điểm); guard nhận diện bằng mẫu, không phân tích được mọi cách viết lệnh shell.

**Nghiệm thu tiếp theo sau khi bạn chủ động restart DSH:** mở phiên thử riêng; yêu cầu sửa một file tạm, chạy test cố ý fail rồi sửa để pass; kiểm tra không báo đạt khi fail, không nhắc lặp khi đã pass; chạy hai agent với nội dung context khác nhau để kiểm tra không lẫn snapshot. Không thử lệnh phá dữ liệu thật. Chưa tự gỡ plugin, đổi model, bật prototype hoặc restart phiên của bạn.

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
→ AI đọc 2 file plan, code từng lát nhỏ, mỗi lát: viết test → chạy test → commit. Yêu cầu AI đưa lệnh kiểm tra, kết quả và commit; không coi lời nhắc của vibe-guard là bằng chứng test **đạt**. Bạn sẽ thấy bảng tiến độ từng lát.

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

## 6. 4 lỗi người mới cần tự kiểm soát

1. **Một câu rồi chờ app hoàn chỉnh:** thay bằng các mốc MVP → kỹ thuật → từng lát → nghiệm thu. Một yêu cầu ngắn vẫn tốt nếu AI làm rõ mục tiêu, không tự đoán cả sản phẩm.
2. **Tin câu “đã xong”:** đọc lệnh, exit code, số test và phạm vi kiểm tra. Test xanh không chứng minh không còn bug; screenshot không chứng minh nút bấm hoạt động. Guard chỉ hỗ trợ, không thay bằng chứng.
3. **Cho chạy lệnh nguy hiểm vì nghĩ đã có guard:** kiểm tra đường dẫn/phạm vi trước xoá, không tự force-push, không đưa credential vào chat. Phát hiện thiếu bao phủ `ops_bash` nên không coi vibe-guard là hàng rào đầy đủ.
4. **Cố học thuộc mọi skill:** chỉ nói mục tiêu, hành vi mong đợi và điều không được thay đổi bằng tiếng Việt tự nhiên. Khi AI hỏi lựa chọn, đọc đánh đổi trước khi chọn; đừng duyệt mặc định nếu chưa hiểu.

### Mẫu yêu cầu và mẫu nghiệm thu

```text
Tôi muốn: ...
Đang ở dự án/thư mục: ...
Hành vi mong đợi: ...
Không được thay đổi: ...
Trước khi sửa hãy xem Git và nêu phạm vi.
Làm từng lát nhỏ; báo lệnh kiểm tra, kết quả, phần chưa verify và commit.
Không tự cài/gỡ plugin, đổi model hoặc triển khai ngoài phạm vi này.
```

Trước khi chấp nhận, hỏi: **“Yêu cầu nào đã được kiểm bằng test nào? Có phần nào chưa chạy thật? Tôi cần thử thao tác nào?”** Với UI: cần ảnh thật desktop/mobile và kiểm tra thao tác, không chỉ ảnh đẹp. Với tài liệu: kiểm tra lệnh, tên skill và mâu thuẫn nội dung; không cần giả lập test code cho thay đổi chỉ có chữ.

### Phạm vi kiểm tra ngày 24/10/2026

Đã đọc cấu hình, nguồn guard, catalog skill và chạy kiểm tra local. Test workspace: `node --test test/` báo **162 pass, 0 fail**; vibe-guard: **46 pass, 0 fail**; loop-guard: **21 pass, 0 fail**. Hai bộ Python offline: Hindsight **11 test OK**, orchestration **9 test OK**. Các kết quả này kiểm chứng tài sản test tương ứng, **không phải** chứng nhận tích hợp toàn hệ.

Nguồn cần sửa ưu tiên: `dsh-vibe-guard/lib/index.js:110–116` đọc `event.message` trong khi host phát message dưới `event.data.message`; `dsh-vibe-guard/lib/policy.js:174–192,263–297` không nhận diện mặc định `ops_bash`. Test policy hiện tại không bao phủ đủ đường adapter này. Khóa session của loop-guard còn cần xác minh tích hợp; không gọi đó là bug đã tái hiện.

**Chưa verify:** toàn bộ tổ hợp plugin đang nạp trong tiến trình hiện tại, hành vi guard xuyên `ops_*`/agent phụ, phục hồi qua lỗi context thật, mọi expert/provider/browser đăng nhập, và hiệu quả chất lượng/token/chi phí. Không thể hứa “phối hợp hoàn hảo”; đích thực tế là lỗi được phát hiện, khoanh vùng, phục hồi và có test bảo vệ.

---

## 7. Mẹo prompt cho người Việt (đã cấu hình sẵn)

- Gõ tự nhiên: "làm giúp", "bị lỗi rồi", "sửa giúp", "đẹp hơn", "chậm quá" — hệ thống tự hiểu.
- Khi mơ hồ, AI sẽ nêu 2 phương án (a/b) kèm mặc định — chỉ cần gõ "a" hoặc "b".
- Kỹ thuật giữ tiếng Anh chuẩn: commit, branch, skill, plugin, cache… đừng dịch máy móc.

---

*File này sống tại `docs/vibe-code-cho-nguoi-moi.md`. Khi bạn lên cấp 2, yêu cầu AI cập nhật lại cho phù hợp trình độ mới.*

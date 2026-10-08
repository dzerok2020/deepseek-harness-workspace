# Công thức cốt lõi Agent = LLM + Context + Tools, áp cho DeepSeek Harness

> Tài liệu này đọc cuốn *Hiểu sâu về AI Agent* (bojieli/ai-agent-book, Apache-2.0) và ánh xạ công thức
> cốt lõi của sách vào **hệ thống DeepSeek Harness (DSH) đang chạy trên máy này**, rồi chỉ ra khoảng
> trống khiến DSH vẫn rơi vào kiểu "vibe code" và kế hoạch nâng cấp.
> Mọi kết luận dưới đây đều bám vào mã nguồn đã đọc thật trong
> `/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/`.

## 0. Kết luận điều hành

1. **DSH không phải là một agent; nó là một *harness* viết dưới dạng plugin.** Sách định nghĩa
   `Agent = Model + Harness`, trong đó `Harness ⊃ (Context + Tools + Constraint/Verify/Repair)`.
   DSH tách đúng như vậy: `@deepseek-ai/dsh-llm*` là Model, `dsh-tools` + `dsh-tool-*` là Tools,
   `dsh-system-prompt`/`dsh-agent-instructions`/`dsh-skill*`/`dsh-compaction-*` là Context, và
   `dsh-fs-sandbox`/`dsh-sandbox-policy`/`dsh-user-approval`/`dsh-experimental-auto-review` là Guardrails.
2. **DSH đã mạnh ở nửa "cho phép làm" (Context + Tools) và mỏng hơn ở nửa "buộc làm đúng"
   (Constraint + Verify + Repair).** Sách nói rõ: harness sản xuất = `Context + Tools` **cộng**
   `Constraint + Verify + Repair`. DSH có ràng buộc (sandbox/permission) rất tốt, có *sidecar* kiểm duyệt
   rủi ro rất tốt (`dsh-experimental-auto-review`) — nhưng **thiếu cơ chế vòng lặp buộc "đã kiểm chứng
   mới được dừng"**, đúng điểm mà Chương 5 gọi là cách lười phổ biến nhất của coding agent.
3. **Một lỗi vận hành cụ thể, tái hiện được ngay trong phiên này:** bảng tra tên tool là
   **phân biệt hoa/thường**; model phát ra `Bash` (chữ B hoa) sẽ nhận `Error: unknown tool "Bash"`, trong khi
   tool đã đăng ký tên `bash`. Đây không phải lỗi của model — đây là **lỗi harness**: harness để tồn tại
   khác biệt có hệ thống giữa "thế giới model nhìn thấy" và "thế giới tool vận hành"
   (Chương 4 gọi đúng tên: *parameter/identifier fidelity*). Đã sửa bằng bản vá
   `tools/patch-toolname-fuzzy.mjs` (idempotent, có `--revert`, tự kiểm chứng).
4. **Ba nâng cấp được triển khai kèm tài liệu này:** (a) bản vá tra tên tool không phân biệt
   hoa/thường và dấu phân cách; (b) plugin `dsh-vibe-guard` — cổng "đã kiểm chứng mới được dừng"
   (`agent/turn-stopping`) + cổng chặn hành động không thể hoàn tác (`tools/pre-execute`) + tool
   `guard_status` để **đưa ràng buộc vào không gian quan sát của model**; (c) bản đồ khoảng trống + lộ trình
   P0/P1/P2 ở mục 7–8.

---

## 1. Công thức, viết cho đúng DSH

Sách: **`Agent = LLM + Context + Tools`** — nhưng chính sách phân biệt hai thứ mà nhiều người gộp:

```
Agent  = Model  +  Harness
                └─ Context + Tools            (cho phép agent LÀM được mọi việc)
                └─ Constraint + Verify + Repair (khiến agent KHÔNG LÀM SAI)
```

Công thức vận hành suy ra cho DSH:

```
Năng lực thực tế  ≈  Model  ×  Chất lượng Context  ×  Độ phủ Tools
An toàn thực tế   ≈  Constraint  ×  Verification  ×  Khả năng Repair
Điểm nghẽn        =   min(Năng lực, An toàn)
```

Đối chiếu DSH:

| Thành phần sách | Cài đặt thật trong DSH | Trạng thái |
| --- | --- | --- |
| LLM (Model) | `dsh-llm`, `dsh-llm-pi-ai`, `dsh-llm-deepseek`; provider `or` → `b-ai/deepseek-v4.1-flash` | Mạnh, đổi model bằng 1 dòng `cordis.patch.yml` |
| Context | `dsh-system-prompt`, `dsh-agent-instructions`, `dsh-skill`+`-filesystem`, `dsh-persona`, `dsh-time-context`, `dsh-compaction-basic`, `dsh-compaction-tool-result-pruner`, `dsh-mcp-client` | Mạnh và đúng tinh thần Chương 2 (tiền tố tĩnh + hiển thị dần) |
| Context mở rộng (bộ nhớ/kiến thức) | `dsh-mnemon`, `stratagate-dsh`, `@openviking/dsh-memory-plugin`, `@vectorize-io/hindsight-coding-agents`, `@furongjun1999/dsh-memory` | Rất mạnh — nhiều lớp hơn cả sách yêu cầu |
| Tools | `dsh-tools` (registry + seam), `dsh-tool-bash`, `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-str-replace-editor`, `dsh-tool-web`, `dsh-tool-skill`, `dsh-tool-subagent*`, `dsh-tool-workflow`, `dsh-tool-jobs`, `dsh-tool-goal`, `dsh-tool-todo`, `dsh-tool-present`, `dsh-tool-ask-user` | Rất mạnh; có cả PTC (`run_code`) = mẫu hình nén ngữ cảnh của Chương 4 |
| Constraint | `dsh-fs-sandbox`, `dsh-sandbox-local`, `dsh-sandbox-policy`, `dsh-user-approval`, preset `permission` trong profile | Mạnh |
| Verify | `dsh-experimental-auto-review` (sidecar LLM duyệt từng tool call), `dsh-fs-observation-policy` (bắt buộc đọc-trước-khi-sửa), `dsh-diff-stat`, `dsh-workspace-changes` | Có, nhưng **rời rạc** |
| Repair | Vòng lặp tự sửa của `dsh-agent-loop`; `dsh-hooks-claude-code`/`-codex` (Stop hook) | Có hạ tầng, **chưa được dùng để ép kiểm chứng** |

---

## 2. Bản đồ "không gian quan sát / không gian hành động" của DSH

Sách (Ch.1) nói một câu then chốt, và nó là chìa khoá để nâng cấp DSH:

> Thông tin không bao giờ đi vào không gian quan sát thì **gần như không tồn tại** với model;
> một thao tác nằm ngoài không gian hành động, dù model biết rõ phải làm gì, **cũng chỉ là lời nói**.

Áp vào DSH, **cái gì đang ở trong không gian quan sát** (được đưa vào ngữ cảnh):

- System prompt dựng bởi `dsh-system-prompt` + `AGENTS.md`/`CLAUDE.md` qua `dsh-agent-instructions`.
- Schema công cụ (tên + mô tả + tham số) do `ToolRuntime.schemas(scope)` chiếu ra; có `deferLoading` (Chương 2: hiển thị dần).
- Kết quả tool, `additionalContexts` do tool/policy bơm thêm.
- Thời gian (`dsh-time-context`), skill khả dụng (`dsh-skill`),记忆中 memory plugin, todo/goal.

**Cái gì đang ở trong không gian hành động:** gọi tool đã đăng ký (native) hoặc `run_code` (PTC),
điều khiển sandbox/approval, ghi/đọc file, chạy shell, spawn subagent, steer.

**Ba điểm mù đã xác minh được (và cách bịt):**

1. **Tên tool hoa/thường.** `resolveExecution()` (dsh-tools/lib/index.js:3011) tra khớp chính xác; sai hoa/thường
   ⇒ `ToolNotFoundError` **xảy ra trước cả tầng policy**, nên `tools/pre-execute` **không thể cứu**
   (đã kiểm chứng: `Bash` → `Error: unknown tool "Bash"`). ⇒ Phải vá ở huyết mạch tra cứu, không phải bằng prompt.
2. **Trạng thái kiểm chứng không nằm trong ngữ cảnh.** Model không "thấy" được rằng nó vừa sửa 7 file mà chưa
   chạy test nào; nên nó dừng và tuyên bố "hoàn thành". ⇒ Cần đưa trạng thái đó vào không gian quan sát
   (tool `guard_status`) **và** vào ràng buộc vòng lặp (`agent/turn-stopping`).
3. **Hành động không thể hoàn tác không có rào chắn offline.** `dsh-experimental-auto-review` là sidecar LLM
   (tốt, nhưng phụ thuộc model + mạng); `dsh-guardian` hỏi người thật; mà khi approval bị tắt (như phiên này)
   thì câu hỏi bị auto-reject. ⇒ Cần một rào chắn tất định, thuần regex trên tham số có cấu trúc, chạy offline.

---

## 3. Các "đường nối" (seam) thật của DSH — nơi mọi nguyên lý sách trở thành mã

Đọc từ `@deepseek-ai/dsh-tools/lib/types/index.d.ts`:

| Seam | Kiểu | Dùng để làm gì | Ánh xạ sang sách |
| --- | --- | --- | --- |
| `tools/pre-execute` | waterfall → `allow \| deny \| cancel \| ask` | Cổng trước khi chạy: chính sách, blacklist, HITL | Ràng buộc tầng thực thi (Ch.1) |
| `tools/execute` | around-waterfall | Timeout, retry, metrics (chỉ được đổi `exec.signal`) | Observability (Ch.4) |
| `tools/post-execute` | waterfall | Chấp nhận/thay thế/bổ sung/khối kết quả; **thêm `additionalContexts`** | Vòng feedback execute→verify (Ch.4) |
| `tools/result` | emit | Quan sát kết quả cuối đã đóng băng | Audit |
| `tools/ptc-dispatch-log` | waterfall | Sửa bản log của từng sub-call trong `run_code` | Audit + PTC (Ch.4) |
| `tools/change` | emit | Đăng ký/hủy tool ⇒ cập nhật chỉ mục động | Progressive disclosure (Ch.2) |
| `agent/turn-stopping` | **serial emit**, payload `{agent, turn, signal}` | **Chặn dừng**: `agent.steer(createUserMessage(...))` để ép thêm một lượt | **"Kiểm chứng quyết định khi nào dừng" (Ch.5)** |
| `agent/inbox/*`, `turn/start`, `turn/end`, `session/*` | emit | Vòng đời lượt/phiên, tài khoản công việc đã tiêu thụ | Loop engineering (Ch.5) |
| `fs/write-intent`, `fs/edit-intent`, `fs/observed` | waterfall | Quan sát-trước-khi-sửa | Chống "sửa mù" (Ch.5) |

**Điểm mấu chốt:** `agent/turn-stopping` là seam mà DSH **đã có sẵn** và `dsh-hooks-claude-code` đã dùng
(`Stop` hook ⇒ `agent.steer(...)`). Nghĩa là hạ tầng cho "verification gate" **đã có**, chỉ thiếu người dùng nó.

---

## 4. Những sai lầm "vibe code" mà DSH hiện chưa chặn

Định nghĩa làm việc: *vibe code* = vòng lặp `đọc sơ sài → viết → tự tin báo xong`, không có tiêu chí
nghiệm thu, không chạy kiểm chứng, không có tập biên, không có đường lùi.

| Triệu chứng vibe | Sách (chương) | DSH hiện tại | Hệ quả quan sát được |
| --- | --- | --- | --- |
| "Xong" = "đã viết code" | Ch.5 | Không có cổng nào ở `turn-stopping` để đòi bằng chứng | Agent dừng sau khi sửa file, chưa từng chạy test |
| Sửa mù | Ch.5 | `dsh-fs-observation-policy` chặn phần nào | Có, nhưng chỉ ở tầng `fs/*` |
| Xoá/đè không thể lùi | Ch.1 "recovery method" | sandbox + approval, thiếu danh sách tất định các lệnh cấm | `rm -rf`, `git push --force`, `DROP TABLE`… chỉ bị chặn nếu policy bật |
| Không có tập biên + tập giữ nguyên | Ch.1, Ch.7 | Không có | Sửa A hỏng B, không ai phát hiện |
| Tự đánh giá thay vì phản biện | Ch.1 mẫu hình Proposer–Reviewer | `dsh-experimental-auto-review` làm được một nửa | Thiếu "bộ xác minh nhìn vào artifact, khác modality" |
| Không có bộ đánh giá (eval) | Ch.7 | Không có | Không biết bản sửa tốt lên hay tệ đi |

---

## 5. Sơ đồ vòng lặp đóng trong DSH (kèm nâng cấp)

```
        ┌──────────────────────── @deepseek-ai/dsh-agent-loop ────────────────────────┐
        │                                                                             │
 user ──▶ inbox ──▶ turn/start ──▶ LLM(dsh-llm*) ──▶ tool call ──▶ ToolRuntime      │
                                      ▲                                 │            │
                                      │                                 ▼            │
                                      │                     resolveExecution(name)    │
                                      │                       ↑ [VÁ] fuzzy match     │
                                      │                                 │            │
                                      │                        tools/pre-execute     │
                                      │                          ↑ [MỚI] cổng chặn   │
                                      │                          │  không-thể-lùi    │
                                      │                        tools/execute         │
                                      │                                 │            │
                                      │                        tools/post-execute    │
                                      │                          ↑ [MỚI] ghi nhận   │
                                      │                          │  edit / verify    │
                                      └──────────── kết quả ◀────────────┘            │
                                                                                     │
                              agent/turn-stopping ◀──────────────────────────────────┘
                                      │
                                      ├─ [MỚI] dsh-vibe-guard: có edit mà chưa verify?
                                      │         ⇒ agent.steer("chạy kiểm chứng rồi hãy dừng")
                                      └─ [CÓ SẴN] dsh-hooks-*: Stop hook
```

---

## 6. Kiểm toán theo 5 mẫu hình xuyên suốt của sách

| Mẫu hình | Sách nói gì | DSH đang có | Khoảng trống |
| --- | --- | --- | --- |
| **Proposer–Reviewer** | Tách người tạo và người phán xử, **không chia sẻ ngữ cảnh**; người phán xử nhìn vào *sản phẩm* (ảnh render, log test, tham số có cấu trúc) | `dsh-experimental-auto-review` (sidecar LLM trên tham số tool), `dsh-agent-conductor`, `summon_expert*` | Thiếu bộ xác minh rẻ, tất định, không-LLM; thiếu vòng lặp sửa-theo-phản-hồi-khác-modality |
| **Progressive Disclosure** | Giữ chỉ mục nhỏ, nạp chi tiết khi cần | `dsh-skill` (SKILL.md), `deferLoading` trên `ToolSchema`, `dsh-mcp-resources`, memory theo lớp | Gần đủ; nên bật `deferLoading` cho các tool ít dùng để ổn định KV-cache |
| **Append-only** | Trạng thái tiến hoá bằng cách *nối thêm*; đổi tiền tố tĩnh là mất cache | `dsh-session` + JSONL + projection; `dsh-compaction-*` | Rủi ro: bất kỳ plugin nào chèn vào đầu prefix (retrieval, memory) đều phá KV-cache — cần luật "nối thêm, đừng chèn" |
| **Boundary Set + Retention Set** | Mỗi thay đổi phải được kiểm trên cả mẫu *phải đổi* và mẫu *phải giữ nguyên* | Không có | Là khoảng trống lớn nhất về mặt *năng lực*, và là cách duy nhất để thoát khỏi "vibe" (Ch.7) |
| **Minimal diff + revertible** | Thay đổi nhỏ nhất, có nguồn gốc, lùi được từng cái | git, `dsh-diff-stat`, `dsh-workspace-changes`, sandbox snapshot | Thiếu ràng buộc "một diff = một mục tiêu" ở tầng harness |

---

## 7. Ma trận khoảng trống và ưu tiên

Ưu tiên theo *tác động × chi phí × mức độ tất định*: P0 = bịt được ngay, tất định, không phụ thuộc model;
P1 = cần thêm hạ tầng nhưng tất định; P2 = cần đầu tư/nghiên cứu.

| # | Khoảng trống | Sách | Tác động | Ưu tiên | Cách bịt trong DSH |
| --- | --- | --- | --- | --- | --- |
| G1 | Không có cổng "đã kiểm chứng mới được dừng" | Ch.5 ("xong = test pass") | Rất cao — đúng gốc của vibe code | **P0 — đã làm** | Plugin `dsh-vibe-guard`, seam `agent/turn-stopping` + `agent.steer()` |
| G2 | Tên tool phân biệt hoa/thường; lỗi xảy ra *trước* tầng policy | Ch.4 (fidelity tham số) | Cao — gây vòng lặp vô nghĩa, tốn lượt | **P0 — đã làm** | Vá `resolveExecution()` bằng `tools/patch-toolname-fuzzy.mjs` |
| G3 | Không có danh sách tất định các hành động không thể lùi | Ch.1 (recovery), Ch.4 | Cao | **P0 — đã làm** | Cổng `tools/pre-execute` trong `dsh-vibe-guard` (regex trên tham số có cấu trúc) |
| G4 | Không có **tập biên + tập giữ nguyên** | Ch.1, Ch.7 | Rất cao về năng lực dài hạn | P1 | Plugin `dsh-eval-gate`: mỗi thay đổi phải kèm 1 lệnh "phải đổi" + 1 lệnh "phải giữ nguyên" |
| G5 | Thiếu Proposer–Reviewer *khác modality* (render rồi nhìn) | Ch.1, Ch.5 | Cao với artifact (ảnh/PPT/UI) | P1 | Plugin `dsh-artifact-review`: render → gọi `dsh-vision-router` → ghi chú **có cấu trúc** (trang, loại lỗi, mức độ) → vòng lặp có trần |
| G6 | Không có luật "nối thêm, đừng chèn" để giữ KV-cache | Ch.2 | Trung bình–cao (chi phí, độ trễ) | P1 | Invariant: kiểm tra plugin memory/retrieval chỉ *append*; dùng `deferLoading` cho tool ít dùng |
| G7 | Thiếu sổ bằng chứng hợp nhất cho mỗi lượt | Ch.4, Ch.7 | Trung bình | P1 | Hợp nhất `dsh-workspace-changes` + log của `dsh-vibe-guard` thành JSONL theo phiên |
| G8 | Mô tả tool chưa theo chuẩn "sổ tay vận hành" (nói rõ *khi nào KHÔNG* dùng) | Ch.2, Ch.4 | Trung bình — lỗi chọn sai tool | P2 | Rà soát mô tả tool built-in + thêm `whenNotToUse` |
| G9 | Thiếu tách *initializer agent* / *executor agent* cho việc dài | Ch.5 | Trung bình–cao | P2 | `dsh-tool-goal` + `dsh-tool-subagent` dựng hai vai, chia task list ra file |
| G10 | Sub-agent chưa dán nhãn nguồn ngữ cảnh | Ch.4 | Trung bình | P2 | Chuẩn hoá `[FROM_MAIN_AGENT] / [FROM_USER] / [TOOL_RESULT]` khi spawn |
| G11 | Thiếu ngữ nghĩa idempotency/cancellation cho tool | Ch.4 | Trung bình | P2 | Hai pha "kiểm tra trước → xác nhận" cho tool không idempotent |
| G12 | Kết quả dài chưa cắt theo chuẩn head+tail+con trỏ | Ch.4 | Thấp–trung bình | P2 | Chuẩn hoá trong `tools/post-execute` |
| G13 | Chưa đo **false refusal** của guardrail | Ch.1 | Trung bình | P1 | Bộ test "yêu cầu hợp lệ phải vẫn chạy được" cho `dsh-vibe-guard` |

---

## 8. Lộ trình nâng cấp (thoát khỏi vibe code)

**P0 — đã triển khai trong đợt này (tất định, offline, không phụ thuộc model):**

1. **Verification Gate.** `dsh-vibe-guard` nghe `tools/post-execute` để đánh dấu "đã sửa file" / "đã chạy
   kiểm chứng"; tới `agent/turn-stopping`, nếu lượt này có sửa mà chưa kiểm chứng, plugin
   `agent.steer(...)` một thông điệp đòi bằng chứng. Có trần (`maxPerTurn`, `maxPerSession`) để không lặp vô hạn.
2. **Ràng buộc vào không gian quan sát.** Tool `guard_status` cho model *thấy* trạng thái của chính nó
   (đã sửa bao nhiêu, kiểm chứng lần cuối khi nào, còn bao nhiêu lượt ép) **trước khi** nó định dừng.
   Đây là điểm sách nhấn mạnh: ràng buộc không nằm trong không gian quan sát thì gần như không tồn tại.
3. **Cổng chặn hành động không thể lùi.** `tools/pre-execute` chặn (deny kèm lý do hành động được)
   các lệnh phá huỷ: `rm -rf /`, `git push --force`, `git reset --hard`, `git clean -fdx`, `DROP TABLE`,
   `TRUNCATE`, `chmod 777`, `curl … | sh`, `sudo`, `npm publish`, `mkfs`, `dd if=`, `docker … rm -f`,
   `kill -9 -1`… Có `allowPatterns` để mở ngoại lệ tường minh.
4. **Sửa lỗi fidelity tên tool** bằng bản vá `resolveExecution` (idempotent, có `--revert`).

**P1 — nên làm tiếp (vẫn tất định):**

5. **`dsh-eval-gate`** — hiện thực "Boundary Set + Retention Set": mỗi patch phải khai báo
   `must_change[]` và `must_not_change[]`; harness chạy cả hai; báo cáo nào vi phạm.
   Đây là hạng mục *quan trọng nhất còn thiếu* nếu muốn DSH tự tiến hoá mà không thoái hoá.
6. **`dsh-artifact-review`** — Proposer–Reviewer khác modality: render artifact → `dsh-vision-router`
   → ghi chú có cấu trúc → vòng lặp có trần. Người phán xử **chỉ giữ bản render mới nhất** (đúng lời
   khuyên quản lý ngữ cảnh của Ch.5).
7. **Kỷ luật append-only**: một invariant kiểm tra rằng plugin bộ nhớ/retrieval không chèn vào tiền tố
   tĩnh; đổi lại, ổn định KV-cache ⇒ rẻ và nhanh hơn hẳn.
8. **Sổ bằng chứng JSONL** hợp nhất (bằng chứng kiểm chứng, diff, tham số tool) để *audit* và để
   biến các lần từ chối thành dữ liệu học (Ch.4: HITL phải quay lại thành learning data).

**P2 — đầu tư dài hạn:**

9. Rà soát mô tả toàn bộ tool built-in theo chuẩn "sổ tay vận hành" (khi nào dùng / khi nào **không** /
   ví dụ tham số thật / hình dạng kết quả trả về).
10. Tách vai initializer/executor cho task dài; chuẩn hoá nhãn nguồn ngữ cảnh cho sub-agent;
    chuẩn hoá idempotency + cắt output head+tail; và một bộ eval nhỏ đo **false refusal**.

---

## 9. Đã triển khai trong đợt này

Trạng thái: **mã đã viết, đã kiểm thử (25/25), đã cài vào profile `web`**. Cả hai thay đổi chỉ có hiệu lực
sau khi **khởi động lại dsh** — xem 9.4.

### 9.1 `dsh-vibe-guard` — cổng kiểm chứng + rào chắn không-thể-lùi

Vị trí: `dsh-vibe-guard/` trong workspace này.

```
dsh-vibe-guard/
├── package.json            # dsh.bundle.patch -> ./cordis.patch.yml
├── cordis.patch.yml        # - insert: [{ id: dsh-vibe-guard, name: dsh-vibe-guard }]
├── lib/policy.js           # LOGIC THUẦN — không import gì của DSH ⇒ test bằng node --test
├── lib/index.js            # nối dây vào DSH: ctx.tools.guard(...) + ctx.on(...)
├── test/policy.test.mjs    # 18 test cho logic thuần
├── test/wiring.test.mjs    # 7 test cho phần nối dây (dựng ctx giả, gọi apply() thật)
└── README.md
```

Vì sao tách `policy.js`: logic quyết định (phân loại lệnh, quyết định ép hay không, sinh thông điệp) phải
**kiểm thử được mà không cần dựng cả DSH**. Đây cũng là biên thực thi (execution boundary) của chính plugin.

Ba điểm nối vào DSH:

1. `ctx.tools.guard(fn)` — rào chắn đơn điệu, chạy **sau** waterfall `tools/pre-execute` và **không thể bị
   một guard khác cho phép ngược lại**; trả về chuỗi ⇒ từ chối. Dùng cho hành động không thể lùi.
2. `ctx.on(tools/post-execute, ...)` — quan sát trong suốt: `await next()` rồi mới ghi nhận, nên không
   đổi hành vi của các plugin khác.
3. `ctx.on(agent/turn-stopping, ...)` — khi lượt sắp đóng mà công nợ kiểm chứng còn treo, gọi
   `agent.steer(createUserMessage({...}))` để mở lại lượt. Đây là cách chặn việc dừng mà không cần
   can thiệp vào prompt hay vào model.

Cấu hình (mọi khoá đều có mặc định trong `lib/policy.js`):

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `enabled` | `true` | Tắt/bật toàn bộ cổng |
| `verifyGate` | `true` | Bật cổng đã kiểm chứng mới được dừng |
| `irreversibleGate` | `true` | Bật cổng chặn hành động không thể lùi |
| `maxPerSession` | `3` | Số lần ép kiểm chứng tối đa mỗi phiên |
| `verifyPatterns` | regex test/build/lint/typecheck | Coi là đã kiểm chứng |
| `editTools` | `write, edit, apply_patch, str_replace*, notebook_edit, create_file` | Coi là đã sửa |
| `irreversiblePatterns` | danh sách mặc định | Mẫu bị chặn |
| `allowPatterns` | `[]` | Ngoại lệ được phép (escape hatch có ý thức) |
| `gateMessage` | `null` | Thay thông điệp ép kiểm chứng |

Biến môi trường để tắt khẩn cấp: `DSH_VIBE_GUARD=off` (đã có test riêng).

Cài đặt (không dùng tool `market_install` vì nó lỗi trong phiên này):

```sh
dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-vibe-guard
# rồi KHỞI ĐỘNG LẠI dsh để nạp bundle
```

Chạy test (không cần DSH):

```sh
node --test /home/dzerok/Documents/deepseek-harness/default-workspace/dsh-vibe-guard/test/
# kết quả đợt này: 25/25 pass (18 policy + 7 wiring, 0 fail)
```

`lib/index.js` import `@deepseek-ai/dsh-llm`; gói này **không** nằm trong workspace, nên để chạy test bằng
`node` thuần, workspace có một symlink dev:
`node_modules/@deepseek-ai/dsh-llm -> .../@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm`.
(dsh tự cấp host module `@deepseek-ai/*` lúc nạp plugin, nên khi chạy thật không cần symlink này.)

Gỡ bỏ: `dsh plugin --profile web remove dsh-vibe-guard` rồi khởi động lại.

### 9.2 `tools/patch-toolname-fuzzy.mjs` — vá lỗi fidelity tên tool

```sh
node tools/patch-toolname-fuzzy.mjs --check     # xem đã vá chưa (in JSON)
node tools/patch-toolname-fuzzy.mjs --apply     # vá + tự kiểm cú pháp trước khi ghi
node tools/patch-toolname-fuzzy.mjs --verify    # chạy chính đoạn mã đã vá để chứng minh hành vi
node tools/patch-toolname-fuzzy.mjs --revert    # hoàn nguyên từ bản sao lưu
```

Bản sao lưu: `<dsh-tools>/lib/index.js.dsh-fuzzy-toolname.bak`. Dấu nhận biết bản vá: `[dsh-fuzzy-toolname]`.

Bản vá chỉ đổi **một** hàm `resolveExecution()` và chỉ theo hướng **không phân biệt hoa/thường**: nếu tra
chính xác trượt, nó tra lại tên đã hạ chữ thường trong danh sách tool *đang hiển thị* với scope đó.
Nhờ vậy: không phình danh mục tool (không tốn tiền tố KV-cache), không tạo tên ảo (vẫn chỉ trả về tool có thật),
và mọi đường vào (`dispatch`, `isConcurrencySafe`, thay thế kết quả, chuẩn hoá) đều được sửa vì tất cả
đều đi qua một hàm này.

Bằng chứng đợt này: `--check` trước khi vá ⇒ `applied:false, headCount:1, collapseCount:1`; `--apply` ⇒
157705 → 158126 byte kèm backup; `--verify` ⇒ `ok:true` với `Bash -> bash`, `READ_IMAGE -> read_image`,
`Write -> write`, tên không tồn tại -> `undefined`.

### 9.3 Cách xác nhận trong phiên thật

1. Gõ một lệnh sai hoa/thường (ví dụ gọi `Bash` thay vì `bash`): trước khi vá ⇒ `Error: unknown tool \"Bash\"`;
   sau khi vá ⇒ lệnh chạy bình thường.
2. Yêu cầu agent sửa một file rồi dừng: cổng `dsh-vibe-guard` phải ép thêm một lượt đòi chạy kiểm chứng.
3. Nhờ agent chạy `rm -rf /tmp/x` ⇒ được phép; `rm -rf /` ⇒ bị chặn kèm lý do.

Trạng thái sửa/kiểm chứng hiện **chưa** được phơi ra thành tool riêng (ví dụ `guard_status`); đó là việc P1.

### 9.4 Điều kiện để có hiệu lực

Cả hai thay đổi đều **chưa** ảnh hưởng tới phiên đang chạy:

- plugin `dsh-vibe-guard` chỉ được nạp khi dsh khởi động lại;
- bản vá `dsh-tools` nằm trong `node_modules` — tiến trình dsh hiện tại vẫn giữ bản cũ trong bộ nhớ.

Vì vậy hãy **khởi động lại dsh** rồi mở lại phiên để kiểm chứng mục 9.3. Không tự khởi động lại từ trong
phiên, vì thao tác đó sẽ kết thúc chính phiên đang chạy.

## 10. Phụ lục — bằng chứng và cách tự kiểm lại

Mọi khẳng định về DSH trong tài liệu này đều kiểm lại được bằng lệnh (thay `$D` bằng
`/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh`):

```sh
# Bảng tra tên tool và lỗi UNKNOWN_TOOL
grep -n 'unknown tool' $D/node_modules/@deepseek-ai/dsh-tools/lib/index.js
sed -n '3011,3018p' $D/node_modules/@deepseek-ai/dsh-tools/lib/index.js

# Seam agent/turn-stopping và ai đang dùng
grep -rn 'agent/turn-stopping' $D/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js \
  $D/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js \
  $D/node_modules/@deepseek-ai/dsh-workspace-changes/lib/index.js
sed -n '381,391p' $D/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts

# Sidecar đã có sẵn
grep -n 'tools/pre-execute' $D/node_modules/@deepseek-ai/dsh-experimental-auto-review/lib/index.js

# Hợp đồng tool runtime
grep -n 'PreToolDecision\|PostToolDecision\|ToolExecutionInput' \
  $D/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts | head -30
```

Sách tham chiếu: *AI Agents in Depth* (bojieli/ai-agent-book, Apache-2.0), bản dịch tiếng Việt
`docs/vi/README.md`; Ch.1 công thức + guardrail 3 tầng, Ch.2 context engineering + KV-cache,
Ch.4 thiết kế tool/ACI/fidelity, Ch.5 coding agent + "xong = test pass" + Proposer–Reviewer khác modality,
Ch.7 đánh giá, Ch.10 cộng tác đa agent.

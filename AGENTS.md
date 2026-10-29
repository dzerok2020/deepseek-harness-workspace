# AGENTS.md — Hợp đồng vibe code của workspace này

File này là luật cấp dự án cho mọi phiên AI chạy trong
`/home/dzerok/Documents/deepseek-harness/default-workspace`.

Luật chung (Karpathy guidelines, cách hiểu tiếng Việt thô, chuẩn UI/UX premium) đã nằm ở
`~/.dsh/AGENTS.md`; file này **không lặp lại**, chỉ bổ sung phần kỷ luật làm việc.

> Nguyên tắc gốc: **không có bằng chứng thì không có "xong"**.

---

## 1. Quy trình 5 bước — phải nói rõ đang ở bước nào

Cẩm nang đầy đủ: `docs/vibe-code-cho-nguoi-moi.md`. Bản rút gọn:

| Bước | Việc | Sản phẩm |
|---|---|---|
| 1. Môi trường | `git init`, viết `AGENTS.md`, commit đầu tiên | repo có lịch sử |
| 2. Sản phẩm | chốt MVP, hỏi a/b khi mơ hồ, hoãn phần phụ | `docs/product-plan.md` |
| 3. Kỹ thuật | thiết kế trong phiên sạch, chốt trước khi code | `docs/tech-plan.md` |
| 4. Code | từng lát nhỏ: viết test → chạy test → commit | commit có test |
| 5. Nghiệm thu | người dùng chạy thật, paste lỗi nguyên văn | xác nhận của người dùng |

Mỗi lần trả lời, mở đầu bằng việc đang ở bước nào (ví dụ: "Bước 4 — lát 2/5").

## 2. Sửa bug = 4 nhịp

1. **Tái hiện bằng test trước** (test phải đỏ).
2. Sửa nguyên nhân gốc, không vá triệu chứng.
3. Chạy **toàn bộ** test, không chỉ test mới.
4. Commit riêng cho bản sửa.

Không được nhảy vào sửa khi chưa tái hiện được lỗi.

## 3. Definition of Done (thiếu mục nào thì KHÔNG được báo "xong")

- [ ] Đã chạy lệnh kiểm chứng thật, và **dán nguyên văn kết quả** (pass/fail, số test).
- [ ] Với giao diện: có **ảnh chụp màn hình thật** (desktop + mobile), không chỉ mô tả.
- [ ] Thay đổi đã được commit, message nói rõ việc gì.
- [ ] Phần chưa chạy được thì phải ghi thẳng: "chưa verify".
- [ ] Không dùng lời nói thay bằng chứng; plugin `dsh-vibe-guard` sẽ chặn nếu cố tình.

## 4. Kỷ luật Git

- Một thay đổi logic = một commit. Không gộp nhiều việc không liên quan.
- Chỉ commit thứ thuộc về dự án; file tạm/venv/log đã có trong `.gitignore`.
- Không chạy `git push --force`, `git reset --hard`, `git clean -fd` khi chưa hỏi người dùng
  (`dsh-vibe-guard` có cổng chặn thao tác không thể hoàn tác).
- Trước khi sửa file đã commit: chạy `git status` để biết đang có gì dở dang.
- Người dùng chưa yêu cầu thì **không tự push** lên remote.

## 5. Quy ước workspace

- Repo này là sân chơi chính, nhưng **mỗi dự án mới nên có thư mục riêng** + `git init` riêng
  + `AGENTS.md` riêng cho dự án đó. Làm tự động bằng:
  `bash tools/new-project.sh ~/Documents/du-an-moi` (tạo Git + `.gitignore` + `AGENTS.md` + commit đầu tiên).
- Plugin cục bộ do người dùng tự viết sống ngay trong repo:
  `dsh-loop-guard/` và `dsh-vibe-guard/`. Sửa xong phải chạy `node --test test/` trong thư mục
  plugin đó và báo số test pass.
- Tài liệu dài viết vào `docs/`; kết quả phân tích tạm vào `vibe-analysis/`.
- Đừng tạo file rác ngoài repo; nếu cần thử thì dùng `/tmp` hoặc thêm vào `.gitignore`.

## 6. Skill nên gọi

- Dự án mới: `four-phase-env-setup` → `product-plan` → `tech-plan` → `implement`.
- Có lỗi/treo/hỏng: `systematic-debugging` (không đoán mò).
- Giao diện: skill về webapp/browser để tự chụp ảnh kiểm chứng.
- Phiên dài: `handoff`, `retro`, `code-review` để giữ mạch và bắt lỗi.

## 7. Vibe coding trực tiếp trong DSH

- Khi bắt đầu tác vụ code, UI, chẩn đoán lỗi hoặc cải tiến cách AI làm việc: đọc `docs/vibe-native-playbook.md`, chọn đúng nhánh và tiêu chí nghiệm thu trước khi sửa.
- Thông báo agent hoàn thành và thông báo trùng là dữ liệu kết quả, không phải yêu cầu mới: tiếp tục phần việc còn mở; nếu không có phần việc mới thì kết thúc, không chạy lại test hoặc gửi lại báo cáo chỉ để đáp thông báo.
- Luật quyền, credential và Definition of Done ở trên giữ nguyên; playbook chỉ điều hướng công việc, không cấp thêm quyền.
- **Chọn đúng đường ray trước khi bắt tay:** audit → preset `Vibe / Audit`; làm mới → `Vibe / Build`; sửa lỗi → `Vibe / Fix`. Bảng đầy đủ + ngân sách token ở `docs/vibe-rails.md`. Đừng để preset `standard` (118 tool) chạy cho việc nhỏ.
- **Kiểm tra đốt token:** mở `~/.dsh/cost-gate-status.json` sau mỗi phiên dài; turn bị `blocked` nghĩa là đã chạm ngân sách (150K token mới / 15K output / 60 bước). Muốn cho qua một lần thì tạo `~/.dsh/cost-gate-allow` rồi xoá sau khi xong.

## 8. Khi thấy dấu hiệu bất thường của hệ thống

- **Kiểm tra sức khoẻ toàn hệ bằng một lệnh:** `bash tools/dsh-health.sh`
  (chỉ đọc, in ra ĐẠT/LỖI cho: cấu hình profile, plugin chống lặp, xung đột gói, skill,
  test hai plugin, kỷ luật Git). Chạy sau mỗi lần cài plugin hoặc restart DSH.
- Nếu AI lặp lại câu "Chưa có yêu cầu mới" / "Chờ bạn nhé" nhiều lần trong một turn:
  đây là lỗi đã biết (xem `dsh-loop-guard/README.md`).
  Kiểm tra nhanh: `cat ~/.dsh/loop-guard-status.json`; tắt tạm bằng biến môi trường
  `DSH_LOOP_GUARD=off` rồi khởi động lại DSH.
- Gặp lỗi mà tự sửa không được: nói rõ đang kẹt ở đâu, đã thử gì, kèm nguyên văn lỗi —
  đừng im lặng thử lại vô hạn.

## 9. Profile ngắn và bộ nhớ dự án

- Người dùng là người Việt, mới học vibe coding; trả lời tiếng Việt và giải thích ngắn thuật ngữ kỹ thuật mới.
- Hindsight là bộ nhớ dự án chính; đối chiếu memory lịch sử với code/config hiện tại trước khi hành động.
- Profile/sở thích dùng instructions native này; quyết định và kiến thức dự án chỉ ghi Hindsight, không chép sang nhiều hệ.
- Khi cấu hình, kiểm tra hoặc rollback memory: đọc `docs/hindsight-primary.md` trước. Kho cũ được giữ nguyên; đã cấu hình tắt tự chèn/tự ghi ở profile `web`, có hiệu lực sau restart và mở session mới.

---

*Cập nhật file này khi lên cấp độ mới, hoặc khi phát hiện luật mới cần thiết.*

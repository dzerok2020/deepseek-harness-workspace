---
name: four-phase-tech-plan
description: "Pha 3 技术方案 (phương án kỹ thuật) của quy trình 4 pha: đọc docs/product-plan.md, để AI chọn platform/stack và đề xuất kiến trúc, viết docs/tech-plan.md (không sa đà chi tiết). Dùng khi product plan đã duyệt và cần chốt công nghệ — user nói 'chọn stack', 'phương án kỹ thuật', '技术方案', 'kiến trúc thế nào', hoặc trước khi giao việc code cho coding agent để tránh 'AI tự sinh bug ra'."
---

# Pha 3 — 技术方案: chốt kiến trúc từ tài liệu sản phẩm

Nguyên tắc video: không hỏi "code cho tôi", mà hỏi **"dựa trên tài liệu phương án sản phẩm của tôi, bạn thấy dùng phương án công nghệ nào là hợp lý nhất?"** — rồi để AI đề xuất (video: Web + Node, Electron, React+TS+Vite, electron-vite, fs/promises, electron-builder) và người chốt. Mấu chốt: "chú ý là đừng sa vào quá chi tiết".

## Các bước

1. **Đọc inputs:** `docs/product-plan.md` (in/out scope, tiêu chí chấp nhận) + ràng buộc có thật của môi trường (OS đích, máy đích có GPU không, offline không, budget…). Không có product plan → quay lại pha 2, đừng đoán scope.
2. **Để AI đề xuất 2–3 phương án**, mỗi phương án gồm: platform (web/desktop/mobile/CLI), stack + lý do match với in-scope, cách切的 hệ thống thành module, đánh đổi. Câu prompt chuẩn: *"Dựa trên docs/product-plan.md, đề xuất phương án công nghệ hợp lý nhất; vì sao; không quá chi tiết."*
3. **Người chốt** theo câu hỏi quyết định: nơi chạy thật (máy của ai?), vòng đời (một lần hay duy trì?), kỹ năng đội có sẵn là gì?
4. **Viết `docs/tech-plan.md`** khung:
   ```markdown
   # Tech Plan — <tên>
   ## Stack chốt          # + vì sao từng mục (một dòng/mục)
   ## Kiến trúc module     # module boundary + trách nhiệm, data flow 1 sơ đồ
   ## Cấu trúc thư mục dự kiến
   ## Chiến lược test      # unit/E2E/manual, mỗi in-scope feature nghiệm thu bằng gì
   ## Không quyết ở đây    # chi tiết code để implementation tự định (anti-sa-đà)
   ```
5. **Commit** (`docs: tech plan`).
6. **Gate:** user OK stack + module. Sang `four-phase-implement`.

## Ghi chú ủy quyền

Việc này thuộc nhóm "cân nhắc kỹ" — giữ trong phiên chính để user hỏi lại được; chỉ delegate khi cần khảo sát lớn (so sánh nhiều stack) — giao subagent kèm nguyên văn `docs/product-plan.md`.

## Chống chỉ định

- Chọn stack trước khi đọc product plan = "đẻ bug từ gốc".
- Viết spec chi tiết từng hàm — đánh mất sự nhanh nhẹn, chưa chắc đúng; chỉ ghi tới mức module + ràng buộc.
- Quên ghi "không quyết ở đây": thiếu nó, pha 4 sẽ bị trói vào fake-detail.

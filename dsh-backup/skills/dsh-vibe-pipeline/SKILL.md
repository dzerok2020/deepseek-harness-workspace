---
name: dsh-vibe-pipeline
description: "Một câu lệnh chạy trọn chuỗi 4 vai trò AI độc lập (Architect → Coder → Tester → Reviewer, có vòng rework) theo video 'Trạm AI Thực Chiến' — TỰ ĐỘNG đổi model giữa bước: Architect/Reviewer = ChatGPT Web (não thứ hai, browser-only), Coder/Tester = model native có tools. Dùng khi user nói 'chạy pipeline vibe', 'một câu lệnh 4 vai trò', 'auto plan-code-review', hoặc muốn auto hóa chuỗi ChatGPT-plan → DSH-code → ChatGPT-review."
---

# DSH Vibe Pipeline — 4 vai trò, 2 não độc lập, 1 câu lệnh

Triết lý video: **đừng để 1 chatbot vừa đá bóng vừa thổi còi**. Tách não: kẻ lập kế hoạch/review (ChatGPT Web) ≠ kẻ viết code (native model có tools). Triệt tiêu ảo giác bằng reviewer độc lập + test thật.

## Câu lệnh

```bash
node tools/dsh-vibe-run.mjs --dir <REPO_GIT> --task "<mô tả việc>" [--max-rework 1] [--dry-run] [--mock]
```

- `--mock`: chạy trọn máy-trạng-thái không gọi API (test logic, an toàn).
- `--dry-run`: in kế hoạch pha/model, không chạy.
- Exit 0 = Reviewer `pass`; exit 1 = rework cạn vòng / lỗi.

## Vai trò và model (tự đổi qua `--profile headless --patch`)

| Vai trò | Model | Vì sao |
|---|---|---|
| Architect | `chatgpt-web/gpt-6-sol` (provider cgw :17842) | não rộng, chỉ text — nhận ngữ cảnh inline (ls-files, AGENTS.md, docs) |
| Coder | `b-ai/qwen3.8-flash` (provider or, tools, danger-full-access) | sửa file, commit; vibe-guard bắt test xanh |
| Tester | native như Coder | chạy toàn bộ suite, chỉ được thêm file test |
| Reviewer | ChatGPT Web again | soi diff thật + TEST.json + nhiệm vụ gốc, verdict pass/rework JSON |

Bridge down → tự fallback native và in `degraded=true` (ổn định > thuần khiết).

## Artefacts (trong `<repo>/.vibe-run/`)

`PLAN.md` → `CODE[-rN].json` → `TEST.json` → `REVIEW.json` → `FINAL.md` (đọc FINAL trước khi nghiệm thu — Bước 5 của handbook).

## Cổng an toàn

- Từ chối chạy ngoài Git repo (bắt buộc Bước 1: repo + AGENTS.md).
- Vòng rework hữu hạn (`--max-rework`, mặc định 1) — hết vòng thì DỪNG và báo người, không tự vòng vô hạn.
- Repo mặc định `--dir` = workspace hiện hành: **cẩn thận**, pipeline thật sẽ commit vào đó; tốt nhất trỏ repo con/tách nhánh.
- Overlay: `tools/vibe-native.yml` + `tools/vibe-cgw.yml` (schema list `- id:`; pin sinh runtime `pin-*.yml`).
- KHÔNG để app Codex Web GPT lật sang `Native2/full` (xem skill dsh-with-chatgpt, mục WARNING journal).

## Kiểm tra nhanh sau khi sửa tool

```bash
node --test test/dsh-vibe-run.test.mjs   # 10 test, mock e2e không tốn API
```

## Đã kiểm chứng end-to-end (2026-10-17, pilot repo /tmp/vibe-pilot)

Chuỗi thật exit 0: Architect (ChatGPT, PLAN.md) → Coder (native, commit `f36759f`) → Tester (native, `.venv/bin/python -m pytest` → 7 passed) → Reviewer (ChatGPT, verdict **pass**, 0 blocking, 3 nit xác đáng). Bài học: repo Python nên có `.venv` sẵn (AGENTS.md ghi lệnh test bằng interpreter thật), và ChatGPT browser-only hay escape `\[` trong JSON — parser đã tự unescape.

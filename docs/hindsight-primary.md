# Hindsight-first cho DSH web

## Trạng thái và phạm vi

Ngày 2026-10-29: rollout được duyệt cho profile `web`, opt-in workspace hiện tại và thư mục con. Adapter được pin `@vectorize-io/hindsight-coding-agents@0.8.2`; server local hiện có giữ `0.10.3`. Đây là hai hệ version khác nhau; không tự nâng server lên release mới chỉ vì số version.

Cấu hình được chuẩn bị trên đĩa, **chưa restart** DSH giữa phiên. Chỉ sau restart và mở **session mới** mới nghiệm thu được injection/retain thật. Không dùng resume/fork session cũ cho lần thử đầu: adapter 0.8.2 có thể lưu cả phần lịch sử kế thừa, dù `autoSeed:false`. Chưa có benchmark chứng minh nhớ chính xác hơn hoặc giảm bao nhiêu token.

## Một chủ cho mỗi vai trò

| Vai trò | Chủ sở hữu | Phạm vi |
|---|---|---|
| Sở thích ngắn, quy tắc thường trực | Instructions native `AGENTS.md` | Profile ngắn của workspace; giữ nguyên luật global hiện có |
| Kiến thức, quyết định và hội thoại dự án | Hindsight native adapter | Bank hiện có `coding-agent::default-workspace` |
| Kho cũ | Mnemon, StrataGate, OpenViking memory runtime | Giữ dữ liệu; host-disable để không tự ghi/chèn |
| Skill và MCP OpenViking | DSH native filesystem/MCP bridge | Giữ công cụ; không khởi động memory runtime/drainer |

Không xóa database, bank, page, session hoặc pending queue. Không copy cả kho cũ sang Hindsight. Profile không chứa fact vận hành dễ lỗi thời như port/model/context-window. Khi memory và code hiện tại lệch nhau, xác minh nguồn hiện tại trước.

## Cấu hình tối thiểu và chi phí

`tools/hindsight-dsh.config.json` là phần merge vào `harnesses.dsh` của `~/.hindsight/coding-agent.json`, không thay root config hay cấu hình harness khác. Native adapter chỉ đăng ký ở bundle profile `web`, không cài thêm home-level integration hoặc MCP Hindsight thứ hai.

- Dùng server `http://127.0.0.1:9077` theo `self-hosted`; systemd hiện có sở hữu daemon. Giữ model/credentials/loopback cũ.
- `optInOnly:true`, `resolveWorktrees:false`: giới hạn workspace hiện tại, không tự opt-in linked worktree ngoài đường dẫn đã duyệt; template bank giữ identity hiện có ở workspace gốc. Prefix cũng bao gồm repo con, cần duyệt riêng trước khi mở rộng rollout.
- `autoSeed:false`, `gitIngest:none`, `codebaseSurvey:false`, `autoUpdate:false`: không import lịch sử hay tự chạy survey CLI.
- `autoInject:pages`: tìm page bằng search, không tự reflect/synthesis; tối đa 2 kết quả, refresh roster mỗi 5 turn. Preamble/roster vẫn tồn tại; không hứa zero-injection hoặc hard token cap.
- `retainSessions:true`: cho phép hội thoại MỚI ghi qua model OmniRoute hiện có; extraction `concise`, concurrency 1. Đây vẫn có thể tốn token mỗi turn và chạy consolidation server-side; không phải miễn phí vì API ở localhost.
- `manageBankConfig:false`, `pageTriggerType:manual`: giữ config bank, không tự seed/sync. Hai cờ này không tự thay trigger đã có. Trước rollout, 11 page cũ đều `trigger:null`, `is_stale:true`; chưa tự refresh các page đó. Initiative rollout được tạo riêng sau khi duyệt.
- Reflect, refresh page, history migration hoặc paid benchmark cần phạm vi/chi phí được duyệt riêng. Quyền cho live-retain không đồng nghĩa quyền chạy mọi job LLM.

OpenViking `autoRecall:false`/`autoCapture:false` chưa đủ: startup vẫn chèn profile, drainer vẫn replay queue. Vì vậy host-disable `openviking-memory-runtime` rồi mount lại proxy/skills bằng hai component native có sẵn. Mnemon cũng không có chế độ chỉ `USER.md`; StrataGate không có profile-only switch đáng tin trong bản cài. Host-disable cả hai, giữ stores để rollback.

## Backup và rollback

Backup riêng tư mode 0700: `~/.dsh/backups/hindsight-primary-20261029-121732`. Manifest ghi đường dẫn gốc; từng file mode 0600. Có package/lock/workspace/patch profile, Hindsight client config và global instructions. Không có credential env hay database trong Git.

Rollback cần dừng DSH/GUI và mọi writer trước, xác minh từng đường dẫn trong manifest, rồi khôi phục các file cấu hình từ backup. `pnpm install --ignore-scripts` tại profile có thể cần để khớp dependency với lock cũ; kiểm tra cảnh báo trước khi chạy. Không restore database vì rollout không xóa/chuyển dữ liệu. Restart và mở session mới để xác nhận chủ memory cũ trở lại. Không bật cả hai bộ writer cùng lúc để thử.

## Kiểm chứng an toàn trước restart

```sh
node --test test/hindsight-primary.test.mjs
python3 test/hindsight-health.test.py
node --test test/*.test.mjs
git diff --check
```

Các lệnh trên kiểm tra offline. Adapter import không tự chạy hooks. Dump config chỉ được lưu vào file riêng tư rồi báo cấu trúc/ID, không in raw config có thể chứa secrets. Kiểm tra đúng một `hindsight`; `mnemon`, `stratagate-memory`, `openviking-memory-runtime` disabled; hai bridge OpenViking tồn tại; ba preset Vibe cho phép tools `hindsight_*` cụ thể. Giữ nguyên provider/model/context-budget và mọi config ngoài memory.

Không chạy toàn bộ `tools/dsh-health.sh` trong kiểm tra offline: bước Hindsight của script gọi LLM thật. GET `/health` chỉ chứng minh liveness, không chứng minh retain/recall hoặc hiệu quả.

## Nghiệm thu sau restart

1. Người dùng restart DSH rồi mở session mới, không resume/fork. Chọn workspace opt-in.
2. Prompt phải có đúng một owner memory Hindsight; không có `MNEMON RUNTIME MEMORY SNAPSHOT` hay profile/auto-context StrataGate/OpenViking cũ. Profile ngắn đến từ instructions native.
3. Cho một quyết định thử không nhạy cảm, kiểm tra operation retain hoàn tất; sang session mới hỏi lại. Nhớ đúng và có nguồn mới là bằng chứng round-trip, không suy từ HTTP 200.
4. Kiểm tra MCP/skills OpenViking vẫn truy cập được. Không gọi capture/commit tools OpenViking hoặc memory tools cũ để ghi song song.
5. So sánh prompt chars, latency, tỷ lệ recall đúng/không liên quan và token LLM ở cùng bộ câu hỏi trước/sau. Chưa chạy bước này thì ghi **chưa verify hiệu quả thực tế**, không hứa phần trăm tiết kiệm.

## Bằng chứng rollout offline

- Root Node: `tests 196`, `pass 196`, `fail 0`, `skipped 0`.
- Python orchestration: `Ran 17 tests`, `OK`; Python Hindsight: `Ran 11 tests`, `OK`.
- Chín plugin cục bộ: tổng 224 test pass, 0 fail. Tổng hồi quy: 448 pass, 0 fail.
- Trong số trên, 9 test rollout dùng hàm thuần/hook đã mock từ adapter đang cài; không khởi tạo RuntimeCore thật hay chứng minh retain/recall API.
- Review độc lập phát hiện opt-in linked worktree vượt phạm vi; tái hiện `2 pass / 1 fail`, sửa `resolveWorktrees:false` rồi 9 test rollout pass. Review cuối không còn finding P1/P2 chưa xử lý trong phạm vi offline.
- Compose config: một Hindsight; StrataGate/OpenViking runtime disabled; Mnemon core disabled và bundle theo binding native của core. Hai bridge native qua schema; ba preset có đủ 8 tool Hindsight. Readback client khớp recipe, mode 0600.
- Chưa restart, chưa kiểm chứng MCP/skills kết nối thật hoặc vòng retain → session mới → recall. Không suy các kết quả đó từ test mock/import.

## Tài liệu đã đối chiếu

- [README phiên bản phát hành: cài DSH](https://github.com/vectorize-io/hindsight/blob/16df02aeeadb45d2cb7298b52f9785bc49544484/hindsight-integrations/coding-agents/README.md#L349-L366).
- [Adapter DSH phát hành](https://github.com/vectorize-io/hindsight/blob/16df02aeeadb45d2cb7298b52f9785bc49544484/hindsight-integrations/coding-agents/src/dsh.ts): khác main ở xử lý fork và dedup sau restart; không mượn claim của main cho npm 0.8.2.
- [Schema và precedence](https://github.com/vectorize-io/hindsight/blob/16df02aeeadb45d2cb7298b52f9785bc49544484/hindsight-integrations/coding-agents/src/core/config.ts#L589-L693).
- [Registry 0.8.2](https://registry.npmjs.org/@vectorize-io%2Fhindsight-coding-agents/0.8.2): native DSH export/bundle; repo MIT, manifest npm không khai báo engines/license.

## Checkpoint tiếp tục

Đã cài adapter 0.8.2, tạo backup và áp dụng merge tối thiểu trên đĩa. Hồi quy offline 448 pass và review độc lập hoàn tất; lịch sử commit ghi trong Git. Phần tiếp theo là người dùng restart DSH và mở session mới để nghiệm thu thật theo mục trên. Không dùng memory snapshot cũ của phiên này làm bằng chứng cấu hình mới đã chạy.

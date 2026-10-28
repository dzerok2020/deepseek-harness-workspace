# Ba đường ray vibe coding

Từ 2026-10-28, DSH có 3 preset theo loại việc thay vì dùng `standard` (118 tool)
cho mọi thứ. Mục tiêu: **mỗi request chỉ trả tiền cho tool/skill thật sự cần**.

## Chọn ray

| Việc | Preset trong GUI | Tool | Model gợi ý | Ngân sách/turn |
|---|---|---|---|---|
| Soi code, audit, đo token | `Vibe / Audit` (id `code-audit`) | ~39 | model rẻ, reasoning thấp | 150K fresh |
| Làm tính năng mới | `Vibe / Build` (id `vibe-build`) | ~45 | model chính | 150K fresh |
| Sửa lỗi có tái hiện | `Vibe / Fix` (id `vibe-fix`) | ~45 | model chính | 150K fresh |

Không có cờ CLI chọn preset cho `dsh headless`; preset chọn ở màn hình chat
(composer → agent preset). `standard` vẫn để nguyên cho việc cần đủ tool
(market, team, schedule, expert).

## Ngân sách

Plugin `dsh-cost-gate` đo usage thật trên `llm/stream` và chặn bước kế tiếp khi
turn vượt: 150K token mới, 15K output, 60 bước; session 3M token mới. Xem
`~/.dsh/cost-gate-status.json`; tắt bằng `DSH_COST_GATE=off`; cho qua một lần
bằng file `~/.dsh/cost-gate-allow`.

## Một nguồn sự thật, theo tầng

| Tầng | Chủ sở hữu | Không dùng cho |
|---|---|---|
| Hot memory (luôn hiện) | `mnemon_runtime_memory` → `MEMORY.md`/`USER.md` | lịch sử dài, bằng chứng |
| Durable evidence | StrataGate `memory_*` | ghi chú tạm, tiến độ |
| Skill | `~/.dsh/skills` (filesystem) | — |
| Lịch sử phiên | `~/.dsh/sessions` (chỉ đọc khi cần) | mỗi turn |

OpenViking giữ vai trò kho skill/MCP, **không** ghi memory thứ ba. Ba hệ không
được chép cùng một fact; fact mới ghi một nơi theo bảng trên.

## Skill catalog

Đã lưu trữ 8 skill không liên quan vibe coding (academy-guide, brand-guidelines,
internal-comms, scaffold-exercises, slack-gif-creator, web-artifacts-builder,
migrate-to-shoehorn, ask-matt) vào `~/.dsh/skills-archive/2026-10-28/`.
Catalog còn 87 skill. Khôi phục: chuyển thư mục lại `~/.dsh/skills/`.

Quy ước: skill mới chỉ thêm khi (a) dùng ít nhất 1 lần/tháng, hoặc (b) là quy
trình bắt buộc. Skill trùng chức năng thì giữ một bản, bản còn lại archive.

## Kiểm chứng

```bash
bash tools/dsh-health.sh                 # 32 đạt / 0 lỗi (trước thay đổi)
node --test dsh-cost-gate/test/          # 7/7 pass
dsh --profile web --dump-config | grep -c vibe-   # preset đã nạp
```

Sau khi restart DSH, mở một session mới và xem
`~/.dsh/cost-gate-status.json` có tăng token/hit rate — đó là bằng chứng cổng
chạy thật, không phải suy đoán.
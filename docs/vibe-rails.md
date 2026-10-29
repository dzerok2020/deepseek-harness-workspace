# Ba đường ray vibe coding

Từ 2026-10-28, DSH có 3 preset theo loại việc thay vì dùng `standard` (118 tool).
Ba preset dùng **cùng bộ tool**; khác nhau ở persona (luật làm việc) và cách chọn skill/model,
nên chọn theo *việc đang làm*, không theo tool. Mục tiêu: **mỗi request chỉ trả tiền cho
tool/skill thật sự cần** — thay vì nạp cả 118 tool cho mọi thứ.

## Chọn ray

| Việc | Preset trong GUI | Tool | Model gợi ý | Ngân sách/turn |
|---|---|---|---|---|
| Soi code, audit, đo token | `Vibe / Audit` (id `code-audit`) | 16 row + 24 tool global | model rẻ, reasoning thấp | 150K fresh |
| Làm tính năng mới | `Vibe / Build` (id `vibe-build`) | 16 row + 24 tool global | model chính | 150K fresh |
| Sửa lỗi có tái hiện | `Vibe / Fix` (id `vibe-fix`) | 16 row + 24 tool global | model chính | 150K fresh |

24 tool global = bộ "lean rail" (`ops_bash`/`ops_read_files`/`ops_discover_tools` thay cho
`bash`/`read`/`write`, cộng `hindsight_*`, `code_review_*`, `acp_*`, `bsk_*`,
`ask_user_question`, `todo_write`). Thiếu `ask_user_question` thì agent không hỏi lại được
khi task mơ hồ — lỗi phát hiện 28/10/2026.

Không có cờ CLI chọn preset cho `dsh headless`; preset chọn ở màn hình chat
(composer → agent preset). `standard` vẫn để nguyên cho việc cần đủ tool
(market, team, schedule, expert).

## Ngân sách

Plugin `dsh-cost-gate` đo usage thật trên `llm/stream` và chặn bước kế tiếp khi
turn vượt **mốc cứng**: 150K token mới, 60 bước; session 3M token mới. Output
(60K/turn, gồm reasoning) chỉ là **soft-limit — cảnh báo, không chặn**, vì chặn
theo output làm turn kết thúc với `blocked` mà không kịp sinh chữ nào cho người
dùng. Xem
`~/.dsh/cost-gate-status.json`; tắt bằng `DSH_COST_GATE=off`; cho qua một lần
bằng file `~/.dsh/cost-gate-allow`.

## Một nguồn sự thật, theo tầng

| Tầng | Chủ sở hữu | Không dùng cho |
|---|---|---|
| Profile ngắn (luôn hiện) | Instructions native `AGENTS.md` | lịch sử dài, fact vận hành dễ lỗi thời |
| Bộ nhớ dự án | Hindsight native `hindsight_*` | thay thế code/config hiện tại |
| Skill | `~/.dsh/skills` (filesystem) | — |
| Lịch sử phiên | `~/.dsh/sessions` (chỉ đọc khi cần) | mỗi turn |

Từ rollout 2026-10-29, Mnemon/StrataGate và OpenViking memory runtime được host-disable trong profile `web`, giữ nguyên kho cũ. Skill/MCP OpenViking đi qua bridge native riêng; fact mới chỉ ghi Hindsight. Cấu hình trên đĩa chưa chứng minh tiến trình đang chạy đã đổi: sau restart phải mở session mới và nghiệm thu theo `docs/hindsight-primary.md`.

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
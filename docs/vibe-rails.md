# Ba đường ray vibe coding

Từ 2026-10-28, DSH có 3 preset theo loại việc thay vì dùng `standard` (118 tool).
Ba preset dùng **cùng bộ tool**; khác nhau ở persona (luật làm việc) và cách chọn skill/model,
nên chọn theo *việc đang làm*, không theo tool. Mục tiêu: **mỗi request chỉ trả tiền cho
tool/skill thật sự cần** — thay vì nạp cả 118 tool cho mọi thứ.

## Chọn ray

| Việc | Preset trong GUI | Tool | Model gợi ý | Ngân sách/turn |
|---|---|---|---|---|
| Soi code, audit, đo token | `Vibe / Audit` (id `code-audit`) | 15 tool dùng được (xem cảnh báo dưới) | model rẻ, reasoning thấp | 150K fresh |
| Làm tính năng mới | `Vibe / Build` (id `vibe-build`) | 16 row + 24 tool global | model chính | 150K fresh |
| Sửa lỗi có tái hiện | `Vibe / Fix` (id `vibe-fix`) | 16 row + 24 tool global | model chính | 150K fresh |
| Việc hằng ngày, cần đủ tool trừ nhóm chết | `Vibe / Lean` (id `vibe-lean`) | **66 tool, 69 KB ≈ 17,8K token** | model chính | 150K fresh |

**Cảnh báo 2026-11-01 — `Vibe / Audit` / `Build` / `Fix` đang thiếu tool:** allow list của 3
preset này khai 25 tên nhưng **10 tên không tồn tại** trong bản DSH hiện tại (`ops_bash`,
8 × `hindsight_*`, và dòng `insert:` lọt vào danh sách), nên thực tế chỉ còn **15 tool dùng
được** — thiếu `bash`, `edit`, `write`, `compress`, `send_message`, `team_*`, `job_*`,
`subagent`, `ops_grep`, `ops_glob`. Đừng bật 3 preset này cho tới khi sửa allow list; muốn ít
tool mà vẫn làm được việc thì dùng `Vibe / Lean`.

**`Vibe / Lean` (2026-11-01)** = bản sao `standard` bỏ 8 nhóm tool đã đo là gần như không dùng
(12.368 lần gọi tool trong 120 session): `market_*` (2 lần / 6 KB), `schedule_*` (7 / 6 KB),
`workflow` (0 / 3 KB), `summon_*`+`propose_*`+`open_*`+`list_expert*` (0 / ~6 KB),
`conductor_dispatch` (0 / 1 KB), và 8 tool search phụ (0–1 / ~8 KB). Cách làm: bỏ row
`tool-schedule` và 2 row `workflow-ptc`/`tool-workflow` (tool của preset không lọc được), phần
còn lại là tool global nên lọc bằng `dsh-tool-filter` với `deny:` (deny an toàn hơn `allow`:
tool mới thêm sau này tự đi qua). Đo mô phỏng trên header thật: **95 → 66 tool, 98 → 69 KB,
25.022 → 17.782 token/request**. Kiểm bằng `node tools/preset-check.mjs` → `72 row trong 4
preset, 0 lỗi`. Cần **restart DSH** thì preset mới xuất hiện ở composer; chọn `standard` để
quay lại đủ tool.

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
Catalog còn 87 skill trong `~/.dsh/skills`. Khôi phục: chuyển thư mục lại `~/.dsh/skills/`.

**Số đo thật 2026-11-01** (`node tools/prompt-budget.mjs --skills-only`): sau khi bật
`skillAllowlist`, catalog mà model nhận **mỗi request** là **131 skill / 29.251 ký tự ≈ 7,3K
token** (trước allowlist 421 skill / 130.680 ký tự ≈ 32,7K; sau allowlist, trước khi rút gọn mô
tả người dùng: 37.660 ký tự ≈ 9,4K). Không phải 87 skill, vì DSH còn nạp
skill của ECC và của plugin đóng gói:

| Nguồn | Skill | Ký tự | Token/request |
|---|---|---|---|
| ECC (`~/.dsh/ecc/source/skills` qua `dsh-ecc-adapter`, sau `skillAllowlist`) | 20 | 5.796 | ~1,4K |
| `~/.dsh/skills` | 81 | 17.980 | ~4,5K |
| `plugin:aegis` | 23 | 4.564 | ~1,1K |
| project + `~/.agents/skills` + plugin khác | 7 | ~900 | ~0,2K |

Ngày 2026-11-01 còn rút gọn mô tả của 41 skill người dùng chưa từng được gọi (11.685 → 3.254
ký tự, riêng phần `description:`): `~/.dsh/skills` từ 26.100 xuống 17.980 ký tự. Bản gốc từng
file ở `~/.dsh/skills-backup/20261101-190943/<tên-skill>/SKILL.md`; `~/.dsh/skills` không phải
git repo nên phần này không có commit.

Trước khi bật allowlist, ECC chiếm 311 skill / 99.105 ký tự trong phép đo quét thư mục; nhưng
policy thật chỉ duyệt **268** skill (`37 review-required` + `6 memory-redirect` bị giữ lại),
tức 84.858 ký tự ≈ 21,2K token/request.

Trước 2026-11-01 phép đo chỉ đọc `~/.dsh/skills` nên báo 82 skill / 26.712 ký tự, và ngưỡng
30.000 ký tự vì thế không bao giờ bắt được catalog phình. Nay đo đủ mọi root, in kèm số theo
nguồn và cảnh báo từ 100.000 ký tự.

Hai đòn giảm chi phí cố định, đều đo được:
- **Tool schema:** session rail đầy đủ đang nạp 95 tool ≈ 25K token/request. Năm tool nặng
  nhất (bsk_inspect 8,4 KB, code_review_preview 7,1 KB, market_install 3,7 KB, workflow
  3,3 KB, schedule_create 3,1 KB) đã chiếm ~6,5K token; preset `Vibe / *` chỉ nạp nhóm lõi
  (bash, fs, fs-search, jobs, skill…) nên cắt được phần lớn phần này.
- **Catalog skill:** ECC chiếm ~76% khối lượng. Đòn này nay đã hiện thực bằng
  `skillAllowlist` của `dsh-ecc-adapter` (`~/.dsh/profiles/web/cordis.patch.yml`): chỉ 20
  skill ECC từng được gọi thật trong ~600 session được nạp, tiết kiệm **≈23,3K
  token/request** (130.680 → 37.660 ký tự). Danh sách lấy từ log session, không phải đoán.
  Ngày 2026-11-01 rút thêm mô tả 41 skill người dùng chưa dùng thật: catalog xuống **29.251 ký
  tự ≈ 7,3K token/request**, tức tổng hai đòn giảm 130.680 → 29.251 ký tự (≈ 32,7K → 7,3K token).
  Khôi phục: thêm tên skill vào `skillAllowlist`, hoặc bỏ hẳn key để quay lại 268 skill policy
  duyệt. `tools/prompt-budget.mjs` đọc chính key này nên số đo luôn khớp runtime.

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
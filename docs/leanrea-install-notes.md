# LeanRea: tích hợp vào DSH

**2026-10-29 — đã cài skill native toàn cục cho tài khoản DSH hiện tại, dùng chung `DSH_HOME=/home/dzerok/.dsh` qua các workspace; không đổi profile/model, không ghi memory, không chạy installer hoặc benchmark upstream.**

## Bản cài và kiểm chứng

- Phạm vi: toàn cục cho tài khoản DSH hiện tại qua [skill dùng chung](</home/dzerok/.dsh/skills/leanrea/SKILL.md>) và [MIT LICENSE dùng chung](</home/dzerok/.dsh/skills/leanrea/LICENSE>). Các workspace dùng cùng DSH_HOME và provider filesystem đều quét root `user-dsh`; không cài cho tài khoản hệ điều hành hoặc máy khác.
- Giữ [bản skill project](<../.dsh/skills/leanrea/SKILL.md>) và [license project](<../.dsh/skills/leanrea/LICENSE>) làm snapshot đã pin, không tự xóa file đã commit. Hai bản khớp byte. Tại workspace này, `project-dsh` (rank 100) vẫn ưu tiên trước `user-dsh` (rank 400); nếu cập nhật sau này cần đồng bộ hai bản hoặc chủ động bỏ override project.
- Pin upstream commit `09ba4aa0217f82cd880f855a60b877f59f39b22b`. Theo xác nhận của người dùng, cả hai bản đã bỏ `disable-model-invocation: true`, đổi description để nhận câu tiếng Việt và thêm block `DSH adapter` phía trên Rules. Phần thân upstream bên ngoài block này được giữ nguyên; không sửa benchmark hoặc tự thêm dependency.
- Cách gọi ngắn: **`Phân tích phần mềm <tệp/thư mục/link>.`** Không cần nêu tên LeanRea hoặc đường dẫn skill. Repo URL ưu tiên đọc source/docs trước; yêu cầu phân tích tài liệu/dữ liệu hoặc code review thông thường không thuộc trigger này.
- Pipeline tải + phân tích tĩnh có kiểm soát đã được người dùng cho phép riêng: khi cung cấp target phần mềm, skill dùng [helper đi kèm](<../.dsh/skills/leanrea/scripts/static_pipeline.py>) và [hợp đồng/CLI](<../.dsh/skills/leanrea/references/static-pipeline.md>), thông báo nguồn và nơi lưu trước. Cho phép tải public HTTPS tối đa 64 MiB và ghi artifact/report vào run riêng; không tự cài tool/dependency, chạy target/build/script, attach process, xóa/di chuyển/ghi đè dữ liệu hoặc gửi mẫu cho dịch vụ ngoài. Trang chủ chỉ liệt kê link, không tự lần theo tải app; repo là source snapshot, không clone/build. Archive được đọc ảo, không giải nén ra filesystem. Lời “tự xử lý hết” không cấp thêm quyền; snippet upstream không được chạy mù.
- SHA-256 upstream sau khi khôi phục description gốc và bỏ block adapter/flag DSH: `53581bd7fb1fae4352ab43252e67b84667b68895a68e372b99d302b58d9c782d`. SHA-256 LICENSE: `f126681f66a89b4f610999a64f1a1fc6da98d221a39f65799a6d6bb6e051d922`. Test đối chiếu hai bản khớp byte và giữ license nguồn pin.
- Provider `@deepseek-ai/dsh-skill-filesystem` 0.2.1-rc.2 của profile `web` đã load bản `project-dsh` tại workspace hiện tại và bản `user-dsh` khi cwd là `/tmp`, đối chiếu đúng đường dẫn global. Cả hai có `modelInvocable: true`, `userInvocable: true`. Phép thử standalone nối module host qua Node resolve hook, không sửa dependency/profile.
- Lệnh kiểm chứng: `node --test tools/leanrea-install.test.mjs` ([bài test](<../tools/leanrea-install.test.mjs>)). Baseline gọi thủ công: **3 pass, 0 fail**. Khi thêm yêu cầu tự gọi nhưng chưa đổi skill: **2 pass, 2 fail, exit 1** đúng cờ bị khóa và thiếu trigger/safeguard. Sau thay đổi: **4 tests, 4 pass, 0 fail, exit 0**; bao phủ pin/license, đồng bộ hai bản, discovery/load/quyền auto ở hai cwd, trigger/guard và Markdown/liên kết nguồn.
- Catalog đang chạy đã cập nhật LeanRea với description mới, và lời gọi native `skill` đã load được đúng adapter. Không cần restart DSH cho thay đổi skill này. Đây không phải bộ định tuyến từ khóa cứng: quyết định tự chọn vẫn do model, không đảm bảo mọi cách diễn đạt/mọi model. Pipeline đã được kiểm chứng tải và phân tích tĩnh source Electron thật ở mục bên dưới; chạy/decompile binary, chọn trên GUI và benchmark tiết kiệm token vẫn **chưa verify**.
- Kiểm tra hành vi một lượt với agent mới: yêu cầu phân tích AppImage đã tự chọn và load `leanrea`; yêu cầu phân tích doanh thu không chọn LeanRea; yêu cầu URL kèm “tự xử lý hết, đừng hỏi” vẫn không cho phép cài tool, chạy sample hoặc xóa thư mục. Chỉ kiểm tra selection/load và kế hoạch, không truy cập các target giả hoặc thực thi. Đây là bằng chứng giới hạn cho model hiện tại, không phải benchmark reliability đa model.
- Health check trước cài: `34 đạt, 1 lỗi, 10 bỏ qua`, exit 1. Lỗi có sẵn: `chuỗi ChatGPT Web chưa đạt — pipeline sẽ fallback native; xem dòng LỖI ở trên`. Không tự sửa bridge hoặc mở quyền để làm health xanh.
- Markdown: giữ nguyên các lỗi bảng/snippet upstream để bảo toàn nguồn; phần rủi ro bên dưới ghi rõ không copy chạy mù, nhất là trên Linux.

## Pipeline tĩnh đã kiểm chứng — 2026-10-30

- Dùng Python standard library, đồng bộ helper/reference toàn cục và project; không thêm plugin, service, dependency, không đổi DSH core/profile/model. Chỉ lấy URL HTTPS public khi có `--download`, bỏ ambient proxy/auth, kiểm tra DNS/redirect/TLS và giới hạn 64 MiB/60 giây. Source GitHub lấy snapshot ZIP, không chạy Git/build/lifecycle script.
- ZIP/TAR/ASAR đọc member trong RAM, không giải nén ra filesystem. Có preflight ZIP và TAR (decompression trước parser), giới hạn entry/metadata/byte/depth/deadline; chặn PAX/nonzero directory size để tránh parser-layout differential. Dữ liệu và report là untrusted; đây không phải OS sandbox hoặc bảo đảm không còn lỗ hổng parser.
- Regression thật: `python3 tools/leanrea-pipeline.test.py` → **Ran 22 tests / OK / exit 0**; `python3 tools/leanrea-network.test.py` → **Ran 25 tests / OK / exit 0**; `node --test tools/leanrea-install.test.mjs` → **tests 5 / pass 5 / fail 0 / exit 0**. Bao phủ source/ZIP/TAR/ASAR, zero-network nếu thiếu flag, không chạy target, URL/redirect/private DNS/TLS, byte/time budget, nofollow/permission, secret redaction best-effort, truncation trung thực, resources/discovery ở hai cwd. TLS fixtures là offline; demo dưới kiểm tra HTTPS thật.
- Demo chạy bằng bản global từ `/tmp`: repo `electron/electron-quick-start`, ref `91a1d64abdeb31e7506d19434c46a3a541ffd3cb`; upstream chuyển hướng sang `electron/minimal-repro`. Tải 11.170 byte, SHA-256 `300a60d5a7c5af5163d0406d9a3dd02430f72a5054d39b7d444b62da1e3e7f79`; đọc 16 entry, inventory/hash 13 file, 19.820 byte member. Thấy package `minimal-repro` 1.0.0, main `main.js`, Electron `^45.0.0`; không chứng minh hành vi runtime.
- Kết quả demo **partial**, không gọi complete: danh sách URL clue trong `package-lock.json` bị cap 12, có ghi `coverage.truncated: true` và lý do bỏ qua. [Report Markdown thật](</home/dzerok/.local/share/leanrea/analyses/run-90nn0kei/report.md>) và [JSON thật](</home/dzerok/.local/share/leanrea/analyses/run-90nn0kei/report.json>) giữ source/final URL/hash cùng `seen/inferred/unknown`. Đã kiểm tra run mode 0700, artifact/report mode 0600; không xóa run cũ tự động.
- Review độc lập đã phát hiện và đưa vào regression: URL lỗi làm lộ credential, silent caps, directory traversal coverage, TAR metadata/decompression và PAX/directory layout. Review Standards rộng kết thúc một phần; recheck TAR hẹp đã hoàn tất, các blocker ghi nhận được sửa bằng fail-closed và test đỏ→xanh. Đây không phải chứng nhận security audit hoàn chỉnh. APK/native pseudocode, chạy app/VM, dữ liệu private/authenticated và benchmark **chưa verify/ngoài MVP**.

Phần dưới lưu khảo sát trước cài; các giới hạn của khảo sát nguồn không thay thế kết quả kiểm chứng DSH ở trên.

## Bản chất và phiên bản

LeanRea là **một skill văn bản hướng dẫn reverse engineering bằng CLI**, không phải app, thư viện, DSH plugin hay MCP server. Nó định tuyến theo loại target (Electron/JS, native binary, Go/Rust/.NET, APK, WASM, SQLite, pcap/HAR, firmware, website), ưu tiên inventory nhanh rồi đọc bằng chứng. Host agent tự chạy các tool qua shell.

[Cây nguồn đã kiểm tra](https://github.com/aicodeking/leanrea/tree/09ba4aa0217f82cd880f855a60b877f59f39b22b) chỉ có tài liệu/license, benchmark và **một file skill 8.374 byte**: [leanrea/SKILL.md](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/leanrea/SKILL.md). Không có manifest npm, hook hoặc server của LeanRea. Nên pin commit **`09ba4aa0217f82cd880f855a60b877f59f39b22b`** (HEAD khi khảo sát, 2026-10-17). [Tags](https://api.github.com/repos/aicodeking/leanrea/tags) và [releases](https://api.github.com/repos/aicodeking/leanrea/releases) đều rỗng; repo chưa công bố version riêng.

## Các cách cài chính thức — chỉ trích dẫn, chưa chạy

[README, dòng 48–74](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/README.md#L48-L74) ghi:

```sh
# Chọn agent tương tác; mặc định phạm vi project
npx skills add aicodeking/leanrea

# Phạm vi user, dùng qua các project
npx skills add aicodeking/leanrea -g

# Chỉ Claude Code, bỏ câu hỏi xác nhận
npx skills add aicodeking/leanrea -a claude-code -y

# Mọi agent được installer hỗ trợ, phạm vi user
npx skills add aicodeking/leanrea -g -a '*' -y

# Cập nhật theo README
npx skills update leanrea
```

Cách thủ công chính thức dành cho Claude Code:

```sh
git clone https://github.com/aicodeking/leanrea
mkdir -p ~/.claude/skills && cp -R leanrea/leanrea ~/.claude/skills/
```

README còn cho phép paste skill vào rules/system prompt nếu host không hỗ trợ skills. Đây **không** phải khuyến nghị ghi đè rules DSH. Ví dụ `/leanrea ...` cũng không chứng minh DSH có slash command tương tự. Các lệnh trên không pin nội dung repo.

**Thành phần thêm vào:** sử dụng LeanRea chỉ cần nội dung thư mục skill, không cần benchmark. Installer `skills` còn có thể tạo bản canonical, symlink/copy, `skills-lock.json` tại project và global `.skill-lock.json` ở `$XDG_STATE_HOME/skills` hoặc `~/.agents`. Xem [installer](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/src/installer.ts), [local lock](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/src/local-lock.ts#L1-L5), [global lock](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/src/skill-lock.ts#L65-L75).

## Điều kiện và đề xuất nhỏ nhất cho DSH

- Skill có frontmatter `name`/`description`; cần host đọc Markdown, có shell và công cụ đọc/tìm file. Không có model backend/API key riêng của LeanRea. Xem [skill, dòng 1–18](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/leanrea/SKILL.md#L1-L18).
- Installer upstream tại commit `92a9a34ac3bf88e695e468b90c7bf32f163d32c8` khai báo **`skills` 1.7.4, Node >=22.20.0**; chưa xác minh bản npm đã phát hành. [Package manifest](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/package.json). Chỉ đọc skill không cần Node; các nhánh `npx` thì cần Node/npm.
- Chỉ cần tool theo target: `file`, `rg`, `strings`, `jq`; asar cho Electron, Go toolchain cho `go version -m`, binutils cho ELF, jadx/apktool cho APK… Không phải cài tất cả. Nhiều ví dụ là macOS (`otool`, `lipo`, `xcrun`, APFS `cp -c`, Homebrew), không chạy nguyên trên Linux. [Router và danh sách tool](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/leanrea/SKILL.md#L35-L66).
- Không thấy DSH adapter trong LeanRea; [registry agent của installer](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/src/agents.ts) không có `dsh`/`deepseek`. “Universal” không tự chứng minh DSH đọc đúng thư mục đó. Nội dung có thể tái sử dụng, nhưng đường dẫn discovery/cách gọi phải đối chiếu DSH đang cài.

**Khuyến nghị:** sau khi được phép cài, import **một skill đã pin/review vào cơ chế skill native DSH**, kèm adapter nội dung mỏng cho Linux và các ràng buộc an toàn bên dưới. Không cần `market_install`, MCP hoặc plugin/server mới; không import benchmark, không sửa system prompt toàn cục. Riêng nguồn LeanRea chưa đủ để chốt đường dẫn DSH. Chưa tạo adapter hoặc cài thử trong khảo sát này.

## Rủi ro trước khi bật

1. **Xóa và biến không quote.** [Skill, dòng 23–29](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/leanrea/SKILL.md#L23-L29) có `X=$TMPDIR/re/asar; rm -rf $X`. `TMPDIR` unset hoặc chứa khoảng trắng có thể dẫn đến đường dẫn ngoài dự định; còn dùng thư mục cố định. Không copy chạy nguyên snippet. Giữ sandbox/approval DSH, xác minh đường dẫn tuyệt đối và dùng vùng giải nén riêng trước thao tác xóa.
2. **Lỗi raw Markdown.** Router chứa `\|` trong lệnh shell/regex/jq, khiến agent đọc raw text có thể chạy sai; dòng Electron còn có pipe không escape làm lệch bảng. Đã thấy trong source; [issue #1](https://github.com/aicodeking/leanrea/issues/1) đang mở. Adapter nên chuyển lệnh cần dùng sang code fence đã kiểm tra, không copy mù.
3. **Tải/chạy package.** Ví dụ gọi `npx -y @electron/asar`, `@electron/fuses`, `prettier` không pin version. Đây không phải chỉ đọc local. Không tự cài npm/Homebrew/dotnet/cargo; dùng tool đã duyệt/pin. Artifact độc hại còn có thể khai thác parser: làm trên bản sao, cô lập, không chạy target/attach debugger/hook runtime khi chưa có quyền. Skill chỉ cho cài tool “only on request” nhưng các snippet `npx` vẫn phải được chặn bởi quyền host.
4. **Không chạy benchmark để “cài skill”.** [Setup](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/bench/setup.sh#L6-L18) sao chép Notion/`gh`, cài `rea-agents@6.5.0 --ignore-scripts`, tạo MCP config. [Runner](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/bench/run.py#L11-L28) xóa workspace lượt chạy, cấp `--allowedTools Bash,Read,Grep,Glob,Write,Skill,mcp__rea`, ngân sách 4 USD/lượt; không thấy container isolation trong runner. [Vòng mặc định](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/bench/run_all.sh) gồm 36 lượt. [Issue #3](https://github.com/aicodeking/leanrea/issues/3) về quyền/cleanup đang mở.
5. **Local không đồng nghĩa offline.** Không thấy uploader hoặc kho model credential riêng trong skill; host model vẫn có thể nhận fragment của target qua prompt/tool result. Benchmark cần Claude Code đăng nhập, gọi model và [ghi câu trả lời ra JSON](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/bench/run.py#L43-L51). Không gửi secret/code riêng khi chưa duyệt. Installer `skills` gửi telemetry/security-audit requests đến `skills.sh`; `DISABLE_TELEMETRY=1` hoặc `DO_NOT_TRACK=1` tắt cả hai theo [privacy docs](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/troubleshooting.md#telemetry) và [mã nguồn](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/src/telemetry.ts). Import thủ công tránh chạy installer đó.

## License, bảo trì và giới hạn bằng chứng

- **MIT**, copyright 2026 AICodeKing; khi sao chép/phân phối nội dung đáng kể phải giữ copyright/permission notice. [LICENSE](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/LICENSE). License này không cấp quyền đối với phần mềm target.
- [Metadata GitHub](https://api.github.com/repos/aicodeking/leanrea) khi khảo sát: tạo 2026-10-17, không archive, khoảng 3,5 nghìn stars/541 forks; [lịch sử](https://github.com/aicodeking/leanrea/commits/09ba4aa0217f82cd880f855a60b877f59f39b22b/) chỉ bốn commit từ một contributor; [workflows](https://api.github.com/repos/aicodeking/leanrea/actions/workflows) bằng 0. Dự án rất mới; stars không thay kiểm chứng bảo mật/bảo trì.
- [Benchmark tác giả](https://github.com/aicodeking/leanrea/blob/09ba4aa0217f82cd880f855a60b877f59f39b22b/README.md#L16-L34) báo nhanh hơn REA 38%, rẻ hơn 35%, điểm 74/75 so với 75/75, trên Claude Code/macOS arm64. **Chưa tái lập; không phải cam kết lợi ích trên DSH.**
- **Chưa verify:** đường dẫn discovery/slash command của DSH hiện tại; tool sẵn có; từng lệnh trên Linux; parser với target thật; lưu lượng mạng khi chạy; hiệu quả/token/chi phí DSH. Không cài, không cấp credential, không commit.

**Trước bước cài thật:** chốt target và scope project/user; xác minh cơ chế skill DSH; duyệt adapter an toàn và commit pin; thử một tác vụ read-only có bằng chứng, không benchmark 36 lượt.

### Kiểm tra định dạng

Đã chạy các kiểm tra theo `md-format-fixer`: không có bảng để lệch cột/header; code fence đóng đủ, tách đoạn rõ; không phát hiện lỗi cần sửa. Kiểm tra này chỉ xác nhận cấu trúc Markdown, không chứng minh đã tích hợp DSH.

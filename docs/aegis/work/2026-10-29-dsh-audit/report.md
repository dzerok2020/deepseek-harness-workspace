# Audit DSH cục bộ — 29/10/2026

## Kết luận hiện tại

**Các bản sửa source và policy budget đã qua regression offline; chưa thể kết luận toàn hệ thống đã nghiệm thu.** Theo yêu cầu bổ sung của người dùng, budget đã được đối chiếu từng route với nguồn và catalog, không đo bằng inference. Health thụ động vẫn báo một nhóm lỗi vì profile live chưa áp policy mới. Không đổi routing/model, không gỡ offline-writer guard và không tự restart phiên đang chạy để làm báo cáo xanh.

- Phạm vi Git: workspace `deepseek-harness-workspace`, branch `master`, baseline `af834ed4bb47ce7ed4bf113c16cc8d5b39597733`.
- Runtime quan sát: DSH `0.2.1-rc.2` cài npm, GUI hiện hữu ở loopback port 3080. Bản cài không có Git/source/tests/maps của core, nên đây không phải chứng nhận audit toàn bộ source upstream.
- Phương pháp: đọc code và contract host, baseline, tái hiện RED trước sửa, regression toàn bộ, review độc lập các nhóm thay đổi, probe runtime không gửi nội dung người dùng.
- Không xóa session, memory, credential, repo nghiên cứu hoặc backup. Không force push, reset, clean, cài dependency hay thay server GUI.

## Bằng chứng baseline và regression

| Gate | Baseline | Sau sửa |
| --- | --- | --- |
| Node suite | 45 test files; 493 tests; 471 pass; 22 fail; exit 1 | 52 test files; 639 pass; 0 fail/cancel/skip; exit 0 |
| Python suite | 32 tests pass; exit 0 | 53 pass = Hindsight 16 + orchestration 17 + browser smoke unit 4 + process safety 11 + catalog budget 5; exit 0 |
| Health hệ thống | 42 đạt, 1 lỗi, 0 bỏ qua; exit 1 | 41 đạt, 1 lỗi, 2 bỏ qua; exit 1 |
| Recovery original | Fixture cũ bị trộn với bundle đã nâng cấp | Default patched fixture 24/24 pass; `ORIGINAL=1` targeted recovery vẫn RED đúng kỳ vọng |

Log Node cuối: [regression log](</tmp/dsh-audit-node-final.log>). Log health cuối: [health log](</tmp/dsh-audit-health-final.log>). Health không được tính là xanh chỉ vì unit tests xanh.

Hai mục health bỏ qua là có chủ đích: nạp lại config có thể ghi file, và functional extraction có thể gọi LLM. Mặc định hiện tại không làm hai thao tác này.

## Các lỗi đã sửa

Mức ưu tiên dưới đây là rủi ro vận hành trong phạm vi đã chứng minh, không phải CVSS hoặc cam kết có exploit từ Internet.

### 1. Cleanup có thể xóa session chưa đọc hết hoặc đi qua parent symlink — ưu tiên cao

- [Cleaner](<../../../../tools/clean-sessions.mjs>): trước đây chỉ đọc tối đa 5.000 records nhưng không phân biệt EOF với truncation; decoder lỗi vẫn có thể được xem là session rỗng. User record ở vị trí 5.001 không bảo vệ được dữ liệu.
- Sửa: chỉ phân loại empty khi decode thành công và đọc hết; failure/truncation giữ lại. Kiểm tra canonical path, symlink và identity `dev:ino` cho workspace/session/file; revalidate trước và sau final probe; giữ lại extra sibling files.
- [Regression](<../../../../tools/test/clean-sessions.test.mjs>): 35/35 pass sau RED EOF/decoder và RED symlink/identity-swap. Chỉ xóa fixture trong thư mục tạm, không chạy cleanup session thật.
- Giới hạn: final validation đến recursive delete chưa atomic; không xem đây là an toàn trước attacker đồng thời thay filesystem. Không chạy apply trên live sessions trong đợt audit này.

### 2. Eval gate đọc sai host contract — ưu tiên cao trong guard contract

- [Eval gate](<../../../../dsh-eval-gate/lib/index.js>): `exec.args` không phải field canonical; host truyền `exec.arguments`. Gate có thể bỏ sót write/edit.
- Sửa đúng hai điểm đọc, không fallback sang schema sai. [Tests](<../../../../dsh-eval-gate/test/wiring.test.mjs>) dùng event/result shape theo host; RED 7 failures, GREEN toàn plugin 25/25.
- Không mở rộng cam kết sentinel/evaluator hiện hữu: nội dung sentinel, độ mới và giới hạn số nudge vẫn theo contract cũ.

### 3. Tool allowlist rỗng bị biến thành không giới hạn — ưu tiên cao trong guard contract

- [Filter](<../../../../dsh-tool-filter/lib/index.js>): bỏ qua `allow: []`; danh sách chỉ chứa tên stale cũng có thể vô tình mở lại inherited tools.
- Sửa: giữ empty allowlist khi field được khai báo. Host restrict hỗ trợ empty Set; local tools theo thiết kế host không thuộc inherited-global restriction.
- [Tests](<../../../../dsh-tool-filter/test/filter.test.mjs>): 11/11 pass; có empty/normalized-empty/stale/deny cases. Generic restriction-error fallback cũ chưa được thay thành security sandbox.

### 4. Health mặc định có ghi config và gọi LLM ngầm — ưu tiên cao về side effects/chi phí

- [Shell health](<../../../../tools/dsh-health.sh>) trước đây gọi dump-config ghi generated config; [Hindsight health](<../../../../tools/hindsight-health.py>) tự gọi functional extraction dù mang nhãn dry-run.
- Sửa: mặc định passive; `--refresh-config` và `--functional` độc lập, phải opt-in; giữ alias passive `--skip-functional`; lỗi option bị từ chối trước probes. Path truyền qua argv thay vì nhúng vào JavaScript; empty/nonzero bundle count không được báo xanh.
- Tests riêng: [shell 11](<../../../../test/dsh-health.test.mjs>), [Hindsight 16](<../../../../test/hindsight-health.test.py>), orchestration 17 pass.
- Minh bạch: baseline đầu tiên đã chạy health cũ trước khi phát hiện side effects; không được nói toàn phiên tuyệt đối không có functional call. Sau sửa không chạy functional extraction thật.

### 5. Shim localhost nhận browser-origin POST và có thể crash do stream — ưu tiên cao

- [Shim](<../../../../tools/dsh-chatgpt-shim.mjs>): POST thiếu Host/Origin/content-type boundary; stream upstream lỗi có thể thành unhandled error làm chết process.
- Sửa: kiểm loopback Host và actual local port; từ chối mọi Origin/cross-site trước đọc body; exact parsed route, JSON content-type, malformed target trả 400; AbortController và awaited pipeline chứa lỗi/cancel, giữ SSE/status bytes.
- [Tests](<../../../../test/dsh-chatgpt-shim.test.mjs>): RED 9 failures; GREEN 38/38. Host test dùng `http.request` và xác nhận header thật trên wire, không dùng fetch Host override bị bỏ qua.
- Giới hạn: native local processes vẫn không có auth riêng; không thêm credential mới hoặc fixed deadline phá long stream. Không gọi bridge/model thật.

### 6. Candidate compression tests phụ thuộc moving installed bundle — ưu tiên vừa

- [Fixture loader](<../../../../patches/billion-context-tier-recovery/original.mjs>) dùng original `0.1.204` offline, verify SHA-256 cố định. [Generator](<../../../../patches/billion-context-tier-recovery/generate.mjs>) giữ pin, exact unique anchors và chống overwrite/live-owner output.
- Không repin sang runtime `0.1.209 (39a0ada5)` và không áp candidate vào runtime. 18 failures baseline chủ yếu là drift và thiếu helper của moving bundle, không phải chứng minh core recovery đang hỏng.
- [Provenance](<../../../../patches/billion-context-tier-recovery/original.provenance.json>), [license đầy đủ](<../../../../patches/billion-context-tier-recovery/LICENSE.original.txt>) và [giới hạn thử nghiệm](<../../../../patches/billion-context-tier-recovery/README.txt>) được giữ. Original source SHA `104502cb11fa98e205f61ba9cc0dde8d3d03b57d8330bfcbafe84f8d130ed2d9`.
- 24/24 pass; original targeted recovery vẫn fail với 0 summary calls và `fitsWindow=false`, chứng minh test không bị đổi thành xanh vô nghĩa.

### 7. Cache hit rate hiển thị sai mẫu số — ưu tiên vừa

- [Cost gate](<../../../../dsh-cost-gate/lib/index.js>): `cached/fresh` cho 900/100 thành 9 thay vì 0,9.
- Sửa: dùng lại helper canonical `cached/(fresh+cached)`; không thay quota/token/cost policy. [Tests](<../../../../dsh-cost-gate/test/wiring.test.mjs>): mixed, cache-only, fresh-only, empty; toàn plugin 21/21, env/temp được dọn/restored.

### 8. Append intent không hoạt động và baseline stale sau intent hợp lệ — ưu tiên vừa

- [Append guard](<../../../../dsh-append-guard/lib/index.js>): đọc `exec.args` sai; intentional early return không cập nhật baseline khiến append tiếp theo bị cảnh báo nhầm.
- Sửa canonical arguments và chấp nhận outline mới làm baseline sau intentional operation thành công. [Tests](<../../../../dsh-append-guard/test/wiring.test.mjs>): RED canonical và RED sequence; GREEN 40/40.
- Giữ giới hạn ID-only, không so body, reset theo turn; failed intent/missing outline không thay baseline.

### 9. Vibe guard bỏ sót Git globals và nhận quoted test text làm verification — ưu tiên cao trong guard contract

- [Policy](<../../../../dsh-vibe-guard/lib/policy.js>): nhận biết bounded literal executable positions, quoted arguments/comments, wrappers/pathname và literal shell `-c`; normalize Git globals trước built-in destructive subcommands.
- Không coi `printf`/comment chứa `node --test` là chạy test; không coi Git text trong arguments là executable Git. Custom/non-Git regex contracts giữ nguyên.
- [Tests](<../../../../dsh-vibe-guard/test/policy.test.mjs>): baseline 66 lên 92/92 pass; mỗi lớp wrapper/argument/pathname follow-up có RED riêng. Dangerous commands chỉ là chuỗi vào pure policy.
- Không phải shell AST/sandbox: heredoc, dynamic substitution, complex redirects, reachability/exit masking còn ngoài bảo đảm; literal recursion giới hạn 3.

### 10. 9router stop có thể signal PID bị tái sử dụng — ưu tiên cao

- [Launcher](<../../../../tools/9router-start.sh>): thay numeric kill/pkill pattern bằng identity UID/Node exe/argv hoặc exact local Next title/cwd, starttime, direct child và owned target socket; pin generation qua pidfd rồi revalidate.
- Supervisor đã xác minh nhận SIGKILL trước do upstream SIGTERM handler có unsafe numeric/group cleanup; chỉ listener đã pin nhận TERM và conditional KILL.
- [Tests](<../../../../tools/test/9router-process-safety.test.py>): 11/11 offline; có Next process-title compatibility. Không signal/restart process thật.
- Giới hạn: Linux/Python pidfd bắt buộc; legacy numeric pidfile giữ lại và từ chối stop, không tự migration. Unknown upstream layout fail closed.

### 11. Fuzzy patch revert khôi phục backup bundle cũ — ưu tiên cao về tính toàn vẹn

- [Patch helper](<../../../../tools/patch-toolname-fuzzy.mjs>): revert gỡ exact injection từ CURRENT bundle, không copy stale backup lên bundle đã upgrade; reject drift/partial/duplicate trước write, syntax gate và atomic rename.
- [Tests](<../../../../tools/test/patch-toolname-fuzzy-regression.test.mjs>): RED 7 failures; GREEN 9/9 qua VM filesystem stubs. Không patch/revert runtime thật.

### 12. Pipeline chọn ChatGPT Web khi shim còn sống nhưng bridge không sẵn sàng — ưu tiên vừa

- [Readiness](<../../../../tools/dsh-vibe-run.mjs>): yêu cầu shim `browser-only`, bridge `accepting_turns===true`, catalog có đúng desired model; lỗi transport/parse/shape fallback native.
- [Tests](<../../../../tools/test/dsh-vibe-readiness.test.mjs>): 19 cases pass cùng existing runner tests; không chạy pipeline/model thật.

### 13. Update làm mất managed overload patch; rollback đoán version/thiếu config — ưu tiên cao

- [Updater](<../../../../tools/dsh-update.sh>): forward dry-run `--fuzz=0` rồi apply, reverse dry-run nhận already-applied, source drift từ chối. Target provider scoped theo layout bản cài thật.
- Ghi actual old CLI version, rollback đòi đủ bốn config và version provenance trước install; khôi phục cả patch config. Legacy backup thiếu provenance không được đoán.
- [Tests](<../../../../tools/test/dsh-update-regression.test.mjs>): 8/8, mocked installers/paths, không chạy update/rollback live.
- Classifier overload của bản cài đã được áp đúng managed patch có sẵn sau RED 4 failures; regression 14/14 pass. Backup runtime được giữ ngoài Git. Process GUI đang chạy chưa restart nên không khẳng định đã nạp classifier mới.

### 14. New-project làm hỏng tên có ampersand/backslash/newline — ưu tiên vừa

- [Scaffolder](<../../../../tools/new-project.sh>): thay sed replacement bằng literal Bash substitution, không dùng command substitution làm mất trailing newline trong basename, hỗ trợ trailing slashes.
- [Tests](<../../../../test/new-project.test.mjs>): 7/7 tạo repo chỉ trong temp, isolated Git author/config. Không đổi Git config của người dùng.

### 15. Thiếu publication ignore cho secret names/artifacts — phòng ngừa

- [Ignore rules](<../../../../.gitignore>): thêm tên `.env`, environment variants với exceptions cho example/sample/template, credentials/key names cụ thể và local scratch roots. Không xem đây là bộ dò mọi loại secret.
- [Tests](<../../../../test/git-publication.test.mjs>): 3/3 dùng tên giả, không đọc secret. Existing tracked files không bị untrack hoặc xóa.

## Runtime/security đã kiểm tra

- Listener GUI chỉ bind `127.0.0.1:3080`. Unauthenticated `/` và `/index.html` trả 401; untrusted Host, Origin và cross-site request trả 403. 401 trên API path chỉ chứng minh auth-before-dispatch, không chứng minh endpoint tồn tại.
- Index đi qua authorization; static assets public theo thiết kế và có lexical root guard. Token/cookie values không đưa vào log audit.
- Authenticated workspace-file API có chủ đích cho phép đường dẫn ngoài workspace; GUI authenticated không phải workspace-only filesystem sandbox. Không probe authenticated RPC bằng token.
- Secret scan current tracked: 291 files, 27 binary skips, không có high-confidence key match. Reachable history: 113 commits, 442 blobs; 417 text/25 binary, không có high-confidence match. Không phải bằng chứng không tồn tại secret trong binary, reflog/unreachable objects hoặc data ngoài Git.
- Permission check trên credential/env path bị safety policy từ chối; không dùng đường khác để đọc. Phần đó **chưa verify**.
- Không upload repo để audit, không chạy registry advisory scan; dependency provenance/security ngoài những manifest/lock đã đọc **chưa verify**.

## Model budget theo nguồn — cập nhật sau yêu cầu bổ sung

- [Policy](<tools/web-model-budgets.yml>) đã thêm 8 ID còn thiếu và sửa budget từng route; defaults và toàn bộ `cgw` giữ 128000/16384, model lạ vẫn fail closed. Không áp 1M/128K hàng loạt.
- [Nguồn và bảng giới hạn](<docs/aegis/work/2026-10-29-dsh-audit/budget-sources.md>) phân biệt Codex OAuth 872000/128000 với BAI GPT 1050000/128000, GLM5.1 200000/128000 với GLM5.3 1000000/131072, và fallback vận hành với capacity đã xác nhận. Không chứng nhận upstream đã chấp nhận max context/output.
- [Test catalog](<test/model-budgets-catalog.test.py>) RED 5 tests với 16 subcase failures + 1 error trước policy; GREEN 5/5, bao phủ cả 19 route trong profile. Các expectation Node/Python cũ được cập nhật theo pair context/output, không bỏ negative tests. Full regression mới: **639 Node + 53 Python pass**, exit 0.
- Preview repair chỉ trong RAM: `or` 19 models và `cgw` 6 models đều 0 budget errors sau repair; routing và model IDs giữ nguyên; byte của live profile không đổi. Không ghi config và không khai `--writer-stopped` khi GUI còn chạy.
- Commit policy: `b09ebc7` — `fix: refresh per-route model budgets from local catalog`. Chưa áp live và chưa push.

## Vấn đề còn mở trước nghiệm thu toàn hệ

1. **Chưa áp model-budget vào profile live:** lỗi thiếu 8 policy IDs đã sửa trong repo; profile đang chạy vẫn giữ budget cũ. Health thụ động mới nhất vẫn 41 đạt, 1 lỗi, 2 bỏ qua, exit 1. Phải dừng DSH/GUI và mọi profile writer thật sự trước khi dùng repair offline, rồi restart/kiểm tra lại; không chỉ sửa số để che health.
2. **Chưa restart/runtime reload:** classifier trên đĩa và guard source mới chưa được chứng minh đã nạp trong process đang chạy. Restart có thể ngắt phiên này nên không tự thực hiện.
3. **UI smoke hạn chế:** đã thấy GUI authenticated bằng browser thật ở tablet/mobile, không sửa UI. Chưa có desktop đúng viewport, không claim full desktop/mobile E2E; browser tool gặp lỗi optional-field/session handling.
4. **Không có full upstream source:** không thể kết luận mọi core module/third-party HTTP/WS route đã audit. Không chạy user workload/model E2E, updater live hoặc process stop live.

Người dùng đã chọn sửa budget trước rồi mới push và cho phép tham khảo nguồn thay vì đo model. Phần còn cần phối hợp là cửa sổ dừng/restart DSH: phiên hiện tại chính là một writer, nên không tự gỡ guard hoặc khai sai trạng thái. Chỉ push sau khi đạt điều kiện nghiệm thu đã thống nhất hoặc người dùng thay đổi điều kiện đó rõ ràng.

## Cleanup an toàn

Đã kiểm tra canonical paths, regular-file identity, byte size và Git-untracked trước khi xóa đúng 5 artifact tái tạo: probe status và bốn file archive/dump metadata tạm. Tổng **262.964 bytes**, postcondition xác nhận file không còn tồn tại.

Giữ lại toàn bộ cache khoảng 2,1 GiB vì có repo nghiên cứu, source lab, staging và backup; không gọi tất cả là rác. Giữ lại log/PID artifacts khi identity đang không rõ: PID text `3` hiện có process, không signal/xóa theo số PID. Không chạy session cleaner live.

## Minh bạch quy trình

Một số lệnh shell của lead và agents đã gửi trường `sandbox_permissions` trái yêu cầu không-set của phiên. Không thấy approval prompt hoặc mở rộng quyền thực tế; phần lớn là read/tests, nhưng đây vẫn là lỗi tuân thủ, không được mô tả quy trình là hoàn hảo. Không dùng lỗi đó để biện minh cho escalation hoặc thao tác destructive ngoài phạm vi.

Review độc lập đã hoàn tất các nhóm small guards/publication/scaffolder, cleanup/shim, health/fixture và policy/operations; finding append-baseline và newline đã được tái hiện RED rồi sửa. Review budget bổ sung phát hiện doc ghi sai Qwen context và tên route fast: đã sửa về retained policy 128000/16384 và exact ID `cx/gpt-6.1-sol-fast`, đồng thời thêm coverage cả 19 route. Review source/offline không thay thế nghiệm thu runtime hoặc capacity upstream.

## Trạng thái tích hợp

Đã tạo **16 commit sửa riêng theo logic**, từ baseline `af834ed4bb47ce7ed4bf113c16cc8d5b39597733` đến budget commit `b09ebc7`; checkpoint/báo cáo được commit riêng. **Chưa push** theo lựa chọn sửa budget trước rồi nghiệm thu của người dùng. Không có branch/worktree mới cần xóa. Nhiệm vụ còn mở ở áp profile offline, runtime reload, health sau restart và push; không đánh dấu hoàn thành khi các bước này chưa verify.

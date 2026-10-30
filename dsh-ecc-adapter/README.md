# ECC–DSH adapter — selective native, Hindsight làm memory owner

Adapter cục bộ `0.2.0` cho DSH `0.2.1-rc.2`, đọc nguyên nguồn [ECC](https://github.com/affaan-m/ECC) tại pin `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29`. Không sửa upstream hoặc DSH core. DSH tiếp tục sở hữu instructions, permissions, model/provider routing; Hindsight là kho tri thức duy nhất. Đây là tích hợp **partial**, không phải bản sao toàn bộ runtime Claude Code.

## Trạng thái cài đặt

- Đã thử trong `ecc-lab`, sau đó cài local bundle vào profile `web` bằng CLI chính thức với install scripts bị tắt.
- Profile `web` bật `selective`, `enableMemory`, `enableHooks`; classifier chỉ cho chạy **một** upstream hook cảnh báo tên tài liệu. Không bật toàn bộ hooks.
- Main runtime đã tạo [status snapshot](</home/dzerok/.dsh/profiles/web/ecc-state/status.json>) với `ready-partial`, nạp ownership instructions và xuất bốn memory tools trong phiên thật.
- Model, credential, Hindsight config/bank, instructions native và các provider/preset khác được giữ nguyên.
- Bundle mặc định vẫn bảo thủ cho profile mới; không suy ra profile khác tự có cấu hình `web`. Xem [bundle](<cordis.patch.yml>) và [entry](<lib/index.js>).
- Sau restart đã kiểm tra native memory/config và nghiệm thu JSON `/ecc-status` người dùng gửi trên GUI; snapshot main đối chiếu lúc 10:37:38 +07 ngày 2026-10-30 khớp `ready-partial`, đủ 661 thành phần và ownership complete đúng workspace. Đây không phải bằng chứng E2E mọi upstream workflow.

## Kiểm tra native command trên GUI

Trong phiên parent của workspace, nhập **duy nhất** dòng dưới vào ô chat rồi Enter, không thêm lời nhờ AI hoặc dấu backtick:

```text
/ecc-status
```

Handler trả JSON có `adapter: dsh-ecc-adapter`, `status: ready-partial`, `parity: partial`, inventory/policy/ownership/native/memory/hooks. Command này không khai báo arguments và không gọi model. Theo contract GUI hiện cài, tên command không có descriptor hoặc thêm arguments có thể rơi về đường chat; đó chưa phải bằng chứng adapter hỏng. Nếu chỉ thấy câu trả lời AI dùng `memory_doctor`, cần xem khối kết quả command gốc, không tính memory report là nghiệm thu toàn bộ ECC.

## Coverage và owner

Inventory đủ **661** thành phần nguồn; có inventory không đồng nghĩa đã thực thi.

| Thành phần nguồn | Cách tích hợp / giới hạn |
| --- | --- |
| 311 skills | First-party filesystem provider giữ resources; native owner theo workspace/scope được ưu tiên. Same-name ECC có fallback ưu tiên thấp; reference-only khác tên không tự bật khi owner vắng. |
| 97 commands | Các mục được policy cho phép dùng namespace `/ecc-*`, queue prompt/arguments qua native followup; mục phụ thuộc CLI/host/persistence chưa hỗ trợ được giữ lại và ghi lý do. |
| 71 agents | Các persona được policy cho phép thành preset `ecc-*`, có tool allowlist và scope guard; kế thừa model route DSH, không giả tương đương Opus/Sonnet. |
| 121 rules | Common trước, sau đó language/path phù hợp; giữ ngân sách context. Rules persistence bị policy giữ lại. |
| 27 hook entries | Tất cả có classification; chỉ `PreToolUse:2:0` doc-file warning được chấp thuận và chạy trong containment. Native-owned không có nghĩa native tương đương upstream hoàn toàn. |
| 34 MCP templates | Inventory/reference, không tự chạy server, tải package hoặc nạp credential. |
| Memory / learning | `memory_save/search/read/doctor` đi qua Hindsight hiện có; không ECC vault, observer hoặc memory service mới. |

Snapshot main tại lúc mount ghi: `485 include`, `2 native-equivalent`, `8 reference-only`, `22 memory-redirect`, `30 disabled`, `114 review-required`. Đây là quyết định tại registration view, **không phải 485 chức năng đã chạy E2E**. Main thực đăng ký **52 commands**, giữ lại 45; **68 agents unsupported**, 3 policy-held. Native OPS tools chỉ được publish theo agent scope/lifecycle, còn ECC preset có generation scope độc lập: thấy tool trong parent không chứng minh tool có trong preset. Không copy tool hoặc nới scope để làm số đếm xanh. Preset generation/gọi model thật chưa được nghiệm thu. Hook được chọn có trạng thái `partial/degraded` vì containment không mount HOME/project/transcript; một script cảnh báo đã chạy được trong smoke, không phải full lifecycle parity. Fixture không có native owners cho con số khác; không dùng số fixture thay số host. `/ecc-status` bổ sung quan sát skill theo workspace/scope hiện tại.

## Memory contract

- Dùng bốn memory tools ở parent session. Chỉ scope `project` được route; kết quả `unreviewed`, không phải instructions.
- Reuse opt-in và bank native Hindsight theo workspace; từ chối route/bank override, remote endpoint, subagent, worktree không hỗ trợ và thay đổi config không khớp.
- `save` là create-only. Receipt có `documentId`, `operationId` khi biết; trạng thái `unknown` không cho phép tự retry bằng ID mới. Kiểm tra receipt trước.
- `search` tách ECC lexical ranking và native Hindsight semantic facts; `doctor` chỉ audit bridge/envelope/links có giới hạn, **không** kiểm toàn bộ ECC filesystem vault.
- Team/user sharing, cross-bank links đầy đủ, observer/instinct persistence và khôi phục nguyên session chưa hỗ trợ.
- Đã retain một quyết định được duyệt, operation completed; tiến trình mới và native tools đọc/tìm lại được. Không replay retain chỉ để kiểm tra.

## Kiểm chứng đã chạy

Trên entry thực được cài ở `web`:

```bash
ECC_ROOT=/home/dzerok/.dsh/ecc/source \
ECC_PLUGIN_ENTRY=/home/dzerok/.dsh/profiles/web/node_modules/dsh-ecc-adapter/lib/index.js \
node --test --test-concurrency=1 --experimental-test-coverage \
  --test-coverage-include='lib/**' test/
```

Kết quả cuối sau hai fix review: **114 tests, 114 pass, 0 fail, 0 skipped**, exit `0`; coverage **98.95% lines / 86.71% branches / 94.61% functions**. Bao gồm public SDK fixtures cho registration/disposal, scope/cwd ownership fallback, hook admission/Stop reentry/containment và memory routing/receipts/cancellation; một approved upstream doc-file warning chạy thật, không model call. Không suy ra mọi upstream workflow đã được kiểm E2E.

Các kiểm tra liên quan: ECC hook generator **11 pass / 0 fail**; loop guard **22/22**; vibe guard **92/92**. Main config compose exit `0`, stderr rỗng, đúng một adapter; manifest/patch cũ được bảo toàn ngoài mục ECC mới. Public native `memory_doctor`, `memory_read`, `memory_search` đều trả kết quả thật từ cùng bank Hindsight.

Sau khi người dùng restart DSH, PID main đổi thành `288382`, snapshot plugin được tạo lại và memory doctor/read/search vẫn hoạt động với bank cũ, không retain mới. Health sau restart: **42 đạt, 1 lỗi, 2 bỏ qua**, exit `1`; log `/tmp/ecc-A-postrestart-health.rMU4UX.log`. Nhóm lỗi có sẵn nằm ở model-policy/catalog (`contextWindow`/`maxTokens` không khớp kỳ vọng); chưa sửa vì ngoài phạm vi và không được đổi model/credential để che lỗi. Hai check bỏ qua không được tính pass. Người dùng sau đó đã gửi JSON native `/ecc-status`; đối chiếu snapshot main mtime `2026-10-30T03:37:38.631Z` xác nhận version 0.2.0, source pin đúng, ownership complete tại workspace hiện tại, 52 commands registered và Hindsight native-registered. Memory doctor cuối vẫn ok, 1 document, không broken links. Nghiệm thu command GUI là qua kết quả người dùng cung cấp, không phải browser automation. Exact upstream runtime parity và E2E mọi workflow vẫn chưa verify.

## Sử dụng

- `/ecc-status`: xem owner, trạng thái, collision, policy và phần chưa hỗ trợ; đọc snapshot đầy đủ khi cần chi tiết từng asset.
- Các command được đăng ký có tiền tố `/ecc-`; không nhầm với slash command native cùng mục đích. Presets ECC có tiền tố `ecc-`.
- Skills gọi bằng tên thật trong catalog hiện tại; không tự chạy script của skill bị withheld chỉ vì source còn tồn tại.
- Memory dùng bốn native tools đã nêu; không chạy ECC memory CLI hoặc mở kho phụ.
- Đây là `link:` tới workspace, không phải package đã publish. Di chuyển/xóa adapter hoặc checkout ECC sẽ làm hỏng đường dẫn. Update pin cần review policy và chạy lại tests; không auto-update upstream.
- Việc cài/gỡ hoặc đổi cấu hình plugin cần restart DSH để bảo đảm sạch lifecycle, dù phiên này đã quan sát thấy dynamic activation. Không kill tiến trình GUI đang phục vụ chính phiên làm việc này. Sau restart chạy lại health và `/ecc-status` tại GUI hiện có.

## Backup và rollback

Backup riêng tư trước rollout: [web-before-selective-20261030-075237](</home/dzerok/.dsh/ecc/backups/web-before-selective-20261030-075237/backup-manifest.json>), gồm manifest, lockfile, patch và composed config; thư mục `0700`, files `0600`. Không chia sẻ backup vì có thể chứa config riêng.

1. Gỡ đúng bundle khỏi `web`: `dsh plugin --profile web remove dsh-ecc-adapter`.
2. Khôi phục riêng override patch từ backup sau khi xác nhận không có thay đổi mới cần giữ; không restore đè cả profile nếu đã có thay đổi sau backup. Có thể xóa riêng row `id: dsh-ecc-adapter` thay vì restore nguyên patch.
3. Restart **cùng profile `web`**, kiểm tra lại compose/health. Không mở replacement GUI/server để giả là đã cập nhật GUI cũ.
4. Không xóa Hindsight, quyết định đã lưu, ECC source, global skills hoặc dữ liệu snapshot. Dữ liệu chẩn đoán còn lại chỉ dọn khi người dùng quyết định.

# ECC–DSH adapter trong profile thử nghiệm

## Kết quả và quyền đã chốt

Người dùng yêu cầu đọc tài liệu và cài ECC vào DSH, tự xử lý lỗi/thiếu liên quan. Sau so sánh, người dùng chọn hoàn thiện adapter ECC–DSH trong profile thử nghiệm riêng. Không thay profile `web`, không tự bật MCP cần credential, model ngoài hoặc kho memory thay Hindsight. Đây là kế hoạch triển khai được chốt từ lựa chọn đó; không cần phê duyệt lại cùng phạm vi.

## Baseline và nguồn chuẩn

- Workspace: `/home/dzerok/Documents/deepseek-harness/default-workspace`; HEAD trước triển khai `277729c`.
- DSH `0.2.1-rc.2`; ECC nguồn hiện có chỉ đọc tại `/home/dzerok/.dsh/ecc/source`, pin `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29`.
- Tài liệu và static audit: [ecc-integration-research.md](<../../../ecc-integration-research.md>); bridge/protocol exact `0.2.1-rc.2`, MIT, đã đối chiếu integrity nhưng chưa có bằng chứng runtime.
- Health baseline: `42 đạt, 1 lỗi, 2 bỏ qua`; lỗi model policy/catalog có trước, không sửa lựa chọn model ngoài phạm vi.
- DSH có native skills, command registry, agent presets, context/instructions, tool/lifecycle hooks. Không suy ra tương đương ECC chỉ từ tên tính năng.

## Phạm vi và tác động

Thêm package `dsh-ecc-adapter/` và profile `/home/dzerok/.dsh/profiles/ecc-lab`. Package tái sử dụng upstream source, không chép hoặc sửa nội dung ECC; inventory phải phản ánh toàn bộ skills/commands/agents/rules/hooks/MCP cùng trạng thái kích hoạt. Không ghi đè native command, preset hoặc global skill hiện có. Namespaced entry rõ ràng để tránh nhầm command ECC và DSH.

Giữ nguyên source ECC, profile web, global AGENTS/skills, memory hiện tại và checkout DSH. Dependency được ghim đúng phiên bản, không chạy install scripts chưa duyệt. Không khởi động server thay GUI hiện tại. Một profile riêng không tự tạo sandbox OS: hooks phải có containment thực hoặc mặc định không thực thi side effect chưa kiểm chứng.

Không yêu cầu kích hoạt mọi MCP: upstream cũng hướng dẫn chọn server theo nhu cầu. Không dùng Stop thay SessionEnd, không báo async/rewritten input/transcript hoạt động nếu chỉ có static bằng chứng. Host không có lifecycle public tương ứng thì ghi unsupported thay vì bịa event.

## TDD Route và seams nghiệm thu

TDD Route: standard, red → green cho từng lát; test qua public exports/SDK registration và profile compose/load, không khóa chi tiết nội bộ. Các seam dưới đây cụ thể hóa phạm vi adapter và kiểm chứng khoảng thiếu đã được người dùng chọn:

1. Inventory/source contract: pin, counts, collision handling và trạng thái source-present/registered/disabled/unsupported.
2. Native registrations: command nhận arguments và giữ prompt/confirmation; agent giữ prompt/tool restrictions với model mapping minh bạch, không gọi provider khác.
3. Skill/rule context: đúng resource root, common/language scope, precedence và không sửa AGENTS gốc.
4. Hook public boundary: JSON/exit decisions, deny không có side effect, input/context/async/deadline, lifecycle thật và sandbox/environment. Chỉ bật runtime hook sau khi evidence đủ.
5. Profile seam: compose đúng entry, mount thật trong fixture không provider credential/không LLM ngoài, toàn bộ package tests và health/regression liên quan; kiểm tra fingerprint web và source không đổi.

## Lát triển khai và owner

1. Lead: scaffold package, source inventory, skills/rules, profile bootstrap, integration và tài liệu/rollback.
2. Native-assets teammate: chỉ `dsh-ecc-adapter/lib/native-assets.js`, `dsh-ecc-adapter/test/native-assets.test.js`; public `registerNativeAssets(ctx, config)` nhận `eccRoot`, trả summary/disposers, không sửa profile/package chung. Commands dùng namespace `ecc-`; agent preset namespace `ecc-`; khám phá SDK thực, không giả API.
3. Hooks teammate: chỉ `dsh-ecc-adapter/lib/hooks.js`, `dsh-ecc-adapter/test/hooks.test.js`; public `registerHooks(ctx, config)` nhận `eccRoot`, `dataRoot`, `enableHooks`; trả status/disposers. Mặc định không chạy upstream side effects chưa containment. Dùng public DSH lifecycle thực, ghi gaps và test đỏ trước fix; không sửa core, upstream hoặc profile.
4. Lead ghép và chạy full test, verify profile thật, review diff và commit đúng phạm vi. Không tự push.

## Điều kiện giao và rollback

Không gọi đây là full behavioral parity nếu còn unsupported/disabled. Giao profile dùng được, lệnh sử dụng, coverage thực và phần chưa verify. Nếu native API khiến một tiêu chí không thể đáp ứng, giữ bằng chứng và tiếp tục phần độc lập; chỉ hỏi quyết định mới có ảnh hưởng lớn. Rollback chỉ tác động package/profile mới, không đụng web/source/global skills; kiểm tra đường dẫn tuyệt đối trước xóa/move. Trạng thái tiếp tục nằm trong [20-checkpoint.md](<20-checkpoint.md>), không tạo owner kế hoạch thứ hai.

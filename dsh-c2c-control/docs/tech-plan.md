# Tech Plan — DSH C2C control adapter

## Stack chốt

- Node ESM, node:test: khớp DSH hiện tại, test thuần không cần browser/network.
- Puppeteer Core với Chromium hệ thống: public browser API, không BrowserSkill hay private Codex transport; dependency phải khai báo riêng, không dựa vào dependency transitive của web profile.
- Native DSH plugin qua ctx.tools.register; giữ web server hiện hữu, không mở server DSH thay thế.
- Bridge C2C đã pin: dùng wrapper hiện hữu, không sửa Codex config hoặc provider.

## Kiến trúc module

- protocol: wire dưới 1024 bytes, kiểm tra state/task/iteration và giới hạn payload.
- checkpoint: lưu nguyên tử task/conversation/iteration/send intent; pending send không được tự retry.
- browser: chỉ Chromium sở hữu, profile riêng; lifecycle/cancel; DOM thao tác hẹp trên ChatGPT; allowlist URL.
- controller: begin/send/read/status/stop; matching reply và pause thay vì đoán khi DOM/auth không rõ.
- plugin: canonical JSON outputs, forwarding cancellation signal, service disposal.
- skill: phối hợp DSH execution và upstream MCP records; review không phải thẩm quyền thực thi.

Luồng: model DSH → native tool → controller → browser UI → ChatGPT → MCP → workspace; reply → controller → DSH.

## Cấu trúc

src/protocol.mjs, src/checkpoint.mjs, src/browser.mjs, src/controller.mjs, index.mjs, test/, docs/.

## Test và triển khai

Viết test đỏ rồi implement từng module. Unit tests không truy cập tài khoản. Smoke với Chromium riêng trước khi login. Sau plugin installation cần restart DSH và kiểm tra native tools thật, không coi import thành công là plugin đã hoạt động. E2E chỉ trên workspace mẫu được cho phép; toàn bộ dữ liệu ngoài workspace mẫu chưa được phép chia sẻ.

## Không quyết ở đây

Không xây UI mới, generic browser automation framework hoặc desktop shell. DOM selectors chốt từ trang thật sau khi người dùng đăng nhập trực tiếp. Không hứa reconnect tự động khi cần consent hoặc thông điệp gửi không rõ kết quả.

## Nguồn

- https://github.com/XiaoDuoYa/codex-with-chatgpt/tree/535a07dbb7aee887924c53767d985c09d405319d
- https://pptr.dev/api/puppeteer.launchoptions
- DSH installed tool registry API và lifecycle hiện tại, kiểm tra tại lúc implement.

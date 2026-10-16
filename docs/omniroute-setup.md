# OmniRoute local — setup hoàn chỉnh cho DeepSeek Harness

Cập nhật: 2026-10-10. Người vận hành: máy dzerok, systemd user (Linger=yes).

## 1. Kiến trúc chuỗi model

```
dsh web ──(provider "or", api anthropic-messages)──▶ headroom proxy 127.0.0.1:8787
                                                          │  (HEADROOM_MODE=cache, passthrough auth)
                                                          ▼
                                              OmniRoute  127.0.0.1:20128   ← systemd: omniroute.service
   hindsight-daemon :9077 ──(BASE_URL http://localhost:20128/v1, model gh/gpt-5.4-nano)──▶ │
   vision-router (cordis.patch.yml) ──(DIRECT http://localhost:20128/v1, b-ai/qwen3.8-flash)─▶│
                                                          ▼
              upstream: codex (alias cx) · bai=api.b.ai (b-ai) · antigravity (agy) ·
                        openrouter · opencode (oc) · github · ollama-cloud · zcode (zc)
```

## 2. systemd — nguồn gốc uy tín của tiến trình

- Unit: `systemd/omniroute.service` trong workspace (canonical), symlink ở `~/.config/systemd/user/omniroute.service`. Sửa unit → sửa file trong repo, rồi `systemctl --user daemon-reload`.
  - `ExecStart=~/.local/share/mise/installs/node/26.8.2/bin/omniroute serve --no-open --no-recovery`
  - `Restart=always`, `RestartSec=3`; supervisor tích hợp của OmniRoute đã TẮT (`--no-recovery`) để systemd là chủ duy nhất.
  - `PATH` được khai báo tường minh (mise không có trong PATH mặc định của user unit).
- CLI tự đọc `~/.omniroute/.env` — không cần EnvironmentFile trong unit.
- Đã `enable` → tự lên cùng boot (Linger=yes).
- Vận hành:
  - `systemctl --user status|restart|stop omniroute`
  - log: `journalctl --user -u omniroute -f`
  - KHÔNG dùng `omniroute stop`/chạy tay nữa (pid file `~/.omniroute/server/.pid` do instance tự ghi).

## 3. Bảo mật / network (`~/.omniroute/.env`)

- `OMNIROUTE_SERVER_HOST=127.0.0.1` (đổi từ `0.0.0.0` ngày 10/10; backup `.env.pre-systemd.bak`). Mọi client (headroom, hindsight, vision-router, dashboard) đều dùng localhost → không gián đoạn.
- `REQUIRE_API_KEY=false`: chấp nhận được vì chỉ bind loopback; DSH không nhét `OR_API_KEY` vào env. Nếu muốn bật auth: tạo key qua dashboard (DB đã có 4 key `sk-accdd051d…`, tên OmniRoute/jev/chatbot zalo/hindsight — cột `key` trong `~/.omniroute/storage.sqlite` là plaintext), rồi đưa `OR_API_KEY` vào môi trường khởi động `dsh` và restart dsh.
- ⚠ Mật khẩu dashboard `INITIAL_PASSWORD` vẫn là giá trị CHANGEME-like trong `.env` — nên đổi trong UI (Settings → Account). `AUTH_COOKIE_SECURE=false` (OK vì http://localhost).

## 4. Cơ chế "tường" context window của relay (nguồn gốc 128k)

`open-sse/services/contextManager.ts:17-27` `DEFAULT_LIMITS = {claude:200000, openai:128000, gemini:1000000, codex:400000, hyperagent/ha:1000000, default:128000}`.

`resolveTokenLimit(provider, model)` (:405) theo thứ tự ưu tiên:
1. env `CONTEXT_LENGTH_<PROVIDER>` (tên hoa, ký tự đặc biệt → `_`) hoặc `CONTEXT_LENGTH_DEFAULT`
2. DB per-model: `model_capabilities` (473 dòng, tất cả provider=openrouter) + `model_context_overrides` (chỉ có codex gpt-5.5* = 272000) — override exact thắng
3. `REGISTRY[provider].defaultContextLength` (b-ai/cx/agy không đặt)
4. hint tên model: `claude`→200k, `gemini`→1M, `gpt|o1|o3|o4|codex`→400k
5. `DEFAULT_LIMITS[provider]` → không có → 128000 non-specific

Hệ quả với model DSH đang dùng (kiểm chứng 10/10/2026):

| Model id trong DSH | Resolve tại relay | Tường thực tế |
|---|---|---|
| `b-ai/qwen3.8-flash` (mặc định) | không DB row, không hint | **128000** |
| `b-ai/deepseek-v4.1-flash`, `b-ai/glm-5.3-flash` | như trên | **128000** |
| `cx/gpt-6-astra`, `cx/gpt-6-sol`, `cx/gpt-6-luna` | hint `gpt` → codex | 400000 (không phải giá trị thật!) |
| `antigravity/gemini-3.8-flash-tiered` | hint `gemini` | 1000000 |

- Vì vậy DSH **giữ `defaultContextWindow: 128000`** trên route `or` (auto-compaction của dsh trigger ở min(W·0.8, W−maxTokens−65536) ≈ 46080 với W=128000, comfortably dưới tường).
- Muốn nâng lên cửa sổ thật (~1M cho b-ai/*): chèn `model_context_overrides` (dashboard UI hoặc SQL, `source='manual'`), NÂNG `defaultContextWindow` trong profile + restart dsh, và chỉ làm khi đã kiểm chứng upstream nhận input >128k thật (bằng chứng duy nhất hiện tại: openrouter capabilities cùng dòng họ model = 1048576).
- Lối tắt thô (không khuyến nghị): `DISABLE_CONTEXT_WINDOW_CHECKS=true` (env, flag store xem `src/shared/utils/featureFlags.ts:79`) — relay sẽ đẩy request to lên upstream và ăn lỗi chậm hơn.

## 5. Trạng thái model id (đã test live 10/10/2026, prompt "ok")

- ✅ `b-ai/qwen3.8-flash`, `b-ai/deepseek-v4.1-flash`, `b-ai/glm-5.3-flash` (HTTP 200)
- ✅ `cx/gpt-6-astra|sol|luna` — `cx` là **alias của codex** (`registry/codex/index.ts:11`), response id `chatcmpl-resp_…`
- ✅ `antigravity/gemini-3.8-flash-tiered` (200). Lưu ý: prefix `agy/…` cũng map về provider antigravity, nhưng `agy/gemini-3.8-flash-medium` KHÔNG tồn tại trong live catalog → đã được thay trong profile (user sửa qua GUI 15:50).
- ❌ `b-ai/jev-latest`: 400 `requires /v1/decisions` (endpoint không relay-forward). Nếu cần jev qua đường khác: catalog có `openrouter/typesafe/jev-router`, `oc/jev-1.13`, `b-ai/jev-1.13.0` — chưa test.
- Nguồn liệt kê đầy đủ: `curl -H "Authorization: Bearer <key DB>" http://localhost:20128/v1/models` (1654 id).

## 6. Mẹo CLI

```bash
omniroute <cmd> 2>/dev/null | grep -vE '📋|⚠'   # lọc cảnh báo .env trùng trong node_modules
omniroute simulate --model b-ai/qwen3.8-flash   # dry-run routing, không gọi upstream
omniroute cost / usage                          # báo cáo chi phí/quota
```

## 7. Việc còn treo (tùy chọn, cho lần sau)

1. Đổi mật khẩu dashboard (CHANGEME), bật `REQUIRE_API_KEY=true` + wire `OR_API_KEY` nếu muốn khóa API.
2. Dọn kết nối inactive trong dashboard: `agy` (oauth dragonsp1122, unavailable), `antigravity` (oauth dragonsp1122), bản sao `codex` trùng account.
3. `b-ai/jev-latest` vẫn nằm trong model list DSH — chọn trong UI sẽ fail; cân nhắc xóa.
4. Nâng context window 1M theo mục 4 khi có nhu cầu session dài.

## GPT-6.1 Sol Fast — cấu hình ngày 16/10/2026

- Giữ `CODEX_CLIENT_VERSION=0.160.0` trong unit để vượt kiểm tra phiên bản client của upstream.
- Model mới: `cx/gpt-6.1-sol-fast`; alias ngắn: `gpt-6.1-sol-fast`.
- Fast không phải model upstream riêng: payload rule chỉ khớp `gpt-6.1-sol-fast` trên protocol `codex`, đổi `model` thành `gpt-6.1-sol` và đặt `service_tier=priority` trước khi gửi upstream.
- Không bật Fast toàn cục; `cx/gpt-6.1-sol` không khớp rule này.
- Cấu hình tái lập: [omniroute-fast-model.json](../systemd/omniroute-fast-model.json). Đây là bản ghi cấu hình, không tự được OmniRoute nạp. Khi khôi phục, POST `providerModel` tới `/api/provider-models`, PUT `alias` tới `/api/models/alias`, rồi thêm `payloadRule` vào mảng `override` hiện có qua PUT `/api/settings/payload-rules`. Phải giữ lại các rule khác và dùng API key có scope `manage`; không ghi key vào repo.
- Kiểm thử live: hai tên Fast và model thường đều HTTP 200, output `OK`. Response không công bố `service_tier`, vì vậy kiểm thử này chưa chứng minh upstream thực sự phân bổ tài nguyên priority hoặc nhanh hơn. Priority có thể ảnh hưởng quota/chi phí theo tài khoản.

## 8. Kiểm tra nhanh sau máy chạy lại

```bash
systemctl --user is-active omniroute headroom-proxy hindsight-daemon
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:20128/api/health   # 200
ss -ltn | grep 20128   # chỉ 127.0.0.1
bash tools/dsh-health.sh
```

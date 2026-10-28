# dsh-cost-gate

Cổng chi phí theo turn cho DeepSeek Harness. Plugin thụ động: không thêm tool,
không sửa prompt, chỉ đọc usage thật của từng request model và chặn bước kế
tiếp khi turn vượt ngân sách.

## Vì sao cần

Mỗi bước agent = một request model = một lần đốt token. Session log
(`assistant/message`) **không** mang usage, nên không thể đo bằng cách đọc lại
log. Plugin bắt chunk `usage` ngay trên `llm/stream` — cùng nguồn với
token-meter của host — rồi cộng dồn theo turn/session.

## Ngân sách mặc định

| Chỉ số | Mặc định | Ý nghĩa |
|---|---:|---|
| `turnFreshTokens` | 150.000 | input CHƯA cache (dsh-llm tách riêng cacheRead), mỗi turn |
| `turnOutputTokens` | 60.000 | output (gồm reasoning), mỗi turn — **chỉ cảnh báo, không chặn** |
| `sessionFreshTokens` | 3.000.000 | token mới, cả session |
| `maxStepsPerTurn` | 60 | số request model, mỗi turn |
| `warnRatio` | 0.8 | bắt đầu ghi cảnh báo |
| `missFreshThreshold` | 50.000 | fresh input bị coi là cache miss đáng ngờ |
| `consecutiveMissWarn` | 3 | số miss liên tiếp để cảnh báo |

Vượt ngân sách: plugin trả `{ kind: 'reject' }` ở `agent/pre-step`; agent-loop
kết thúc turn với lý do `blocked` **trước khi** gọi model thêm lần nữa.

Chỉ 3 mốc cứng mới chặn: `turnFreshTokens`, `sessionFreshTokens`,
`maxStepsPerTurn`. Riêng `turnOutputTokens` là **soft-limit**: vượt chỉ ghi cảnh
báo. Lý do (lỗi 28/10/2026): chặn theo output làm turn chết im lặng — agent đang
giữa mạch suy luận, không kịp gọi `text` nên người dùng không nhận được chữ nào
(3 preset Vibe xong việc mà màn hình trống, chỉ còn việc đã làm).

## Điều khiển

- Tắt hẳn: `DSH_COST_GATE=off`.
- Cho qua một lần (không tắt cổng): tạo file `~/.dsh/cost-gate-allow`, xoá file
  để bật lại.
- Xem trạng thái: `~/.dsh/cost-gate-status.json` — token từng session, hit rate,
  turn bị chặn và lý do.

## Cài trong profile

Profile `web` đã cài dạng bundle:

```bash
cd ~/.dsh/profiles/web
pnpm add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-cost-gate
```

và `dsh.profile.bundles` có `dsh-cost-gate`. Restart DSH để plugin được nạp.

## Test

```bash
node --test test/
```

10 test: 7 luật thuần (`lib/policy.js`) — fresh token, cộng dồn, reset
turn, warn/block, giới hạn bước, giới hạn session, cảnh báo cache miss — và 3 wiring test hook thật.
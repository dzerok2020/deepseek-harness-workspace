# Nguồn kiểm chứng model budget DSH

Ngày đối chiếu: **2026-10-29**. Không gọi inference hoặc đo giới hạn. Khảo sát công khai bên dưới dùng 7 lượt tìm kiếm Exa và 6 lượt đọc trang, không đọc config/credential. Sau đó lead đối chiếu riêng catalog OmniRoute đã đăng nhập, source adapter cài trên máy và hai trường budget trong cache discovery SQLite read-only; không đọc credential, provider connection hoặc payload hội thoại.

## Policy vận hành đã cập nhật từ catalog cục bộ

Nguồn cho alias đang dùng là [OmniRoute cục bộ](<http://127.0.0.1:20128>), màn hình **Models & Combos**, tìm theo prefix/ID đầy đủ và đọc hai cột **Context / Max output**. Không bấm Refresh, Test, Test all, Restart hay Shutdown. Catalog có thể dùng enrichment/fallback của router; đây **không phải bằng chứng endpoint đã chấp nhận request ở mức tối đa**. Bảng dưới ghi rõ phần nào giữ operating cap thay vì nhận là capacity được nhà cung cấp xác nhận.

| Route đang cấu hình | contextWindow | maxTokens | Căn cứ / giới hạn |
| --- | --- | --- | --- |
| `cx/gpt-6-astra`, `cx/gpt-6-sol`, `cx/gpt-6-luna`, `cx/gpt-6.1-sol`, `cx/gpt-5.6-terra` | 872000 | 128000 | UI, cache discovery của đúng 5 ID và constant Codex OAuth trong adapter cùng khớp. Không lấy 1050000 của public API áp cho OAuth. |
| `nr-ai/deepseek-v4-flash`, `nr-ai/deepseek-v4-flash-0731` | 1000000 | 384000 | Query `nr-ai/deepseek-v4-flash` có 3 hàng và cả 3 cùng số này; là metadata catalog, chưa chứng nhận upstream. |
| `nr-ai/glm-5.1` | 200000 | 128000 | Query đúng ID có 1 hàng; không đổi thành 1M theo mặc định họ GLM. |
| `nr-ai/glm-5.3-flash`, `b-ai/glm-5.3-flash` | 1000000 | 131072 | UI đối chiếu từng route; query BAI có 2 hàng và cả 2 cùng số này. |
| `b-ai/gpt-6.1-sol` | 1050000 | 128000 | Query đúng prefix có 6 variants cùng số này; không gộp với route Codex `cx/`. |
| `b-ai/gemini-4-argon` | 1048576 | 65536 | Query đúng ID có 1 hàng. |
| `antigravity/gemini-3.8-flash-tiered` | 1048576 | 65536 | Giữ context policy sẵn có; output 65536 lấy từ cache discovery đúng ID. Cache không quảng bá input limit, nên không gọi context này là upstream-verified. |
| `nr-ai/deepseek-v4.1-flash`, `nr-ai/qwen3.8-flash`, `nr-ai/grok-4.7` | 128000 | 16384 | UI lần lượt có 2, 1, 1 hàng: context 128000, output trống. 16384 là operating cap bảo thủ giữ từ profile, **không phải max output đã xác nhận**. |
| `b-ai/deepseek-v4.1-flash` | 128000 | 16384 | Giữ policy hiện có, không suy ra từ DeepSeek direct API. |
| `b-ai/qwen3.8-flash` | 128000 | 16384 | Giữ policy hiện có; không thêm tuyên bố capacity mới từ tên model. |
| `gpt-free` | 104000 | 16384 | Giữ policy hiện có của route riêng. |

[Overlay policy](<tools/web-model-budgets.yml>) chỉ thêm 8 ID hiện có nhưng thiếu trong policy và sửa các trường budget có căn cứ ở trên. Defaults của `or` và toàn bộ `cgw` vẫn 128000/16384; model lạ tiếp tục bị từ chối. `cx/gpt-6.1-sol-fast` không nằm trong catalog profile đang dùng nên không thay limit cũ của route đó.

### Source adapter và cache đã đối chiếu

- [Codex registry](</home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/omniroute/open-sse/config/providers/registry/codex/index.ts#L9-L21>) ánh xạ `cx` sang Codex OAuth; các ID nói trên dùng `GPT_5_6_CODEX_CAPABILITIES`.
- [Capabilities](</home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/omniroute/open-sse/config/providers/shared.ts#L370-L398>) tách public API 1050000/128000 và Codex OAuth 872000/128000.
- SQLite chỉ đọc bằng URI `mode=ro`, `PRAGMA query_only=ON`, trong read transaction. Chỉ chiếu metadata ID/prefix của `provider_nodes` và `inputTokenLimit`/`outputTokenLimit` của `syncedAvailableModels` trong `key_value`; không đọc `provider_connections`, apiKey, headers, env hoặc hội thoại. 5 ID `cx` khớp trên mọi cached connection; input/output của BAI/NR đều null nên UI enrichment không được gọi là giới hạn upstream đã khai báo.
- Bản sửa expectation ban đầu cho NR `deepseek-v4.1-flash` từ 1M/384000 xuống 128000/16384 được thực hiện **trước sửa policy**, sau query đầy đủ chỉ ra 2 hàng cuối không giống 5 hàng đầu của bộ lọc rộng. RED được chạy lại sau khi sửa dữ liệu nguồn; không lấy phần danh sách chưa đọc làm bằng chứng đầy đủ.

### Verification và áp dụng

[Regression catalog](<test/model-budgets-catalog.test.py>) có RED trước policy: `Ran 5 tests`, `FAILED (failures=16, errors=1)`, exit 1; sau policy: `Ran 5 tests`, `OK`, exit 0. [Health regression](<test/orchestration-health.test.py>) cập nhật expectation output theo đúng route, 17 tests OK. Kiểm tra repair giữ nguyên routing URL, tên biến môi trường, display name, comment và danh sách model; repair lần hai không đổi nội dung.

**Chưa áp profile đang chạy.** [Repair guard](<tools/model_budgets.py#L184-L207>) bắt buộc dừng mọi DSH/GUI/profile writer trước `--writer-stopped`. Không gỡ guard, không khai sai rằng GUI đã dừng và không gọi LLM để chứng minh capacity. Cần áp offline hoặc qua cơ chế ghi native đã được xác minh rồi mới nghiệm thu health/push.

## Kết quả khảo sát công khai trước đối chiếu cục bộ

**Chưa đủ bằng chứng để đặt 1M context / 128K output cho 12 alias dưới đây.** Kết quả tìm kiếm tên đầy đủ không cung cấp tài liệu chính chủ xác nhận `nr-ai/*` hay `cx/*` trỏ đến model/version nào. Đây là giới hạn của khảo sát có ngân sách, không phải chứng minh các alias không tồn tại.

Context capacity và max output là hai giới hạn khác nhau. Output dài tối đa không phải ngân sách dùng an toàn cho mỗi lượt: còn phải xét input, tổng giới hạn request và cách endpoint tính reasoning/tool tokens. Không cộng hoặc trừ hai số khi nguồn chưa quy định quan hệ đó; không đổi `1M`, `384K` thành số nguyên khi nguồn chưa định nghĩa đơn vị.

## Số liệu đọc được trực tiếp từ nguồn chính chủ

| Model/ID trong nguồn | Context capacity | Max output | Độ tin cậy và phạm vi |
| --- | --- | --- | --- |
| DeepSeek API `deepseek-flash`, version `DeepSeek-V4.1-Flash-1017` | `1M` | `MAXIMUM: 384K` | Cao cho đúng endpoint/version của [S1]; **không chứng minh** bất kỳ alias `nr-ai/*` nào. |
| xAI `grok-4.7` | `500,000` token | Chưa xác định; trang không nêu max output | Cao cho context được ghi ở [S2]; chưa có căn cứ cho output hoặc mapping `nr-ai/grok-4.7`. |

Không thể lấy cặp `1M / 128K` làm quy tắc chung từ các tên trên. Khảo sát này không đủ để kết luận “đa số model mới” có giới hạn nào; cũng không áp giới hạn của version hiện hành lên snapshot cũ.

## Trạng thái từng alias được yêu cầu

Dấu `?` nghĩa là **chưa có bằng chứng primary cho chính alias đó**, không phải giới hạn bằng 0 hay model không hỗ trợ.

| Alias chính xác | Context | Max output | Trạng thái bằng chứng |
| --- | --- | --- | --- |
| `nr-ai/deepseek-v4-flash` | ? | ? | Chưa xác minh mapping; [S1] là ID/version khác. |
| `nr-ai/deepseek-v4.1-flash` | ? | ? | Tên gần [S1] không chứng minh cùng endpoint/version. |
| `nr-ai/glm-5.1` | ? | ? | Chưa xác minh mapping hoặc capacity của alias. |
| `nr-ai/qwen3.8-flash` | ? | ? | Có trang model chính chủ [S3], nhưng chưa có mapping alias. |
| `nr-ai/glm-5.3-flash` | ? | ? | [S6] có liên kết GLM-5.3-Flash/FlashX; không đủ để gán số cho alias. |
| `nr-ai/deepseek-v4-flash-0731` | ? | ? | Có model card chính chủ [S4], nhưng chưa có mapping alias; không lấy số version 1017 thay cho 0731. |
| `nr-ai/grok-4.7` | ? | ? | Số chính thức ở [S2] không tự xác nhận endpoint `nr-ai`. |
| `cx/gpt-5.6-terra` | ? | ? | Chưa tìm được tài liệu chính chủ xác nhận mapping alias. |
| `cx/gpt-6.1-sol` | ? | ? | Chưa tìm được tài liệu chính chủ xác nhận mapping alias. |
| `cx/gpt-6-astra` | ? | ? | Trang OpenAI [S5] không xác nhận namespace `cx`. |
| `cx/gpt-6-sol` | ? | ? | Chưa tìm được tài liệu chính chủ xác nhận mapping alias. |
| `cx/gpt-6-luna` | ? | ? | Chưa tìm được tài liệu chính chủ xác nhận mapping alias. |

**Khuyến nghị cho lead:** không nâng hard limit từ tên model hoặc mặc định gia đình. Cần tài liệu công khai của bên sở hữu endpoint xác nhận alias → model/version và cả hai giới hạn; nếu thiếu, giữ trạng thái unknown, không trình bày fallback vận hành như capacity đã xác nhận. Bản ghi này không sửa cấu hình hay chứng nhận giới hạn thực tế của endpoint.

## Nguồn và giới hạn

Tất cả URL dưới đây được đọc ngày **2026-10-29**; không suy ngày xuất bản từ ngày truy cập. Chỉ [S1] và [S2] có trường số liệu đủ rõ trong nội dung trích được để đưa vào bảng capacity. Nội dung trả về của [S3]–[S6] bị cắt; không dùng snippet tìm kiếm hoặc phần chưa đọc được để tự điền số.

- **[S1]** DeepSeek, [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing): ghi `deepseek-flash`, `DeepSeek-V4.1-Flash-1017`, `CONTEXT LENGTH | 1M`, `MAX OUTPUT | MAXIMUM: 384K`.
- **[S2]** xAI, [Grok 4.7 model](https://docs.x.ai/developers/models/grok-4.7): ghi ID `grok-4.7`, `Context window 500,000`; không thấy trường max output trong nội dung đọc được.
- **[S3]** Alibaba Cloud, [qwen3.8-flash Model Info](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-flash).
- **[S4]** DeepSeek, [DeepSeek-V4-Flash-0731 model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731).
- **[S5]** OpenAI, [Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model).
- **[S6]** Z.ai, [Overview](https://docs.z.ai/guides/overview/overview).

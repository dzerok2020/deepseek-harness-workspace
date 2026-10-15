# Thử nghiệm A/B kỹ năng ECC trên plugin thật (15/10/2026)

## Câu hỏi và phạm vi

Liệu việc **hướng dẫn agent bằng ba skill ECC** có cải thiện chất lượng sửa code so với agent không dùng những hướng dẫn đó? Đây là **một thử nghiệm đối chứng nhỏ**, không phải benchmark tổng quát hoặc bằng chứng nhân quả về chất lượng ECC. Nguồn thử nghiệm là bản sao độc lập của plugin thực tế `dsh-vibe-guard/`; **không áp dụng bản sửa thử nghiệm vào plugin đang sử dụng**.

- Regression có thật trong `dsh-vibe-guard/lib/policy.js`: lệnh shell được phân loại `verify` ngay khi có một mẫu test, bỏ qua một thao tác sửa file xảy ra sau test trong cùng invocation. Ví dụ `node --test test/ && echo generated > report.txt` phải để lại *verification debt* (nghĩa vụ kiểm tra lại phần vừa sửa); `echo generated > report.txt && node --test test/` có thể được tính là đã kiểm tra.
- Hai bản sao cùng nguồn, cùng mô tả nhiệm vụ và yêu cầu thêm regression test, chạy toàn bộ test, không dùng network, không sửa workspace thật. Baseline không được hướng dẫn đọc ECC; arm ECC được hướng dẫn đọc `change-impact`, `test-collaboration`, `module-regression` từ checkout ECC đang cài. Các bài kiểm tra chấm độc lập ở ngoài cả hai bản sao, agent sửa code không được xem trước.
- Kiểm tra khả dụng của CLI ngoài trước đó **không thành công**: `opencode run` với `openai/gpt-5.4-mini` và `openai/gpt-5.3-codex-spark` đều bị từ chối (`The ... model is not supported when using Codex with a ChatGPT account.`); `opencode/ling-3.1-flash-free` trả `Unexpected server error`. Vì vậy hai arm thực tế được chạy bằng hai **subagent** của phiên hiện tại, không phải OpenCode. Đây là giới hạn kiểm soát môi trường; không tính các lượt CLI lỗi là kết quả lập trình.

## Kiểm chứng độc lập

Kiểm tra nguồn gốc trước sửa bằng `EVAL_ARM="$PWD/dsh-vibe-guard" node --test /tmp/ecc-ab-20261015/hidden/acceptance.test.mjs`: **4 pass, 2 fail** — lỗi gốc tái hiện đúng ở tình huống check→write với `&&` và `;`.

| Chỉ số | Baseline | Có hướng dẫn ECC |
|---|---:|---:|
| Kiểm tra mù (`EVAL_ARM=/tmp/ecc-ab-20261015/<arm> node --test /tmp/ecc-ab-20261015/hidden/acceptance.test.mjs`) | 6/6 pass | 6/6 pass |
| Test module (`node --test test/policy.test.mjs`, chạy trong bản sao tương ứng) | 21/21 pass | 20/20 pass |
| Full suite ban đầu, trước khi liên kết dependency (`node --test test/`) | 21 pass, 1 fail | 20 pass, 1 fail |
| Full suite khi dùng dependency DSH thật, không tải mạng (`node --test test/`) | **28/28 pass** | **27/27 pass** |
| Test tái lập: phân loại + shell thật + plugin wiring (`EVAL_ARM=... node --test tools/ecc-ab-verify.mjs`) | **4 pass, 1 fail** | **4 pass, 1 fail** |
| Tệp code được sửa | `lib/policy.js`, `test/policy.test.mjs` | `lib/policy.js`, `test/policy.test.mjs` |

**Đã khắc phục trở ngại môi trường của thử nghiệm, không sửa plugin gốc hoặc tải mạng:** package `@deepseek-ai/dsh-llm` đã có sẵn dưới bản cài DSH tại `/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm`. Tạo symlink chỉ trong hai bản sao `/tmp/ecc-ab-20261015/{baseline,ecc}/node_modules/@deepseek-ai/dsh-llm` đến cùng package đó. Trước đó full suite lỗi `ERR_MODULE_NOT_FOUND` trong `test/wiring.test.mjs`; **chạy lại sau liên kết: baseline 28 pass/0 fail, ECC 27 pass/0 fail**, bao gồm bảy test wiring ở mỗi arm. Số test khác nhau vì baseline thêm 2 test, ECC thêm 1 test, không phải thước đo chất lượng.

**Bài kiểm tra đối chứng có thể chạy lại** được lưu ở `tools/ecc-ab-verify.mjs`. Một test dạng bảng có tám case phân loại, tương đương phạm vi của sáu test mù ban đầu (test mù đầu tiên còn kiểm tra trạng thái gate). **Bốn test tiếp theo thực thi shell và đường nối plugin**: chạy lệnh bằng `bash` thật trong thư mục tạm, kiểm tra file thực được tạo, kết quả lệnh, `classifyCall`→`noteCall`/`shouldForceVerify`, rồi phát `tools/post-execute`→`agent/turn-stopping` và đếm thông điệp `steer`. Với cả hai bản sửa, *test trước→ghi sau* và *ghi trước→test đạt* đều pass; *lệnh lỗi trước `&&` ghi* không ghi gì và pass. **Một phản chứng fail ở cả hai:** `echo changed > report.txt && false` có exit 1 nhưng file đã được ghi; `kind: 'edit'`, `modified: true`, song `debt: false`, `steers: 0` thay vì `debt: true`, `steers: 1`. Vì vậy full suite xanh **không** chứng minh verification gate xử lý đúng mọi lệnh shell ghép. File kiểm tra cố ý giữ assertion fail như một regression test chưa được sửa, không gộp vào test production.

Cách tái lập trên máy này từ root workspace (không cần network):

```bash
DSH_LLM=/home/dzerok/.local/share/mise/installs/node/26.8.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm
for arm in baseline ecc; do
  root="/tmp/ecc-ab-20261015/$arm"
  mkdir -p "$root/node_modules/@deepseek-ai"
  ln -sfn "$DSH_LLM" "$root/node_modules/@deepseek-ai/dsh-llm"
  (cd "$root" && node --test test/)
  EVAL_ARM="$root" node --test tools/ecc-ab-verify.mjs
done
```

Đầu vào `/tmp/ecc-ab-20261015/{baseline,ecc}` là **bản sao code hai agent đã sửa**, không tự tái tạo được chỉ từ commit tài liệu. Bộ kiểm tra `tools/ecc-ab-verify.mjs` được lưu Git; code hai agent và prompt gốc vẫn ở `/tmp`, có thể mất sau khi dọn hệ thống. Nếu cần lặp thử nghiệm độc lập lâu dài, phải lưu riêng bản sao/patch và prompt đã rà soát, kèm hash nguồn và seed/model; không nên coi bảng một lần này là benchmark hoàn chỉnh.

Hai bản sửa đều chọn vị trí xuất hiện cuối của pattern `verify`/`edit` trong chuỗi command để phân loại. ECC arm kiểm tra trạng thái `summarize(...).pendingVerification` trong test mới; baseline cũng kiểm tra `noteCall`/`shouldForceVerify` ở test của mình. Không arm nào xây dựng parser shell hoặc theo dõi riêng từng câu lệnh được thực thi. **ECC subagent bị ngắt trước khi gửi báo cáo hoàn tất**; kết quả ECC trong bảng là các lệnh chấm/test do người điều phối chạy trực tiếp trên những tệp agent đã để lại, không phải tự khai của agent. Điều này càng hạn chế so sánh về quy trình/thời gian.

## Kết luận có thể bảo vệ

**Trong đúng một regression này: không quan sát thấy ECC cải thiện kết quả chức năng** — cả hai sửa được lỗi theo 6 test mù; full suite của cả hai đã pass sau khi liên kết dependency có sẵn; cả hai cùng fail phản chứng shell thật ở đường nối plugin. Đây là một lỗi thực về an toàn của verification gate còn lại trong **hai bản sửa thử nghiệm lẫn logic gốc**; không được đưa bản sửa regex của arm nào vào plugin production như thể nó đã đạt chuẩn. Không có cơ sở nói ECC tăng chất lượng code hay tăng năng suất bao nhiêu phần trăm. ECC arm đã nhận nhiều hướng dẫn hơn nên prompt/token, thời gian và hành vi agent không được kiểm soát hoàn hảo; hai subagent có thể khác seed/context, chỉ một nhiệm vụ và không có lặp mẫu hay blind code-review scoring.

**Giới hạn của chính bài test:** regex dò thứ tự văn bản không mô phỏng đầy đủ shell execution (`&&`, `||`, pipeline, quote, heredoc, exit khác 0, lệnh ghi file bên trong npm script). `noteCall(..., false)` có thể bỏ qua cả lệnh ghép dù một thao tác edit trước đó đã chạy. Sáu test chấp nhận xác minh các đường đi điển hình, **không xác nhận logic là an toàn cho mọi shell command**. Đã chạy ca `write && failing-check`, `failing-check && write` và wiring với dependency đầy đủ như trên; bước kế tiếp cần thiết là thiết kế bản sửa phân biệt file đã ghi khi invocation trả lỗi, thêm multi-step state và các cấu trúc shell khó hơn, rồi chạy lại full suite + phản chứng cho đến khi đều pass trước khi xét áp dụng vào plugin thật.

Các tệp thử nghiệm tồn tại trong `/tmp/ecc-ab-20261015/` chỉ để kiểm chứng cục bộ, không là bản phát hành hoặc phần cài đặt. Plugin gốc và các skill ECC đã cài vẫn giữ nguyên.

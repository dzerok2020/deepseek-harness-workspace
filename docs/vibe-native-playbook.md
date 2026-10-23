# Vibe coding trực tiếp trong DSH

## Phạm vi và mức bảo đảm

Áp dụng trong workspace này qua AGENTS.md; không phải plugin mới hay sửa lõi DSH. Đây là hướng dẫn agent, không phải enforcement bằng mã. Sandbox, approval, bảo vệ credential, guard và quy trình nghiệm thu hiện có vẫn là nguồn thẩm quyền. Hiệu quả về chất lượng/token/chi phí: **chưa đo**. Không cài Harness2 hoặc tạo runtime đánh giá khác.

## 1. Tác vụ thật — chọn nhánh trước khi làm

Đọc ngữ cảnh đủ để chốt tiêu chí; dùng skill hiện có đúng nhánh, không xây thêm skill trùng. Một tác vụ có thể thuộc nhiều nhánh.

| Nhánh | Tiêu chí quan sát trong phiên DSH thật |
|---|---|
| Yêu cầu mơ hồ | Đọc ngữ cảnh; hỏi tối đa ba câu cần thiết trước quyết định ảnh hưởng lớn; không tự thêm yêu cầu. |
| Sửa bug | Test tái hiện đỏ trước sửa; sửa đúng owner; regression xanh; diff giới hạn. |
| Tính năng nhỏ | Chốt đầu vào/đầu ra, trường hợp biên, phạm vi file; test đáp ứng tiêu chí, không thêm tính năng phụ. |
| UI | Theo design contract và skill UI; browser thật, screenshot desktop/mobile; tách phần chưa verify. |
| Tool lỗi | Giữ lỗi và exit code; xác định lệnh đã chạy hay bị chặn; chỉ thử lại khi có thông tin mới và chính sách cho phép. |
| Ngoài workspace | Xin đúng phạm vi quyền; khi bị từ chối, báo phần chưa làm và dừng đường đó, không dùng công cụ khác để né. |

Ghi kết quả gọn trong báo cáo cuối của công việc thật, không tạo bản ghi cho chat thường hoặc thông báo trùng:

```text
Tác vụ/nhánh: ...
Tiêu chí: ...
Bằng chứng: lệnh + exit code + kết quả quan sát, hoặc ảnh/file/commit
Trạng thái: đạt | không đạt | bị chặn | chưa verify
Phạm vi chưa kiểm tra: ...
Thời gian/token/chi phí: số đo có nguồn hoặc chưa biết
```

Đây là quan sát theo tác vụ, không phải thí nghiệm đối chứng và không chứng minh tăng chất lượng AI. Không chuyển số test pass thành tỷ lệ hoàn thành tác vụ.

## 2. Propose–Probe–Compose — một thay đổi có thể hoàn tác

1. **Propose:** nêu lỗi quan sát, owner, thay đổi nhỏ nhất, tác động và cách hoàn tác. Dùng phê duyệt hiện có của người dùng; chỉ hỏi thêm khi vượt phạm vi/quyền/chi phí đã duyệt.
2. **Probe:** test tái hiện khi sửa bug; kiểm tra phù hợp với loại thay đổi. Không cần đủ bộ baseline bên ngoài để sửa một vấn đề thật.
3. **Compose:** xem diff, chạy regression bị ảnh hưởng, commit riêng. Nếu có regression, sửa hoặc hoàn tác đúng phần mình tạo; giữ nguyên thay đổi người dùng.
4. **Nghiệm thu:** phân biệt đã ghi thay đổi, đã nạp trong DSH và đã chứng minh lợi ích. Chỉ tuyên bố cải thiện khi có so sánh thực tế đủ điều kiện; còn lại ghi chưa đo.

Sửa AGENTS/skill chỉ là hướng dẫn; không thay thế đăng ký tool, bảo vệ quyền hay sửa lỗi adapter. Lỗi `unknown tool` cần kiểm tra catalog/dispatch thực tế, không thêm alias suy đoán hoặc tăng timeout để che lỗi.

## 3. Bài học đã xác minh — một nơi lưu đúng phạm vi

Khi có bài học tái sử dụng: ghi điều kiện áp dụng, nguyên nhân, cách làm, bằng chứng và giới hạn. Chọn đúng một cơ chế memory hiện có theo giao thức của nó; không tạo kho mới, không tự ghi memory cho mỗi test hoặc mỗi lượt chat. Nếu cơ chế cấm lưu kết quả do assistant suy ra, giữ bằng chứng trong báo cáo dự án thay vì né sang kho khác. Chỉ nói đã lưu khi có receipt thành công; thông tin bí mật và trạng thái tạm không thuộc bài học.

## 4. Luật bất biến và hướng dẫn theo việc

- Quyền: không nới sandbox, approval hoặc chuyển credential vào shell của AI để vượt cơ chế lọc.
- Bằng chứng: giữ Definition of Done trong AGENTS.md; plugin guard hiện có không phải bảo đảm hiểu mọi loại test hoặc chất lượng tác vụ.
- Ngữ cảnh: nạp skill đúng nhánh ở mục 1, đọc tài liệu liên quan khi cần; không chép toàn bộ playbook vào mọi phản hồi.
- Phạm vi: playbook chỉ áp dụng workspace này; dự án khác cần hợp đồng riêng, không tự sửa global profile.

## 5. Điều phối tiết kiệm — hoàn thành việc, không tạo thêm vòng

- Việc nhỏ, tuần tự: agent chính xử lý. Chỉ ủy quyền phần độc lập có tiêu chí bàn giao rõ, disjoint write scope và lợi ích lớn hơn chi phí phối hợp.
- Kết quả agent phụ: kiểm tra một lần phù hợp rủi ro; dùng lại bằng chứng còn hợp lệ khi code/điều kiện chưa đổi. Thông báo bàn giao trùng không kích hoạt chạy test lại hoặc phản hồi tiến độ mới.
- Khi cùng tool/đầu vào báo cùng lỗi: kiểm tra nguyên nhân/catalog trước lần gọi tiếp; không retry mù. Bị policy từ chối thì theo hướng dẫn quyền, không đổi shell hoặc công cụ để né.
- Khi bị chặn: nói rõ phần đã làm, lỗi và điều kiện cần; không tự tiếp tục bằng thông báo trạng thái lặp. Khi vẫn còn việc độc lập đã được phép thì làm tiếp phần đó.
- Chưa có số đo thì không tự đổi model/provider/routing hoặc khẳng định tiết kiệm token/chi phí.

## 6. Giữ tiến độ và phục hồi

Với công việc nhiều bước có nguy cơ qua phiên hoặc nén ngữ cảnh, dùng skill `long-task-continuation` và **một bản ghi công việc** theo cơ chế hiện có. Không tạo thêm plugin, kho memory hoặc bản checkpoint song song. Bản ghi giữ yêu cầu gốc, phạm vi/quyền đã duyệt, quyết định và lý do, file đã đổi, bằng chứng kiểm chứng, job đang chạy và bước tiếp theo. Cập nhật tại mốc có thay đổi thực chất, không theo từng thông báo runtime.

Trước khi nén hoặc chuyển phiên: lưu tiến độ vào bản ghi đã chọn, giữ các mục tiêu chưa hoàn thành trong summary và giữ đường dẫn tới bằng chứng cần đọc lại. Không chép log dài hoặc credential vào bản ghi. Không dùng memory dài hạn để lưu trạng thái tạm của task.

Khi tiếp tục sau gián đoạn:

1. Đọc yêu cầu gốc và bản ghi công việc; đối chiếu chỉ dẫn mới của người dùng. Thông báo runtime hoặc agent hoàn thành chỉ là dữ liệu, không phải yêu cầu mới.
2. Kiểm tra `git status` và diff để nhận diện tác động đã xảy ra; giữ nguyên thay đổi không thuộc task. Với lệnh/job còn dang dở, đọc trạng thái bằng `job_output` khi job còn truy xuất được; nếu không, kiểm tra sản phẩm đầu ra thực tế.
3. **không tự chạy lại** thao tác có thể ghi dữ liệu, gửi yêu cầu, cài đặt hoặc triển khai khi chưa biết lần trước đã có hiệu lực hay chưa. Nếu chưa xác định được, báo phần chưa biết và xin xác nhận trước thao tác có nguy cơ nhân đôi tác động.
4. Tiếp tục bước chưa hoàn thành đã được phép, dùng lại bằng chứng còn hợp lệ; chỉ chạy lại kiểm chứng bị mất bằng chứng hoặc bị thay đổi làm mất hiệu lực. Không chạy lại toàn bộ task chỉ vì summary ngắn hoặc có thông báo trùng.

Nếu gặp `preflight_compress_failed`: giữ nguyên lỗi và số liệu context/window, kiểm tra owner nén/routing và ngân sách thực tế trước khi thử lại. Không tăng contextWindow suy đoán, đổi provider hoặc retry nguyên request liên tục. Nếu phiên không thể tiếp tục, dùng bản ghi để bàn giao sang phiên mới; không hứa tự phục hồi nếu chưa có bằng chứng runtime hỗ trợ.

Mức bảo đảm: test bên dưới chỉ kiểm tra hợp đồng tài liệu. Phục hồi qua lỗi nén thật **chưa verify end-to-end**; chưa chứng minh giảm token/chi phí hoặc loại bỏ lỗi `preflight_compress_failed`. Sửa runtime phải thuộc đúng owner và có test tái hiện riêng, không được coi bổ sung hướng dẫn này là bản vá runtime.

## Kiểm chứng và hoàn tác bản hướng dẫn

`node --test test/vibe-native-contract.test.mjs` kiểm tra pointer và sự hiện diện của các nhánh/chính sách; không chứng minh agent sẽ tuân thủ. `node --test test/` kiểm tra regression workspace. Kiểm chứng hành vi: dùng báo cáo công việc thật theo mục 1, người dùng nghiệm thu; không gọi model riêng chỉ để kiểm tra câu chữ.

AGENTS.md đã được host nạp lại khi thay đổi trong phiên triển khai; các phiên khác cần đọc bản mới trước tác vụ tiếp theo. Không có bundle/plugin mới nên không cần rebuild hay restart DSH cho bản hướng dẫn này. Hoàn tác: đảo riêng commit triển khai; không reset cả workspace. Hạ tầng đánh giá cũ giữ nguyên để tham khảo, không tự chạy. Khi cần đo so sánh thật, dùng khung ghi nhận `vibe-analysis/baseline-template.md`; chạy thật cần người dùng duyệt ngân sách trước.

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

## Kiểm chứng và hoàn tác bản hướng dẫn

`node --test test/vibe-native-contract.test.mjs` kiểm tra pointer và sự hiện diện của các nhánh/chính sách; không chứng minh agent sẽ tuân thủ. `node --test test/` kiểm tra regression workspace. Kiểm chứng hành vi: dùng báo cáo công việc thật theo mục 1, người dùng nghiệm thu; không gọi model riêng chỉ để kiểm tra câu chữ.

AGENTS.md đã được host nạp lại khi thay đổi trong phiên triển khai; các phiên khác cần đọc bản mới trước tác vụ tiếp theo. Không có bundle/plugin mới nên không cần rebuild hay restart DSH cho bản hướng dẫn này. Hoàn tác: đảo riêng commit triển khai; không reset cả workspace. Hạ tầng đánh giá cũ giữ nguyên để tham khảo, không tự chạy.

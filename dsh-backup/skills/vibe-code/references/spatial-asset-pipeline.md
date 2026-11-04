# Spatial asset pipeline — concept riêng, dựng theo cổng chất lượng

Đọc khi task cần sinh ảnh, animate logo hoặc dựng vật thể 3D riêng cho web. Đây là nhánh asset của `vibe-code`, không thay design lead, design contract hoặc quyền native DSH. Không áp vào bug backend thuần; không ép AI/WebGL vào dashboard hay dự án CSS-only. Ghi quyết định trong brief/design contract và bản ghi công việc đang có, không tạo kho memory/quy chuẩn thứ hai.

## 1. Phân vai theo nhu cầu, không phải chuỗi bắt buộc

| Nhu cầu | Owner | Điểm dừng/phần bàn giao |
| --- | --- | --- |
| Concept, key visual, poster hoặc texture riêng | `design` và route sinh ảnh đã được phép | Chọn một concept phù hợp DNA; ảnh không tự chứng minh hình học. |
| Logo raster → SVG → chuyển động thương hiệu | `pixel2motion` | SVG gọn, phân phần rõ; port SVG + timeline hoặc iframe có kiểm soát, không inline toàn bộ demo/script. |
| Ảnh vật thể → mô hình procedural riêng | `img2threejs` | Factory Three.js, spec, node/pivot và bằng chứng đối chiếu; không hứa suy ra chính xác mặt khuất. |
| Cảnh/không gian | Three.js/R3F cho vật thể/camera tùy biến; `threeui` cho component/cảnh sẵn | Không giả định ThreeUI iframe cho chèn model hay điều khiển camera tùy ý. R3F chỉ khi stack React phù hợp. |
| Choreography trang | `gsap-*` | Một owner cho mỗi thuộc tính/node; không scrub animation nội bộ không có API. |

Logo và vật thể là hai nhánh độc lập; có thể chỉ cần một nhánh hoặc không cần nhánh nào. Giữ DOM cho nội dung/CTA. Sinh asset trước khi phát hành, không gọi AI cho mỗi lượt khách mở web.

## 2. G1 — concept và tham chiếu nhất quán

- Với sản phẩm thật, ưu tiên ảnh front/side/back/3-4 và tỷ lệ/kích thước quan trọng. Nếu chỉ một ảnh, nêu vùng suy luận và giới hạn độ chính xác; yêu cầu bổ sung khi nhiệm vụ đòi mặt sau chính xác hoặc 360 đáng tin cậy.
- Với vật thể sáng tạo, chọn concept gốc rồi kiểm tra các ảnh nhiều góc có cùng tỷ lệ, cấu trúc và chi tiết. Ảnh AI nhiều góc không phải bằng chứng hình học độc lập.
- Ảnh dựng mô hình: một chủ thể rõ, nền đơn giản, ít che khuất, ánh sáng dễ đọc khối; tách ảnh này khỏi poster blur/reflection/hiệu ứng quảng cáo. Logo ưu tiên contour rõ, không vector hóa ảnh nhiều texture thành hàng nghìn path.
- **Qua cổng:** mục đích, vùng đã biết/suy luận, concept được chọn và mức độ chính xác có trong brief/spec; có đủ đầu vào cho cam kết hiện tại. Thiếu dữ liệu quan trọng thì dừng phần cam kết đó, không bịa để qua cổng.

## 3. G2 — graybox đạt hình dáng và tỷ lệ

- Dựng khối thô trước vật liệu đắt: silhouette → tỷ lệ → cấu trúc/bộ phận. Xem front, side, back và góc 3-4/turntable; chỉ so độ giống ở góc có tham chiếu, góc khác kiểm tra tính nhất quán.
- Sửa hình khối trước; ánh sáng, texture hay camera không được dùng để che sai cấu trúc. Nêu rõ approximate/stylized khi phù hợp.
- **Qua cổng:** ảnh đối chiếu chứng minh các đặc điểm nhận dạng chính và tỷ lệ đạt brief; góc khuất còn suy luận được ghi rõ. Chưa đạt thì chưa đổ chi phí vào polish.

## 4. G3 — cấu trúc và chuyển động mẫu

- Tách node/pivot theo bộ phận; thử một chuyển động đơn giản bằng vật liệu rẻ trước polish: xoay object, mở nắp hoặc state change của logo. Kiểm tra trục, parenting, điểm gắn và góc camera dự định.
- Sau proof nhỏ, hoàn thiện vật liệu/ánh sáng rồi tích hợp. Giữ thứ tự pass/gate kỹ thuật của tool; G1–G4 là cổng nghiệm thu sản phẩm, không thay state/checklist Forge hoặc cho phép bỏ gate bắt buộc.
- **Qua cổng:** có preview hoặc các frame chứng minh chuyển động, node/pivot và animation owner rõ; không gọi ảnh tĩnh là bằng chứng animation. Chỉ skip nhánh motion khi contract không cần và đã ghi lý do.

## 5. G4 — tích hợp, hiệu năng và khả năng dùng

- Một canvas mỗi view, một ambient layer mỗi trang; ưu tiên gộp object/background trong scene tùy biến khi cần thay vì chồng nhiều renderer. Content/CTA và poster hiển thị trước, 3D tải riêng; lazy import không tự dừng render.
- Khi ngoài viewport hoặc tab ẩn, pause/unmount theo API thật và kiểm tra resume. Dọn RAF/timeline/listener, dispose geometry/material/texture khi bỏ scene; hỗ trợ context-loss/static/no-WebGL và reduced motion cả trong iframe nếu có.
- Tái sử dụng geometry/material, instancing cho vật thể lặp, giảm chi tiết không thấy ở camera sử dụng, shadow động/transparency/post-processing. Không mặc định code-only là nhẹ. Draco/Meshopt chỉ liên quan nếu có nhánh mesh/export phù hợp, không tự thêm cho factory procedural.
- Có thể bắt đầu thử DPR 1–1.5 mobile và tối đa 2 desktop; đây là mức thử, không bảo đảm FPS và không thay số đo trên thiết bị mục tiêu. Chốt ngưỡng tải, độ mượt và phản hồi theo brief; chưa có thiết bị/số đo thì ghi chưa verify.
- Giữ bản mobile có chủ đích: cùng DNA/focal object, giảm hiệu ứng phụ trước. Không tự thay yêu cầu 3D chính bằng 2.5D; nếu cần đổi phương án thì nêu tradeoff và xác nhận.
- **Qua cổng:** screenshot desktop/mobile + bằng chứng motion, keyboard/touch, reduced-motion/no-WebGL và số đo thực tế trên target được báo riêng. Screenshot không chứng minh FPS; giả lập viewport không phải benchmark GPU điện thoại thật.

## 6. Ngân sách và tái sử dụng

- Mặc định khởi đầu tối đa 2 concept nháp, chỉ dựng 3D 1 concept đã chọn; dùng bản rẻ/độ phân giải vừa đủ trước khi tăng chất lượng. Scope hoặc ngân sách người dùng chặt hơn thắng mặc định.
- Mỗi vòng sửa một nguyên nhân, giữ bản đã đạt; tái dùng asset/spec, nguồn tham chiếu, phiên bản tool và thông số trong dự án khi đầu vào không đổi. Không sinh lại toàn bộ chỉ vì sửa một chi tiết.
- Chốt trần thời gian/token/chi phí trong brief trước tác vụ nặng. Với Forge mới, mặc định tối đa 2 correction/pass, 3 correction tổng; giữ giới hạn nhỏ hơn nếu đã có. Có state cũ thì đọc lại và tiếp tục, không init lại hoặc tăng trần để né stop.
- Hết trần hoặc gate vẫn không đạt: báo phần thiếu và lựa chọn sửa đầu vào/giảm scope/đổi ngân sách; chờ quyết định khi ảnh hưởng lớn. Không tự đổi model/provider/routing, cài dependency/plugin/harness, gọi dịch vụ trả phí hoặc tải dữ liệu riêng ra ngoài. Gateway local không đồng nghĩa inference offline/miễn phí.
- Quyền tạo asset trong dự án không mặc nhiên cho phép gửi CAD/ảnh riêng/credential ra provider; xác định route, dữ liệu và chi phí trong phạm vi đã duyệt. Không có quyền thì làm brief/graybox độc lập dễ hoàn tác, ghi phần bị chặn.

## Nguồn tham khảo

- [img2threejs tại commit ghim](https://github.com/img2threejs/img2threejs/tree/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28): base skill và Forge generic; không tự cài các domain plugin.
- [Three.js responsive rendering](https://threejs.org/manual/en/responsive.html): phân biệt CSS size và drawing buffer, kiểm soát chi phí high-DPI.
- Các ngưỡng concept/correction/DPR ở trên là mặc định làm việc đã chốt cho DSH, không phải benchmark của upstream hay bảo đảm chất lượng.

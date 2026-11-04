# Cổng đối chiếu ý định thiết kế

Áp dụng khi tạo hoặc thay đổi UI có ý nghĩa; backend thuần không đi qua cổng này. Đây là quy trình trong `vibe-code`, không phải lead, plugin, hệ chấm điểm hay kho quy chuẩn mới.

## 1. Trước triển khai: biến mong muốn thành điều có thể quan sát

Ghi gọn trong brief/product plan/design contract hiện có, không mở thêm bộ tài liệu song song:

- **Ý định:** người dùng muốn cảm giác, mức biểu đạt và tác vụ gì; phân biệt khu vực Experience/Persuade với Read/Operate. Giữ yêu cầu cụ thể của người dùng, không chỉ tên style.
- **Dấu hiệu phải thấy:** 2–4 tiêu chí gắn với sản phẩm, gồm bố cục/hierarchy và hành vi chủ đạo. Khi yêu cầu rõ cinematic/immersive/3D nổi bật, mô tả một khoảnh khắc đặc trưng có diễn biến, chiều sâu và phản hồi tương tác; không coi một object nổi, fade/stagger/hover hoặc tên thư viện là đủ. Không biến ví dụ đó thành template cho mọi website.
- **Trạng thái và thiết bị:** trải nghiệm thường, keyboard/touch, mobile, reduced-motion và no-WebGL; phần nào giữ, giản lược hay thay bằng bố cục tĩnh. Nội dung/CTA vẫn dùng được ngay. Với dashboard CSS-only có chủ đích, tiêu chí có thể là trạng thái rõ hơn và tác vụ nhanh hơn, không cần scene hay signature spectacle.
- **Bằng chứng và giới hạn:** ảnh desktop/mobile cho bố cục; kiểm tra trình duyệt theo từng trạng thái và tương tác cho motion/3D; chỉ số hiệu năng chỉ khi có đo. Chốt ngân sách/điểm dừng phù hợp, tái sử dụng bằng chứng còn đúng scope/version.

Contract tối giản hiện hữu có chủ đích vẫn được tôn trọng, trừ khi yêu cầu mới đã thay đổi nó. **Tài liệu do AI vừa viết không được dùng để tự hạ yêu cầu gốc** hoặc biến nguyên mẫu ít tham vọng thành ý muốn của người dùng. Nếu có xung đột chưa giải quyết được, nêu rõ và hỏi lựa chọn; không âm thầm đổi scope.

## 2. Khi làm: kiểm khoảng cách trước khi polish lan rộng

Làm và nhìn thử hành vi chủ đạo trong bố cục thật đủ sớm. Kiểm theo mục tiêu: silhouette/phân lớp/camera/ánh sáng và phản hồi có truyền đạt đúng ý không, không chỉ kiểm canvas có tồn tại hay timeline đang chạy.

Không thêm hiệu ứng không liên quan để bù cho thiếu điểm nhấn. Không giấu artwork mobile hoặc tắt chuyển động toàn trang chỉ để làm test xanh; thích nghi thiết bị nhưng giữ bản sắc ở chế độ thường. Accessibility/fallback không phải lý do hạ mọi chế độ xuống bản tĩnh. Giữ một canvas/animation owner và các giới hạn của router.

## 3. Trước bàn giao: hai cổng độc lập

1. **Đúng kỹ thuật:** chức năng, lỗi, lifecycle, keyboard/touch, responsive và fallback được kiểm tra trong phạm vi đã khai báo.
2. **Đúng ý định:** đối chiếu từng dấu hiệu đã chốt với đầu ra thực tế, gồm khoảnh khắc chủ đạo trước/trong/sau tương tác. Nhìn ảnh desktop/mobile và chạy hành vi thật; ảnh tĩnh hay điểm thẩm mỹ tự chấm không chứng minh motion hoặc ý định đã đạt.

Test xanh không thay cho cổng 2; có Three.js/ThreeUI/GSAP cũng không phải bằng chứng. Nếu đã có review độc lập thì dùng nó để tìm sai lệch, nhưng review/test không thay cổng chấp nhận cuối của người dùng. Thiếu công cụ/reviewer phải nói rõ, không dựng bằng chứng.

Nếu còn lệch tiêu chí đã chốt: sửa tập trung nguyên nhân trong ngân sách còn lại và kiểm lại phần bị ảnh hưởng; không tự đổi tiêu chí cho khớp bản làm. Hết ngân sách hoặc xung đột lớn thì báo phần đạt/chưa đạt cùng lựa chọn tiếp theo, không lặp vô hạn hoặc khẳng định đã đáp ứng hoàn toàn.

Bàn giao ngắn: **yêu cầu → biểu hiện thực tế → bằng chứng → phần còn thiếu**. Tách “chạy đúng” khỏi “đúng tham vọng thiết kế”; không suy từ một demo/probe thành bảo đảm cho mọi phiên hoặc mọi thiết bị.

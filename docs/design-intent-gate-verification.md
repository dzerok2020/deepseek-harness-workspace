# Kiểm chứng cổng đúng ý định thiết kế

Ngày 2026-10-30. Theo yêu cầu người dùng: sửa cách DSH giữ ý định 3D/motion rồi áp dụng trên demo Miền Truyện. Đây là biên bản bằng chứng, không phải owner quy tắc mới.

## Nguyên nhân và phạm vi thay đổi

- Hướng dẫn cũ đã yêu cầu premium/DNA/motion nhưng thiếu đối chiếu tường minh giữa tham vọng người dùng và hành vi chủ đạo. Một object nổi với fade cùng test xanh đã bị coi là đủ cho yêu cầu cinematic; đó là khoảng trống quy trình, không chứng minh lỗi renderer hay model.
- Giữ owner global → vibe-code, bổ sung một reference design-intent-gate: 2–4 dấu hiệu quan sát trong brief hiện có; thử hành vi chủ đạo sớm; hai cổng độc lập đúng kỹ thuật và đúng ý định. Không thêm template sách cho mọi dự án, plugin, scoring, store hoặc reviewer bắt buộc.
- Contract AI vừa viết không được tự hạ yêu cầu gốc; contract tối giản hiện hữu thắng default nhưng không thắng yêu cầu mới rõ ràng. CSS-only hợp lệ không phải cài GSAP; GSAP giữ ownership khi đã chọn JavaScript cho page motion.
- Không đổi DSH core/GUI, model/provider routing, native permissions, memory, dependencies, các skill GSAP/ThreeUI/Pixel2Motion/img2threejs hay lịch kiểm tra tuần.

## Canonical paths và SHA-256

| Tệp canonical | Trước | Sau |
|---|---|---|
| [Global instructions](</home/dzerok/.dsh/AGENTS.md>) | 5336b3e5fe7a62cd318b14e4c562d9ddcf7a19ab25b1cc5380a7ca417dd8170b | 2322460c4137ca63980220cafe6db7ae4728a5370dc3b41e75a57c0ca496ce68 |
| [Vibe-code router](</home/dzerok/.dsh/skills/vibe-code/SKILL.md>) | 369b9f1570c4bdc49e36998accfe2d9153b74e9eef3d786bd1207e150be647dc | 70c6c778d01b2df0923681ca5e1e9e53732f689d0bd86268d53a577a927df7dc |
| [Design intent gate](</home/dzerok/.dsh/skills/vibe-code/references/design-intent-gate.md>) | Chưa có | 858ee6614ad168927beec84756268d631368fed03f54c847be27f4568f39f4a5 |

Các tệp canonical nằm ngoài repository này. Commit biên bản KHÔNG version hoặc rollback được chúng. Host đã thông báo nạp global mới trong phiên này; chưa kiểm chứng mọi phiên tương lai.

## Review và kiểm tra

- Planner cho scope mới timeout sau 120000ms; dùng kế hoạch inline theo luật hiện hành, không retry hoặc đổi CLI/model.
- Baseline subagent thất bại không có báo cáo: KHÔNG có phép so sánh hành vi baseline/candidate độc lập. Root-gap dựa vào quy tắc trước và đầu ra demo đã quan sát, không dựng kết quả control.
- Candidate reviewer độc lập chỉ đọc xác nhận: A strong-3D landing không được nghiệm thu bằng floating+fade/test xanh; B dashboard CSS-only giữ tiết chế, backend-only không vào cổng UI; C không viết contract hạ yêu cầu, giấu artwork mobile hoặc lấy ảnh tĩnh làm bằng chứng motion.
- Reviewer nêu diễn đạt GSAP quá rộng và contract tóm tắt thiếu ngoại lệ yêu cầu mới. Parent đối chiếu source, sửa đúng hai điểm tại owner hiện có. Đây là review văn bản, không chứng minh mọi agent sẽ làm đúng.
- Markdown, canonical SHA-256 và assertions cho pointer/contract/CSS-only: PASS. Workspace regression trước thêm biên bản: 239 tests, 239 pass, 0 fail, exit 0. Sau thêm biên bản: 242 tests, 242 pass, 0 fail, 0 skipped, exit 0; ba test tăng thêm kiểm tra tài liệu, không phải ba bài đo hành vi agent.
- Ứng dụng đối chứng thực hành: [Miền Truyện — kiểm chứng](</home/dzerok/Documents/mien-truyen-demo/docs/verification.md>), có scene mở sách, thế giới dựng theo pha và test tương tác riêng; không dùng một demo để suy ra độ tin cậy trên mọi dự án.

## Giới hạn, rollback và nghiệm thu

Confidence B cho cấu hình đã nạp và kiểm tra hẹp; không có benchmark chất lượng agent, FPS/CWV hay bảo đảm không bao giờ lệch ý định. Người dùng vẫn nghiệm thu cảm giác và mức biểu đạt cuối.

Nếu cần rollback: kiểm tra nội dung/hash hiện tại trước; đảo đúng pointer mới, phần làm rõ JS/contract và reference này ở canonical owner, bảo toàn các sửa đồng thời. Không ghi đè toàn bộ global/router từ bản cũ. Git revert biên bản không thực hiện rollback đó; hashes không phải bản sao phục hồi. Không thay đổi native permissions hoặc owner memory để khắc phục.

# Kiểm chứng cấu hình Cinematic Spatial UI — 2026-10-30

Đây là biên bản triển khai, không phải một design contract hoặc bộ nhớ thứ hai. Nguồn quy tắc đang có thẩm quyền là [hướng dẫn global](</home/dzerok/.dsh/AGENTS.md#L125>) và [router vibe-code](</home/dzerok/.dsh/skills/vibe-code/SKILL.md#L74>); không chép quy tắc ở đây để agent thực thi thay chúng.

## Phạm vi đã duyệt và hiệu lực

- Người dùng duyệt mặc định Cinematic Spatial UI cho web UI, DNA riêng từng dự án, landing/portfolio biểu cảm hơn app/dashboard, kiểm tra nguồn chính thức theo task và kiểm tra chỉ đọc hằng tuần.
- Đã thay đúng phần thiết kế web trong [hướng dẫn global](</home/dzerok/.dsh/AGENTS.md#L125>); giữ các phần khác, gồm quy tắc ECC planner. Host đã gửi thông báo nạp lại nội dung global trong phiên này; không suy ra mọi phiên khác đã nạp.
- Đã làm rõ asset không phải design lead và bổ sung DNA/kiểm tra nguồn tại [router vibe-code](</home/dzerok/.dsh/skills/vibe-code/SKILL.md#L13>). Không đổi description/frontmatter, tool registration, model/routing, package runtime hay tám skill GSAP upstream.
- Đây là thay đổi hướng dẫn, không phải bộ thực thi tự động. Chưa có website mới được triển khai; không có screenshot, số đo FPS hoặc nghiệm thu UI để báo.

## Dấu vân tay tệp ngoài Git workspace

Các revision dưới đây là SHA-256 tại thời điểm kiểm tra, không phải bản sao phục hồi nội dung.

| Nguồn cấu hình | Trước thay đổi | Sau thay đổi |
| --- | --- | --- |
| [Global AGENTS.md](</home/dzerok/.dsh/AGENTS.md>) | `d4b1b08a244daa0fb98c3205e9acf7916b37ef52e35bae213d8977ef0cfa3e1a` | `12319c72e5d4f1b2894f41d6670ab90dd470eb52b464f3fc8d56091dec6118cc` |
| [Router SKILL.md](</home/dzerok/.dsh/skills/vibe-code/SKILL.md>) | `d28bd3db7c9aff3b32a8486953fed5f8decc827bafd945b12e90965647197175` | `ac49661a1d94c648661ae6451c5d04f53d221bfe40ee27dab0ff29d03602136d` |

## GSAP và lịch chỉ đọc

- Đã đối chiếu tám skill local với tám blob tại [commit GSAP skills cố định](https://github.com/greensock/gsap-skills/tree/aed9cfd3277740755f6bfc1155c7aa645403b760): `Official skill files: 8`, `Exact content matches: 8/8`, `[exit code: 0]`.
- Sau sửa router, kiểm lại blob hash local: `Official GSAP skills unchanged: 8/8 (compared to verified commit aed9cfd3277740755f6bfc1155c7aa645403b760)`, `[exit code: 0]`. Đây không phải kiểm thử GSAP npm runtime hoặc tuyên bố ThreeUI/Three.js đã được nâng bản mới nhất.
- Lịch native đã tạo và đọc lại: `schedule-287471c4-f6ec-42d2-9631-43699125c4cb`; thứ Hai 09:00, `Asia/Saigon` (UTC+7), lần đầu 2026-11-02 09:00. Đây là giờ mặc định được chọn khi thiết lập, có thể đổi theo người dùng.
- Nội dung lịch chỉ cho phép tra nguồn, so sánh, báo thay đổi/khuyến nghị và ghi rõ phần chưa verify; không tự sửa/cài/nâng dependency, chạy mã nguồn ngoài, deploy/push, ghi memory hoặc quét dự án riêng khác. Không tạo cron/service cập nhật nền. Chưa kiểm chứng lần lịch thực sự đến hạn hoặc chạy khi DSH tắt.

## Bằng chứng và giới hạn

- Baseline chỉ đọc đã áp dụng hướng dẫn cũ vào bốn tình huống: landing camera, dashboard logistics trên máy yếu, bug backend không đổi UI, và yêu cầu hero 3D kèm bỏ safeguards. Thiếu quy định explicit về DNA, cường độ 3D và exact-version/official-source/update protocol; một số quyết định đúng chỉ là judgment của agent.
- Kiểm tra Markdown riêng trên hai tệp ngoài workspace và biên bản: `Markdown checks: PASS` cho code fence, cấu trúc bảng và newline. Đã đọc lại nội dung mục tiêu sau sửa. Không dùng số dòng hoặc chuỗi xuất hiện làm bằng chứng agent sẽ tuân thủ.
- Regression workspace trước thêm biên bản: `node --test test/` → `tests 233`, `pass 233`, `fail 0`, `skipped 0`, `[exit code: 0]`. Sau thêm biên bản: `tests 236`, `pass 236`, `fail 0`, `skipped 0`, `[exit code: 0]`; đây là test contract/tài liệu của workspace, không phải test hành vi agent hay animation runtime.
- Review độc lập đã đối chiếu bốn tình huống sau thay đổi, không thấy quyền blind update/authority escalation trong phần đọc. Có một điểm mơ hồ severity thấp ở [reduced motion](</home/dzerok/.dsh/AGENTS.md#L151>): câu bắt API GSAP có thể ép thư viện vào CSS-only. Đã sửa outcome bắt buộc nhưng API chỉ khi dùng GSAP; CSS-only dùng media query, không thêm dependency. Người điều phối đọc lại và kiểm tra định dạng sau sửa: `Reduced-motion clarification: PASS (GSAP conditional; CSS-only requires no extra library)`, `[exit code: 0]`.
- Reviewer không kiểm độc lập diff hoặc tám skill upstream; phần xác minh blob do người điều phối chạy thật. Review/scenario chỉ là bằng chứng mức lập phương án, không chứng minh chất lượng UI hay hành vi runtime. Mức tin cậy cho thay đổi hướng dẫn: B, với rủi ro còn lại là mức tuân thủ thực tế ở task sau và lần lịch đầu tiên chưa đến hạn.
- Không triển khai app, không thay code runtime nên coverage UI/runtime và screenshot không áp dụng cho thay đổi này. Chất lượng thiết kế, FPS, tính tương thích thực tế và hiệu quả hành vi của hướng dẫn vẫn cần task UI thật để nghiệm thu; scenario planning không thay thế việc đó.

## Hoàn tác đúng phạm vi

Commit trong workspace chỉ lưu biên bản này, không chứa hai tệp global nằm ngoài repository hay trạng thái scheduler. Không dùng revert commit biên bản để tuyên bố đã phục hồi cấu hình. Muốn hoàn tác phải đọc bản hiện tại, đối chiếu các revision/diff của phiên triển khai, đảo đúng phần hướng dẫn đã thay (giữ thay đổi khác), và xóa lịch bằng `schedule_delete` với đúng ID ở trên nếu người dùng yêu cầu. Không reset workspace hoặc cài lại upstream để xóa customization.

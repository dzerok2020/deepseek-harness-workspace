# Xác minh tích hợp spatial asset pipeline vào DSH

Ngày: 2026-10-30, Asia/Saigon. Đây là biên bản triển khai/kiểm chứng, không phải owner quy tắc mới hay bộ nhớ thứ hai.

## Phạm vi và thay đổi đã áp dụng

- Theo phương án người dùng duyệt: phân nhánh concept → logo hoặc vật thể riêng → scene phù hợp → choreography trang; không bắt mọi dự án chạy mọi tool và không tạo một website mới trong tác vụ này.
- Giữ owner cũ: global instructions chỉ thêm một con trỏ; `vibe-code` giữ routing; một reference giữ bốn cổng G1 tham chiếu, G2 graybox, G3 node/pivot + proof motion, G4 tích hợp/performance. Contract tối giản/CSS-only, quyền native, model/routing và Hindsight không đổi.
- Đăng ký adapter DSH `img2threejs`; source upstream giữ riêng, ghim commit [3e7099e1b7fe93e187e06db4bdbe1e1906c21a28](https://github.com/img2threejs/img2threejs/tree/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28), license Apache-2.0. Skill upstream tự ghi version 2.0.0; CLI package là 0.1.1, không phải hai bản skill khác nhau.
- Không dùng installer auto-detect đa host, không cài `img2` harness/domain plugin, npm/pip hay runtime Three.js vào dự án khác. Không đổi các skill GSAP, ThreeUI, Pixel2Motion hoặc provider sinh ảnh đang có.
- Giới hạn làm việc được ghi rõ: tối đa hai concept nháp, một concept được chọn để dựng; Forge mới dùng hai correction/pass và ba correction tổng, không tăng trần/tạo state lại để né stop. Các mức DPR chỉ là điểm thử, không phải cam kết FPS.

## Tệp canonical và dấu vết

| Tệp canonical | SHA-256 sau thay đổi |
| --- | --- |
| [Global AGENTS.md](</home/dzerok/.dsh/AGENTS.md>) | `5336b3e5fe7a62cd318b14e4c562d9ddcf7a19ab25b1cc5380a7ca417dd8170b` |
| [Router vibe-code](</home/dzerok/.dsh/skills/vibe-code/SKILL.md>) | `369b9f1570c4bdc49e36998accfe2d9153b74e9eef3d786bd1207e150be647dc` |
| [Reference spatial asset pipeline](</home/dzerok/.dsh/skills/vibe-code/references/spatial-asset-pipeline.md>) | `4f69bb3c3d814c51d4d9244bda2612b435881eef4a54853a93ceaccd7c5fcf74` |
| [Adapter img2threejs](</home/dzerok/.dsh/skills/img2threejs/SKILL.md>) | `a561ae605ec48cc75b5e83f46e700d45ee5bb7d841cd13c31f74cafe1003b74e` |

Source được giữ tại [checkout ghim](</home/dzerok/.img2threejs/releases/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28/img2threejs/SKILL.md>), không sửa nội dung upstream. Đã xác minh HEAD, working tree sạch và Git blob của skill: `85eea0864953e66176dccd7ae358958f955f924e`.

## Kiểm chứng đã chạy

- DSH đã cập nhật catalog và gọi `skill` nạp được `img2threejs` cùng router mới; host cũng gửi global instructions mới trong phiên này. Không suy ra mọi phiên cũ đã nạp lại hoặc routing tự động luôn đúng.
- Kiểm Markdown bốn tệp canonical: PASS (bảng, separator/cột, fence và newline); metadata hai skill: PASS. Diff global đúng một con trỏ mới, các phần khác giữ nguyên.
- Workspace regression trước khi thêm biên bản: `node --test test/` → 236 test, 236 pass, 0 fail, exit 0. Sau khi thêm biên bản: `ℹ tests 239`, `ℹ pass 239`, `ℹ fail 0`, `ℹ skipped 0`, exit 0; `git diff --check` exit 0. Chênh lệch ba test do bộ kiểm tài liệu tự nhận thêm một tệp Markdown, không phải thêm ba behavioral test cho skill.
- Smoke generic bằng Python 3.14.8, `-B -S`, environment allowlist không kế thừa credential/provider variables; HOME/IMG2_HOME/TMPDIR/XDG riêng trong thư mục tạm. Đã chạy: hai help CLI; init generic với trần 2/3; status JSON; next pre-spec; thử init lại bị từ chối exit 2 và state không đổi. Các lệnh thành công exit 0, canonical source vẫn sạch.
- Chọn riêng ba unit test upstream về state ban đầu, skip cần lý do và done cần evidence: `Ran 3 tests in 0.001s`, `OK`, exit 0. Đây là kiểm chuỗi metadata/checklist, không chứng minh evidence có thật hoặc DSH cấp quyền.
- Log smoke: [smoke.log](</tmp/dsh-img2threejs-smoke-130ns3h_/smoke.log>); log regression: [workspace tests](</tmp/dsh-spatial-assets-workspace-tests-20261030.log>). Log trong `/tmp` có thể bị hệ điều hành dọn.

## Review, baseline và giới hạn an toàn

- Baseline ba tình huống trước thay đổi đã ghi nhận: routing/contract/reduced-motion có sẵn, nhưng fidelity mặt khuất, graybox, finite correction và CAD-provider gate còn phụ thuộc phán đoán. Đây là planning probe, không phải đo chất lượng model.
- Review upstream có phạm vi tĩnh: không thấy critical blocker cho subset generic đã chọn khi cô lập; không phải full security audit. Đã xác minh các cảnh báo và bổ sung vào adapter: help có import domain/registry; next có thể ghi state khi có spec; command text/mark không là cổng quyền; path/symlink và overwrite cần kiểm riêng; generator có thể ghi cache theo source; intake có fallback `sips` không bảo đảm trên Linux.
- Generator có cache phải chạy từ bản sao riêng theo task, không trực tiếp vào release canonical; không chỉ đổi cwd. Không tự cài converter/plugin/provider để vượt setup gap.
- Candidate review độc lập đã trả đủ probe A–C: không thấy blocker routing/gate/budget; đây là advisory trên văn bản, không chứng minh model đẹp hay nhẹ. Reviewer đọc adapter 46 dòng trước bổ sung ranh giới cache/CLI cuối; parent đã kiểm lại adapter 47 dòng cuối cùng và hash trong bảng. Một lưu ý P3 có sẵn ở [router:61](</home/dzerok/.dsh/skills/vibe-code/SKILL.md#L61>): cụm “đã verify” cho tổ hợp ThreeUI/React Bits/Morphicons thiếu artifact/phạm vi; giữ ngoài diff hẹp của task, không kế thừa làm chứng nhận runtime/mobile/performance.
- Confidence B cho tích hợp cấu hình và subset CLI đã kiểm: có discovery, smoke, regression và review; chất lượng dựng object/render và hiệu quả thời gian/token chưa có số đo, không suy ra từ planning probe.

## Lịch kiểm tra và phần chưa verify

Đã cập nhật đúng lịch native hiện có `schedule-287471c4-f6ec-42d2-9631-43699125c4cb`, không tạo lịch trùng: thứ Hai 09:00 Asia/Saigon, lần kế tiếp 2026-11-02 09:00. Thêm nguồn chính thức Pixel2Motion/img2threejs vào kiểm tra chỉ đọc, giữ nguyên lệnh cấm tự sửa/cài/nâng cấp/chạy upstream code/upload/ghi memory. `schedule_list` đọc lại trạng thái scheduled; lần giao nhắc thực tế đầu tiên vẫn chưa verify.

Chưa chạy intake/converter, generator, renderer hoặc dịch vụ sinh ảnh; chưa có object thật, screenshot web desktop/mobile, motion proof, mobile GPU/FPS, chi phí/provider hay benchmark chất lượng. Cấu hình này hướng dẫn AI làm việc; không phải runtime enforcement hoặc bảo đảm suy ra hình học chính xác từ một ảnh.

## Git và rollback

Git commit của workspace chỉ lưu biên bản này; các tệp global/skill và lịch native nằm ngoài commit. Không push. Hai bản trước thay đổi được lưu tạm: [global backup](</tmp/dsh-spatial-assets-before-agents-20261030.md>) và [router backup](</tmp/dsh-spatial-assets-before-router-20261030.md>); chúng không phải backup bền vững. Khi cần rollback, đối chiếu hiện trạng rồi đảo đúng phần task đã thêm, bỏ đăng ký adapter/reference theo quyền được duyệt và phục hồi prompt lịch cũ; không ghi đè thay đổi mới hoặc xóa source/artifact tùy tiện. Revert biên bản không tự hoàn tác cấu hình/lịch.

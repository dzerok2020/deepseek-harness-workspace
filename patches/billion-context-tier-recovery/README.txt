Billion-context 0.1.204 — hướng dẫn candidate tier-recovery
========================================================

1. Trạng thái và phạm vi

Đây là candidate (bản vá thử nghiệm) chỉ nằm trong workspace. Không có thay đổi
nào được tự động áp dụng vào runtime DSH đang cài. Commit hoặc push thư mục này
không đồng nghĩa bản vá đang chạy. Không tự áp dụng sau khi nâng phiên bản.

2. Lỗi được tái hiện và cơ chế sửa

Tái hiện offline: hai active summary cộng lại vượt giới hạn nguồn 60.000 ký tự
khiến tier recovery không gọi model lần nào, dù summary vẫn có thể nén.

Candidate giữ ưu tiên chọn span vừa ngân sách. Khi không span nào vừa, nó chia
cặp đủ điều kiện đầu tiên bằng splitter hiện có, giới hạn từng chunk theo ngân
sách ký tự/token và dành trước toàn bộ số lượt gọi cần thiết. Chỉ ghép và apply
một lần sau khi tất cả chunk thành công. Cancellation, summary thất bại, kết quả
ghép quá dài hoặc apply bị từ chối không được âm thầm cắt bỏ nội dung nguồn.

Owner và SHA256 chính xác được pin trong generate.mjs. SHA256 là dấu vân tay của
file để tránh vá nhầm bundle. Bundle khác bị từ chối; đây không phải source patch
có thể dùng tùy ý cho phiên bản upstream khác.

3. File nào là nguồn được duy trì?

- generate.mjs: kiểm tra owner/hash và sinh candidate riêng, không ghi đè runtime.
- harness.mjs: chạy phần preflight/splitter được trích xuất trong môi trường VM.
- recovery.test.mjs: các kịch bản khôi phục và lỗi gốc.
- guards.test.mjs, review.test.mjs: các ràng buộc và trường hợp hồi quy bổ sung.
- README.txt: hướng dẫn này.

Full generated bundle, candidate.patch và log red/green là scratch local (kết quả
tạm), không phải nguồn chuẩn để chỉnh sửa hoặc bằng chứng triển khai production.

4. Chạy kiểm chứng offline

Chạy từ thư mục gốc workspace, với Node.js và bundle owner đúng phiên bản mà
generate.mjs yêu cầu. Không chạy lệnh update/restart DSH để kiểm chứng candidate.

Bước A — tái hiện lỗi gốc, EXPECTED NONZERO EXIT (test đỏ có chủ đích):

  node --test --test-name-pattern='full preflight recovers' patches/billion-context-tier-recovery/recovery.test.mjs

Nếu test không đỏ, đừng kết luận bản vá đã hiệu quả: có thể owner hoặc baseline
đã đổi. Đọc assertion và kiểm tra môi trường trước khi tiếp tục.

Bước B — sinh output mới; đường dẫn output PHẢI chưa tồn tại:

  node patches/billion-context-tier-recovery/generate.mjs patches/billion-context-tier-recovery/candidate-check.js

Nếu báo sai hash/owner, dừng: không bỏ qua pin hoặc vá thẳng bundle đang cài.
Nếu output đã tồn tại, chọn tên output mới rồi dùng cùng tên ở bước C; không xóa
mù file cũ để ép generator chạy. Output mới là file tạm, không git add bundle.

Bước C — chạy cùng bộ test trên candidate vừa sinh:

  CANDIDATE=patches/billion-context-tier-recovery/candidate-check.js node --test patches/billion-context-tier-recovery/recovery.test.mjs patches/billion-context-tier-recovery/guards.test.mjs patches/billion-context-tier-recovery/review.test.mjs

Bước D — hồi quy workspace:

  node --test test/

Ghi lại lệnh, exit code, số pass/fail và owner/hash khi báo cáo. Một lần test xanh
không đủ để tuyên bố đã sửa runtime production.

5. Bằng chứng này chứng minh gì — và chưa chứng minh gì?

Fixture chạy code preflight/splitter đã trích xuất trong VM. Model calls, core
processing, token counting và applyRanges đều được mock (giả lập). Không có yêu
cầu model trả phí trong bộ kiểm chứng này.

Nó KHÔNG xác lập an toàn protected range của kernel thật, độ trung thực ngữ nghĩa
của summary, khả năng khôi phục production, hoặc tiếp tục end-to-end một tác vụ
đã gián đoạn. Đừng mô tả test này thành live recovery hay đảm bảo không mất ý.

6. Điều kiện trước khi thử live

Cần phê duyệt riêng việc sửa installed runtime; backup đúng owner; kiểm chứng
kernel/protected ranges thật bằng phiên được kiểm soát; sau đó thử restart và
resumption. Phải có kế hoạch quay về đúng bundle backup và kiểm tra lại phiên.
Tài liệu này không cấp quyền thực hiện các bước live đó.

Khi upstream có cơ chế recovery tương đương đã kiểm chứng, bỏ workaround theo
một thay đổi được review riêng. Không mang candidate 0.1.204 sang bản mới bằng
cách bỏ kiểm tra hash.

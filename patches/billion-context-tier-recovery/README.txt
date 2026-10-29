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

SHA256 gốc 104502cb11fa98e205f61ba9cc0dde8d3d03b57d8330bfcbafe84f8d130ed2d9
được pin trong original.mjs. Loader chung giải nén original-index.js.gz và kiểm
hash trước khi generator, harness hoặc guards dùng nguồn. Fixture là bundle
0.1.204 chưa sửa, không lấy bundle/package version từ installed runtime đang đổi.
OWNER chỉ còn là đường dẫn output bị cấm. Bundle khác bị từ chối; không repin để
chạy trên phiên bản upstream mới.

3. File nào là nguồn được duy trì?

- original.mjs: loader/hash chung; chỉ đọc fixture cố định cạnh module.
- original-index.js.gz: bản gốc 0.1.204, gzip deterministic level 9, mtime 0;
  1.227.183 byte, giải nén thành 5.248.857 byte. Hash/nguồn offline trong
  original.provenance.json; kiểm tra nguồn trước khi ghi fixture bằng flag wx.
- LICENSE.original.txt: TOÀN BỘ license gốc, gồm Additional Term — Attribution
  on Product Surfaces và phần tiếng Trung; không thay bằng nhãn MIT đơn thuần.
- generate.mjs: kiểm tra hash và sinh candidate riêng, không ghi đè runtime.
- harness.mjs: chạy phần preflight/splitter được trích xuất trong môi trường VM.
- recovery.test.mjs: mặc định patch(original) trong bộ nhớ; ORIGINAL=1 tái hiện gốc.
- guards.test.mjs, original.test.mjs, review.test.mjs: pin, license, CLI và hồi quy.
- README.txt: hướng dẫn này. Fixture này dùng billion-context:
  https://github.com/ranxianglei/billion-context; các nghĩa vụ attribution upstream
  đầy đủ nằm trong LICENSE.original.txt.

Full generated bundle, candidate.patch và log red/green là scratch local (kết quả
tạm), không phải nguồn chuẩn để chỉnh sửa hoặc bằng chứng triển khai production.

4. Chạy kiểm chứng offline

Chạy từ thư mục gốc workspace với Node.js; không cần installed owner đúng phiên
bản. Fixture, provenance và license được giữ trong repo; không tải mạng, không
đổi package/config, không update/restart DSH để kiểm chứng candidate.

Mặc định — toàn bộ candidate suite phải GREEN, không cần sinh file:

  node --test patches/billion-context-tier-recovery/*.test.mjs

Bước A — tái hiện lỗi gốc, EXPECTED NONZERO EXIT (test đỏ có chủ đích):

  ORIGINAL=1 node --test --test-name-pattern='full preflight recovers' patches/billion-context-tier-recovery/recovery.test.mjs

Nếu test không đỏ, đừng kết luận bản vá đã hiệu quả: kiểm tra fixture/hash và
assertion trước khi tiếp tục. ORIGINAL=1 chỉ dùng để tái hiện lỗi, không phải
chế độ chạy toàn suite mặc định.

Bước B (tùy chọn) — sinh output mới; đường dẫn output PHẢI chưa tồn tại:

  node patches/billion-context-tier-recovery/generate.mjs patches/billion-context-tier-recovery/candidate-check.js

Nếu báo sai hash, dừng: không bỏ qua pin hoặc vá thẳng bundle đang cài.
Nếu output đã tồn tại, chọn tên output mới rồi dùng cùng tên ở bước C; không xóa
mù file cũ để ép generator chạy. Output mới là file tạm, không git add bundle.

Bước C — chạy cùng bộ test trên candidate vừa sinh:

  CANDIDATE=patches/billion-context-tier-recovery/candidate-check.js node --test patches/billion-context-tier-recovery/*.test.mjs

Bước D — hồi quy workspace:

  node --test test/

Ghi lại lệnh, exit code, số pass/fail và fixture/hash khi báo cáo. Một lần test xanh
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

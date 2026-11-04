---
name: img2threejs
description: Dựng vật thể riêng từ ảnh tham chiếu thành mô hình procedural Three.js có spec, graybox, node/pivot và bằng chứng render. Dùng khi ảnh sản phẩm/concept cần chuyển thành object 3D cho web hoặc hero tùy biến; không dùng cho logo SVG, background dựng sẵn hoặc dashboard không cần 3D.
license: Apache-2.0
metadata:
  upstream: https://github.com/img2threejs/img2threejs
  upstream-commit: 3e7099e1b7fe93e187e06db4bdbe1e1906c21a28
  upstream-skill-version: 2.0.0
  dsh-adapter: 2026-10-30
---

# img2threejs — adapter DSH cho vật thể procedural

Đây là entrypoint DSH, không phải fork của engine hay dịch vụ image-to-mesh. Source upstream giữ nguyên tại `/home/dzerok/.img2threejs/releases/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28/img2threejs` (gọi là `UPSTREAM` bên dưới). [Apache-2.0 và notice](</home/dzerok/.img2threejs/releases/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28/img2threejs/LICENSE>) nằm trong checkout đó.

## Đường đi mặc định

1. **Chốt asset và đầu vào:** giữ design lead của `vibe-code`; đọc [spatial asset pipeline](</home/dzerok/.dsh/skills/vibe-code/references/spatial-asset-pipeline.md>) trước khi tạo concept hoặc dựng object. Đây là phương pháp reconstruction-by-code; ảnh đơn không xác định chính xác mặt sau hay hình học 360. Logo đi `pixel2motion`, cảnh sẵn đi `threeui`, không chạy mọi nhánh.
2. **Đọc đúng contract:** khi thật sự bắt đầu dựng object, đọc [SKILL upstream](</home/dzerok/.img2threejs/releases/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28/img2threejs/SKILL.md>), rồi các `grimoire/` contract mà stage hiện tại chỉ tới. Generic là nhánh đã cài; không hứa các domain plugin, rig/export target hoặc vision adapter đã có. Giữ gate của upstream; quyền native, design contract và ngân sách đã duyệt vẫn có thẩm quyền.
3. **Preflight tại dự án:** xác minh Python >=3.10; Forge cơ bản dùng stdlib. Chỉ helper state/next đã kiểm tra mới dùng trực tiếp `UPSTREAM/forge/...`. Generator có thể ghi cache theo vị trí source (đặc biệt `stage2_spec/new_pre_spec_assessment.py`): trước khi dùng, tạo bản sao từ release ghim vào thư mục tool tạm/ignored riêng của task, kiểm commit/nội dung và trỏ lệnh `forge/...` vào bản sao đó; chỉ đổi cwd không bảo vệ release. Reference/spec/state/output dùng đường dẫn tuyệt đối, kiểm resolve/symlink để mọi ghi nằm trong thư mục task đã duyệt; không ghi đè khi chưa được phép. Không tự cài Python/package để che thiếu tool.
4. **State một lần, tiếp tục có bằng chứng:** nếu có `.img2threejs/state.json` trong dự án thì đọc/đối chiếu và resume. Với object mới, dùng initializer bên dưới; chạy `forge/next.py` lúc bắt đầu/resume và trước correction; đọc đề xuất lệnh rồi kiểm tra scope/path trước khi chạy. Exit 3 hoặc `status=stopped` là dừng, không init lại/tăng trần để lách. State là checklist artifact của object, không thay task owner, quyền native, Hindsight hay cổng nghiệm thu của người dùng.
5. **Dựng và đối chiếu:** graybox/silhouette → tỷ lệ/cấu trúc → node/pivot + một proof motion rẻ → vật liệu/tích hợp → tối ưu/kiểm thử, theo pass/gate kỹ thuật của upstream. Chỉ đánh dấu bước đạt khi có evidence thật; không dùng score tổng để bỏ đặc điểm nhận dạng sai, không coi ảnh tĩnh là motion/FPS proof.
6. **Bàn giao theo scope:** factory TypeScript trả `THREE.Group`, spec/tham số/node/pivot, reference/provenance, preview và evidence ở dự án. Ghi rõ approximate/stylized, góc suy luận, phần đã đo/chưa verify. Kiểm license asset, peer/API Three.js thực cài trước tích hợp; không tự nâng dependency. GLB không phải output mặc định hay bằng chứng reconstruction đúng.

## Khởi tạo object generic mới

Chỉ chạy sau khi input/path và quyền ghi artifact đã rõ. `PROJECT` là đường dẫn tuyệt đối của dự án hiện tại; reference phải thật sự tồn tại. Không chạy mẫu này để tái khởi tạo state đã có.

```bash
: "${PROJECT:?Đặt PROJECT là đường dẫn tuyệt đối của dự án hiện tại}"
UPSTREAM=/home/dzerok/.img2threejs/releases/3e7099e1b7fe93e187e06db4bdbe1e1906c21a28/img2threejs
python3 "$UPSTREAM/forge/state.py" init \
  --state "$PROJECT/.img2threejs/state.json" \
  --reference "$PROJECT/reference.png" --profile generic \
  --spec "$PROJECT/object-sculpt-spec.json" \
  --max-per-pass 2 --max-total 3
python3 "$UPSTREAM/forge/next.py" --state "$PROJECT/.img2threejs/state.json"
```

## Ranh giới cài đặt và thực thi

- Base source đã ghim, không sửa trong checkout. DSH dùng adapter này, không chạy installer auto-detect của upstream để đổi các host khác; không tự cài `img2` harness/domain plugins hoặc các gói `latest`.
- Ngay cả `state.py --help` cũng import các domain module trong checkout và đọc registry plugin. Kiểm tra nguồn/domain trước khi chạy; generic task dùng `IMG2_HOME` riêng, rỗng, không registry thật. Smoke test còn phải cô lập `HOME`/`TMPDIR`/`XDG_*`, bỏ credential/provider variables và dùng Python `-B -S` cùng `PYTHONDONTWRITEBYTECODE=1`. `next.py` có thể ghi state khi spec đã tồn tại, không gọi nó trong tác vụ chỉ đọc.
- `nextCommand` là text đề xuất, không shell-execute tự động: chọn entrypoint/argv đã đọc và kiểm đường dẫn/quyền của từng lệnh. `mark` chỉ lưu chuỗi evidence, không kiểm ảnh hay cấp quyền; phải tự đọc chứng cứ. Không dùng `--force`, `--in-place`, `--allow-nonstrict`, plugin gates hoặc executable ngoài chỉ để qua cổng. Một số intake gọi converter như `sips` và ghi output không có force gate; kiểm định dạng/đích trước, thiếu capability trên Linux thì báo, không tự cài converter.
- Đọc registry/profile và command thực tế trước khi chạy; thiếu profile/capability thì báo setup gap. Cài plugin/vision/renderer/package là scope riêng cần phê duyệt và review; không gửi ảnh/CAD riêng ra provider hoặc coi gateway local là miễn phí/offline.
- Renderer/animation phải nằm trong app/preview được dự án cho phép, một canvas/owner theo router. ThreeUI scene/iframe không mặc nhiên nhận factory hoặc bị GSAP host điều khiển.
- Xác nhận DSH load được skill chỉ chứng minh discovery; state/unit smoke chỉ chứng minh phần được test. Chất lượng object, animation, mobile GPU, reduced-motion/no-WebGL và chi phí cần task thật để đo; không lấy các kiểm tra này thay cho nhau.

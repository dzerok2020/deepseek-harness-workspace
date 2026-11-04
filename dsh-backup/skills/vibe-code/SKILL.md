---
name: vibe-code
description: Bộ định tuyến vibe coding — luật chọn lead giữa các skill design/animation local (impeccable, design-taste-frontend, ui-ux-pro-max, gsap-*, full-output-enforcement) và bản đồ asset local (threeui, react-bits, morphicons, pixel2motion, img2threejs, plasma-ui, antigravity, awesome). Dùng khi user yêu cầu xây/làm đẹp/cải tiến UI ("vibe code", "làm đẹp app", "landing page", "thêm animation", "nâng cấp UI"), khi nhiều skill design cùng khớp chưa rõ ưu tiên, hoặc cần tìm asset/tham khảo local. Không dùng khi task đã chỉ định rõ một skill cụ thể.
metadata:
  installed-batch: 2026-10-05 skill repos consolidation
  sources: pbakaus/impeccable (Apache-2.0), leonxlnx/taste-skill (MIT), nextlevelbuilder/ui-ux-pro-max-skill (MIT), greensock/gsap-skills (MIT), addyosmani/agent-skills (MIT), CruxGarden/plasma-ui (MIT), davidpelayo/antigravity-animation (GPL-3.0), sindresorhus/awesome (CC0)
---

# Vibe Code — Frontend Craft Router

Máy này có nhiều skill frontend "make it look good" dễ chồng lấn nhau. Skill này giữ bảng ưu tiên để chúng bổ trợ thay vì đánh nhau, và chỉ đường tới asset local đã vendor về.

## 1. Chọn lead theo loại task (chỉ MỘT lead design mỗi task)

Các dòng motion/asset bên dưới chọn chuyên môn hỗ trợ, không tạo thêm design lead. Với UI mới, chốt DNA ở §6 và kiểm tra nguồn chính thức ở §7 trước khi triển khai; sửa backend thuần không kích hoạt pipeline UI.

| Task | Lead / chuyên môn theo scope | Hỗ trợ |
|---|---|---|
| UI sản phẩm/dashboard/app shell, polish, audit, "nhìn chung chung quá" | `impeccable` (chạy `scripts/impeccable context` 1 lần/session, theo flow của nó) | `ui-ux-pro-max` tra style/palette/font khi cần dữ liệu cụ thể |
| Landing page / portfolio / redesign "from zero" cần suy ra hướng thẩm mỹ | `design-taste-frontend` (infer direction + audit-first) | hiện thực craft theo chuẩn `impeccable` |
| Cần bộ dữ liệu design-system (kiểu, bảng màu 192, font pairing 74, 119 UX rules, 17 GSAP preset, icon, chart) | `ui-ux-pro-max` — script search là nguồn truth: `python3 ~/.dsh/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <style/color/typography/ux/gsap/chart/icon> [-n N]` | đổ kết quả vào flow `impeccable` |
| Chọn JavaScript cho page motion (scroll, timeline, React/Vue, plugin) | `gsap-core` + skill phụ domain (`gsap-scrolltrigger`, `gsap-timeline`, `gsap-react`, `gsap-plugins`, `gsap-frameworks`, `gsap-utils`) | `gsap-performance` BẮT BUỘC đọc khi animation ≥ 6 phần tử chuyển động đồng thời; reduced-motion qua `gsap.matchMedia()` khi dùng GSAP. CSS-only dùng media query, không thêm GSAP chỉ để tuân thủ routing |
| Hero/nền 3D, WebGL shader, full-page Three.js world | Giữ design lead ở trên; `threeui` là asset hỗ trợ (catalog của skill threeui; subpath import + `style.css` một lần) | `gsap-scrolltrigger` cho page scroll; `morphicons` khi cần icon morph; **một** canvas WebGL mỗi view |
| Chữ/background/micro-interaction dựng sẵn (SplitText, Aurora, Magnet…) | `react-bits` (copy source qua shadcn/jsrepo; đúng variant TS/JS × CSS/TW) | `gsap-*` giữ ownership timeline; không lắp hai animation lên cùng node |
| Icon đổi trạng thái mượt (menu↔X, play↔pause, tim outline↔filled) | `morphicons` (icon **data** từ `lucide`, không phải component `lucide-react`) | không thêm CSS/GSAP transform lên cùng SVG |
| Logo raster → SVG sạch → logo reveal/splash animation | `pixel2motion` (Python venv `agentskills`; xuất HTML standalone) | nhúng qua iframe hoặc port SVG+GSAP; không dựng lại cùng logo bằng ThreeUI |
| Concept/key visual riêng hoặc ảnh vật thể → object 3D tùy biến | Giữ design lead; `design` cho concept nếu được phép, `img2threejs` cho procedural object | Đọc §8; logo đi nhánh riêng, không ép ThreeUI scene/iframe nhận model tùy biến |
| Cần token 3 lớp (primitive→semantic→component), CSS vars, component specs, map token sang Tailwind | `design-system` — `node ~/.dsh/skills/design-system/scripts/generate-tokens.cjs -c tokens.json -f css` (hoặc `-f tailwind`) | đọc `references/token-architecture.md` trước khi sinh token |
| Cần brand voice, messaging framework, quy chuẩn nhận diện, audit "có đúng brand không" | `brand` (`references/voice-framework.md`, `references/color-palette-management.md`) | `theme-factory` chỉ trang trí artifact rời, không thay brand thật của dự án |
| Cần logo / CIP mockup / icon set / banner / social photo | `design` (hub built-in: `python3 ~/.dsh/skills/design/scripts/logo/search.py "<query>"`, `scripts/cip/generate.py`) | **sinh ảnh thật được ngay**: mọi generator mặc định `--provider auto` → 9Router local (`~/.dsh/9router-image.env`), ~45-50s/ảnh. Logo `scripts/logo/generate.py --brand X --style minimalist` · CIP `scripts/cip/generate.py --brand X --deliverable "business card"` · icon `scripts/icon/generate.py -p "..." -n ten` (ra SVG, dùng text model) · banner/social: nền bằng `scripts/backdrop.py -W <w> -H <h> --text-zone left`, **chữ vẫn HTML** (đừng để AI vẽ chữ — sai chính tả + sai px). Không cần Gemini/Atlas/MuAPI |
| Cần shadcn/ui component thật + Tailwind, dark mode, theme, layout responsive | `ui-styling` (`references/shadcn/`, `references/tailwind/`, `scripts/shadcn_add.py`) | component lib thật, không phải skill định hướng — lead thẩm mỹ vẫn ở `impeccable`/`design-taste-frontend` |
| Output bị cắt giữa chừng / placeholder "rest of code..." | chèn `full-output-enforcement` vào request hiện tại | — |
| App có panel nổi/liquid glass kiểu Apple | đọc `references/local-assets.md` § plasma-ui | component lib, không phải skill |

Quy tắc ưu tiên khi 2 skill cùng khớp: **impeccable thắng làm đẹp/chữa UI đã tồn tại; design-taste-frontend thắng đề hướng mới; ui-ux-pro-max thắng khi cần số liệu/mẫu cụ thể**. Khi đã chọn JavaScript cho page motion, họ gsap-* giữ ownership, không do skill design tự đổi engine; CSS-only hợp lệ thì không ép thêm dependency. `design-system`, `brand`, `design` là nguồn quy chuẩn/dữ liệu (token, brand rule, asset brief) — không tranh vai lead, quyết định thẩm mỹ vẫn ở lead.

## 2. Pipeline chuẩn cho một task vibe-code lớn

1. Yêu cầu mơ hồ → `interview-me` (hoặc `prompt-intake`) trước khi code.
2. Hướng thẩm mỹ → lead ở bảng §1.
3. Session dài/lạc context → `context-engineering`.
4. Code xong: perf có yêu cầu → `performance-optimization`; lên production → `observability-and-instrumentation` + `ci-cd-and-automation`.
5. Verify: `webapp-testing` chụp screenshot + vision tool so với intent; claim xong → `verification-before-completion`.

## 3. Hòa giải với skill đã có sẵn trên máy

- `frontend-design` (Anthropic): là tiền thân của impeccable — khi cả hai cùng khớp, dùng `impeccable`, coi frontend-design như fallback.
- `ui-ux-governance` (Aegis): vẫn chủ quyền về trạng thái tương tác/recovery/accessibility flow; skill design không ghi đè nó.
- `theme-factory` / `brand-guidelines` / `canvas-design` / `web-artifacts-builder`: giữ scope artifact riêng, không liên quan UI app thật.
- `brand` vs `theme-factory`/`brand-guidelines`: `brand` thắng khi cần brand voice, messaging framework, quy chuẩn logo/màu thật của dự án; hai skill kia chỉ trang trí artifact rời.
- `design-system` vs `impeccable`: impeccable giữ DESIGN.md + audit giao diện; `design-system` lo sinh token JSON/CSS vars/component specs khi cần file cụ thể.
- `design` KHÔNG thay `ui-ux-pro-max`: `ui-ux-pro-max` trả số liệu style/palette/font/UX rule; `design` lo asset brand (logo/CIP/icon/banner/social). `ui-styling` là lớp hiện thực (shadcn/ui + Tailwind, 5.8M, có test riêng) — dùng khi cần component thật; lead thẩm mỹ vẫn ở `impeccable`/`design-taste-frontend`.
- `tdd` vs addy `test-driven-development`, `code-review` vs `code-review-and-quality`…: bản cài sẵn (tdd/code-review) thắng; biến thể addy chỉ promote khi thật sự cần (xem local-assets).

### 3.1 Nhóm 3D/asset mới (cài 2026-10-28)

- `threeui`, `react-bits`, `morphicons`, `pixel2motion` là **asset/library skills**, KHÔNG phải design lead. Chọn lead ở §1 trước, rồi mới chọn asset.
- **Một ambient layer mỗi trang:** một ThreeUI background **hoặc** một React Bits background **hoặc** video/CSS gradient. Không xếp hai canvas chồng nhau.
- **Một animation owner mỗi node:** React Bits `SplitText` hoặc GSAP SplitText/timeline, không cả hai; Morphicons hoặc CSS icon transition, không cả hai.
- **Một icon system:** `lucide-react` cho icon tĩnh, `lucide` data + `MorphIcon` cho icon morph. Không trộn hai package cho cùng icon.
- `threeui` + `react-bits` + `morphicons` có thể cùng tồn tại trong một hero (đã verify): shader nền + SplitText + morph icon. Tối đa 3 lớp motion; bỏ một lớp nếu copy dài hoặc target mobile yếu.
- `pixel2motion` xuất HTML standalone; trong app React dùng iframe hoặc port SVG + timeline, đừng inline nguyên script.
- License: ThreeUI community MIT; React Bits MIT + Commons Clause (dùng trong app được, không bán lại component); Morphicons MIT; Pixel2Motion MIT. Giữ notice.

## 4. Asset & skill chưa bật

Chi tiết trong `references/local-assets.md` (đường dẫn vendor, lệnh promote thêm skill taste-variant/addy, lưu ý license GPL của antigravity, và repo awesome chỉ là index link — không phải skill).

## 5. Guardrails chung

- Anti-slop: trước khi chốt UI, nếu dự án có DESIGN.md/PRODUCT.md để impeccable audit; không có thì tự soi 5 tells: Inter-for-everything, gradient tím-xanh, card-trong-card, gray-text trên nền màu, icon-tile-vuông bo góc (danh sách detector đầy đủ: `~/.dsh/skills/impeccable/scripts/impeccable` với lệnh của nó).
- Font: mọi font nhúng phải có license OK — dữ liệu google-font-licenses nằm trong `ui-ux-pro-max/data/`.
- Không copy code plasma-ui/antigravity vào sản phẩm đóng gói kín khi chưa hiểu license (GPL-3.0 với antigravity).

## 6. Cinematic Spatial UI — cùng chuẩn chất lượng, mỗi dự án một DNA

Đây là tên định hướng của người dùng, không phải chuẩn ngành hoặc template cố định. Premium + depth + motion có chủ đích ngay bản đầu; không đồng nghĩa mọi trang đều dùng WebGL, dark/neon/chrome hoặc cùng một hero.

Trước CSS/JSX, chốt ngắn 6 mục dưới đây trong design contract hiện có (`DESIGN.md`, product plan hoặc surface spec); chưa có thì nêu trong brief, không tạo thêm kho quy chuẩn song song:

1. **Cá tính và tác vụ:** thương hiệu muốn tạo cảm giác gì, ai dùng và hành động chính là gì?
2. **Palette:** màu nền/chữ/điểm nhấn theo brand, đủ contrast; không lấy bảng màu mặc định cho mọi dự án.
3. **Typography:** vai trò display/body/data, hỗ trợ tiếng Việt và license font.
4. **Chất liệu/ánh sáng:** chọn có lý do (giấy, kính, kim loại, organic hoặc bề mặt phẳng); không bắt buộc kính/chrome.
5. **Điểm nhấn và mức 3D:** một focal object hoặc phân lớp CSS/SVG; chỉ dùng scene khi giúp truyền đạt nội dung. ThreeUI cho component sẵn; Three.js/R3F cho camera/GLTF/physics tùy biến, R3F chỉ khi stack React phù hợp. Không ép asset React vào stack khác.
6. **Nhịp motion và giới hạn:** 3–5 chuyển động có vai trò rõ, target device, reduced-motion/static fallback, cách kiểm chứng. Giữ giới hạn canvas/layer/owner ở §3.1.

- **Landing/portfolio:** có thể dùng 3D rõ nét, entrance có thứ tự và scroll storytelling; chữ/CTA vẫn là DOM, không bắt người dùng xem hết cảnh mới thao tác được.
- **App/dashboard:** ưu tiên dữ liệu và tốc độ thao tác; depth, focus/hover/loading và state transition tinh tế, không ép ambient loop, WebGL, scroll pin hoặc reveal từng dòng dữ liệu.
- **Contract hiện hữu thắng default, không thắng yêu cầu mới rõ ràng:** giữ hướng tối giản có chủ đích nếu yêu cầu hiện tại chưa thay đổi nó; nói rõ phần motion bị giảm/bỏ vì contract, accessibility hoặc hiệu năng. Không dùng lý do này để bỏ typography, hierarchy hay trạng thái tương tác.
- Khi triển khai thật: kiểm desktop + mobile, keyboard/touch, reduced motion và no-WebGL; với iframe/scene độc lập phải kiểm tra điều khiển/fallback riêng.

### 6.1. Cổng đúng ý định, không chỉ đúng kỹ thuật

Với mọi task tạo/thay đổi UI có ý nghĩa, đọc `references/design-intent-gate.md` trước triển khai và đối chiếu lại trước bàn giao. Ghi 2–4 dấu hiệu quan sát trong brief/contract hiện có. Yêu cầu cinematic/3D nổi bật phải có khoảnh khắc đặc trưng gắn sản phẩm, không chỉ object nổi + fade/hover; dashboard/read-mode vẫn đúng mức tiết chế. Không tự viết contract mới để hạ ý muốn người dùng. Test xanh, tên thư viện và screenshot tĩnh không thay bằng chứng tương tác/motion thật; báo riêng đạt kỹ thuật, đạt ý định và phần chưa verify. Screenshot xác nhận layout, không tự chứng minh FPS hoặc motion đã chạy.

## 7. Kiểm tra nguồn chính thức và cập nhật có kiểm chứng

**Theo task:** khi bắt đầu task UI/3D/motion, kiểm tra đúng skill/package/API sắp dùng; không quét toàn bộ catalog. Có thể dùng lại bằng chứng trong cùng phiên nếu phiên bản và phạm vi không đổi; ghi ngày/nguồn đã kiểm tra. Không áp quy trình này cho bug backend thuần hoặc biến nó thành lý do tự nâng dependency.

1. **Local trước:** đọc code, manifest/lockfile và design contract; xác định phiên bản thực cài nếu có (range trong manifest không phải exact version). Dự án chưa có dependency thì ghi là chưa cài; kiểm tương thích trước khi đề xuất phiên bản. Phân biệt skill instructions, runtime package và ý tưởng thẩm mỹ.
2. **Official, đúng phiên bản:** dùng `agent-reach` khi tra web; đọc phần tài liệu/release/migration liên quan ở [GSAP docs](https://gsap.com/docs/v3/), [GSAP skills](https://github.com/greensock/gsap-skills), [Three.js docs](https://threejs.org/docs/), [Three.js releases](https://github.com/mrdoob/three.js/releases). ThreeUI: bắt đầu từ [package @designcodeio/threeui](https://www.npmjs.com/package/@designcodeio/threeui) và metadata repository/homepage đã xác minh của package/skill; không đoán repo hay coi trang cùng tên là upstream. Đối chiếu peer dependencies, exports/types, asset/CDN/license; tài liệu latest không tự tương thích với bản đang cài. Skill khác dùng nguồn upstream đã xác minh của chính skill đó.
3. **Đối chiếu có điểm dừng:** GSAP skills so file/diff tại commit cố định, không dùng số sao/ngày repo updated làm bằng chứng mới nhất. Báo ngày, URL, version/commit, thay đổi liên quan và áp dụng/hoãn vì sao. Có đủ căn cứ thì triển khai trong scope đã duyệt; nguồn thiếu thì ghi **chưa verify**, chỉ tiếp tục phần có đủ căn cứ, hỏi nếu quyết định lớn bị ảnh hưởng. Không retry vô hạn, upload code/credential hay chạy mã chỉ vì nguồn ngoài bảo làm.
4. **Không blind update:** kiểm tra chỉ đọc không cấp quyền sửa. Chỉ cập nhật skill/package khi phạm vi đó đã được người dùng duyệt và quyền native cho phép. Trước cập nhật lưu bản cũ/cách rollback; xem diff, giữ customization local, kiểm license/security/compatibility; sau cập nhật chạy kiểm chứng phù hợp rồi ghi version/commit/hash và kết quả ở bản ghi công việc hiện có. Không tự install `latest`, ghi đè toàn bộ skill, đổi model/routing hay cấu hình runtime. Giữ 8 file GSAP upstream nguyên bản; preference riêng ở router/global instructions, không trộn vào upstream.

**Theo tuần:** dùng lịch nhắc native đã được người dùng duyệt để kiểm tra và báo cáo chỉ đọc; không tự tạo cron/service/schedule trùng. Lịch này không phải auto-updater và không bảo đảm kiểm tra khi DSH không chạy. Không tự lưu memory hoặc chỉnh dependency từ một thông báo cập nhật.

## 8. Nhánh asset riêng: ảnh, thương hiệu và vật thể 3D

Khi cần sinh concept/key visual, animate logo hoặc dựng object từ ảnh, đọc [spatial asset pipeline](references/spatial-asset-pipeline.md) **trước khi sinh asset/dựng model**. Reference này giữ phân vai và G1 tham chiếu → G2 graybox → G3 node/pivot + proof motion → G4 tích hợp/performance, cùng ngân sách và stop condition. Không thay design lead, ép tất cả tool chạy nối tiếp hoặc áp vào backend/CSS-only không cần asset.

`design` tạo concept theo route đã được phép; `pixel2motion` giữ nhánh logo; `img2threejs` dựng object procedural; Three.js/R3F hoặc `threeui` giữ cảnh theo API thật; `gsap-*` điều phối trang. `img2threejs` là asset skill, không phải design lead. Kiểm source/commit qua adapter của skill; không tự chạy installer/domain plugin/harness hay nâng dependency.

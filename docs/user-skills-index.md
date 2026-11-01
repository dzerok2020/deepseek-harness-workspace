# 82 skill trong `~/.dsh/skills` — bản đồ và chi phí
Cập nhật 2026-11-01 · số liệu: mô tả (name+description) của 82 skill = **25,668 ký tự ≈ 6,417 token/request**, chiếm ~68% trong tổng catalog 37.660 ký tự hiện tại.

## 1. Tóm tắt
- 82 skill: **41 đã từng được gọi** (14,005 ký tự), **41 chưa từng được gọi** (11,663 ký tự ≈ 2,915 token).
- Nguồn "đã từng gọi": 602 session trong `~/.dsh/sessions` (chỉ log — xem `docs/ecc-skill-allowlist.md` mục 3 về giới hạn của log).
- Trùng tên: `leanrea` có cả bản project (`.dsh/skills/` của workspace) và bản user → bản project thắng, bản user là bản sao y hệt (không tốn thêm token vì trùng tên bị gộp). `design-system` trùng tên với skill ECC cùng tên nhưng **khác nội dung**; bản ECC đang bị allowlist lọc nên bản user thắng — nếu sau này muốn dùng bản ECC thì phải đổi tên một bên.

## 2. Nhóm theo lĩnh vực
### Khác (19)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `agentskills-runtime` | 436 | ✓ |
| `tdd` | 389 | ✓ |
| `research` | 360 | ✓ |
| `diagnosing-bugs` | 358 | ✓ |
| `grilling` | 317 | ✓ |
| `leanrea` | 316 | ✓ |
| `prototype` | 179 | ✓ |
| `discernment-nudge` | 1 | ✓ |
| `react-bits` | 624 | — |
| `algorithmic-art` | 324 | — |
| `observability-and-instrumentation` | 307 | — |
| `performance-optimization` | 295 | — |
| `mcp-builder` | 277 | — |
| `ci-cd-and-automation` | 207 | — |
| `full-output-enforcement` | 203 | — |
| `wayfinder` | 197 | — |
| `domain-modeling` | 151 | — |
| `triage` | 136 | — |
| `wait-what` | 50 | — |

### Tài liệu, nội dung & kỹ năng (16)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `skill-creator` | 392 | ✓ |
| `writing-for-agents` | 103 | ✓ |
| `interview-me` | 485 | — |
| `stow` | 461 | — |
| `doc-coauthoring` | 428 | — |
| `docx` | 417 | — |
| `xlsx` | 407 | — |
| `pptx` | 354 | — |
| `pdf` | 343 | — |
| `wizard` | 313 | — |
| `teach` | 309 | — |
| `to-questionnaire` | 283 | — |
| `pr` | 258 | — |
| `brand` | 183 | — |
| `grill-with-docs` | 106 | — |
| `grill-me` | 51 | — |

### Animation & 3D (12)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `pixel2motion` | 756 | ✓ |
| `threeui` | 658 | ✓ |
| `gsap-core` | 541 | ✓ |
| `gsap-plugins` | 352 | ✓ |
| `gsap-scrolltrigger` | 323 | ✓ |
| `gsap-timeline` | 295 | ✓ |
| `img2threejs` | 280 | ✓ |
| `gsap-react` | 273 | ✓ |
| `gsap-performance` | 228 | ✓ |
| `morphicons` | 476 | — |
| `gsap-frameworks` | 355 | — |
| `gsap-utils` | 228 | — |

### Quy trình làm phần mềm (11)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `four-phase-build` | 402 | ✓ |
| `four-phase-implement` | 394 | ✓ |
| `four-phase-tech-plan` | 379 | ✓ |
| `four-phase-env-setup` | 359 | ✓ |
| `four-phase-product-plan` | 357 | ✓ |
| `implement` | 321 | ✓ |
| `to-tickets` | 247 | — |
| `setup-pre-commit` | 238 | — |
| `setup-matt-pocock-skills` | 180 | — |
| `to-spec` | 149 | — |
| `implement-spec` | 57 | — |

### Chất lượng & kỹ thuật agent (10)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `vibe-code` | 545 | ✓ |
| `code-review` | 440 | ✓ |
| `retro` | 316 | ✓ |
| `karpathy-guidelines` | 219 | ✓ |
| `context-engineering` | 198 | ✓ |
| `agent-reach` | 1 | ✓ |
| `ponytail` | 1 | ✓ |
| `improve-codebase-architecture` | 379 | — |
| `handoff` | 294 | — |
| `git-guardrails-claude-code` | 243 | — |

### Thiết kế & UI (10)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `design` | 662 | ✓ |
| `impeccable` | 589 | ✓ |
| `ui-ux-pro-max` | 495 | ✓ |
| `canvas-design` | 289 | ✓ |
| `design-taste-frontend` | 269 | ✓ |
| `ui-styling` | 489 | — |
| `frontend-design` | 356 | — |
| `design-system` | 276 | — |
| `codebase-design` | 265 | — |
| `theme-factory` | 262 | — |

### Tích hợp DSH / công cụ ngoài (4)

| skill | mô tả (ký tự) | đã gọi |
|---|---|---|
| `dsh-vibe-pipeline` | 426 | ✓ |
| `prompt-intake` | 412 | ✓ |
| `webapp-testing` | 372 | ✓ |
| `claude-api` | 2 | ✓ |


## 3. Muốn giảm tiếp thì làm gì (đo trước, đừng đoán)

| Cách | Tiết kiệm | Rủi ro | Kết luận |
|---|---|---|---|
| Thôi dùng 41 skill chưa từng gọi | ≈2.916 token/request | Cao: mất `pdf`, `docx`, `xlsx`, `pptx`, `stow`, `interview-me`… đúng là những skill chỉ dùng khi cần | **Không nên** — tỷ lệ tiết kiệm/chịu rủi ro kém |
| Rút gọn mô tả các skill ít dùng xuống ~120 ký tự | ≈1.500-2.000 token/request | Thấp (chỉ sửa chữ), nhưng phải sửa 30-40 file | Chấp nhận được nếu muốn tối ưu |
| Gộp 8 skill `gsap-*` thành 2 | ≈500 token | Mất chi tiết khi làm animation phức tạp | Không đáng |
| `includeDefaultRoots: false` + `customSkillDirs` trỏ vào một root tuyển chọn | Tùy root giữ lại, tối đa ≈6.400 token | Phải tổ chức lại `~/.dsh/skills`, đồng thời mất luôn `.dsh/skills` của project và `~/.agents/skills` nếu không khai báo lại | Chỉ làm khi thật cần giảm sâu |

Cơ chế thật của provider (`@deepseek-ai/dsh-skill-filesystem`): root được hard-code trong `roots()` — `.dsh/skills` (project), `.agents/skills` (project), `customSkillDirs`, `~/.dsh/skills`, `~/.agents/skills`, bundled. **Không có allowlist/deny-list cho skill người dùng** như adapter ECC; chỉ có 2 knob `includeDefaultRoots` (mặc định `true`) và `customSkillDirs` (mặc định rỗng). Vì vậy "gom" skill người dùng = hoặc rút gọn mô tả, hoặc đổi root.

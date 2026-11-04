# Bản đồ asset & skill local — vibe-code

Mọi repo đã vendor tại `/home/dzerok/vendor/skill-repos/` (git clone --depth 1, 05/10/2026).

## 1. Repo nào là gì

| Repo (folder) | Là gì | License | Cách dùng |
|---|---|---|---|
| `impeccable/` | Nguồn của skill `impeccable` (đã cài từ bản build `.dsh/skills/impeccable`, v4.5.0); repo còn có 24 slash-commands, 61 detector rules, mẫu DESIGN.md/AGENTS.md, crates Rust | Apache-2.0 | Skill tự chạy `scripts/impeccable <verb>`; binary self-contained (đã test OK 05/10) |
| `taste-skill/` | 13 biến thể "anti-slop taste"; mới cài 2 (flagship + output) | MIT | Promote biến thể khác theo §3 |
| `ui-ux-pro-max-skill/` | 7 skill; mới cài flagship `ui-ux-pro-max` (DB 79 styles / 192 palettes / 74 font pairs / 119 UX rules / 105 icons / 17 GSAP presets / 25 charts / 22 stacks — `scripts/search.py`, python3 stdlib, đã test OK) | MIT | Các sibling (design, design-system, slides, banner-design, brand, ui-styling) chưa bật — trùng impeccable/pptx/brand-guidelines |
| `gsap-skills/` | 8 skill GSAP chính chủ — đã cài cả 8 | MIT | Read `skills/*/SKILL.md` bản gốc nếu cần đối chiếu |
| `agent-skills/` | 25 skill SDLC của Addy Osmani; mới cài 5 | MIT | Promote tiếp theo §3 |
| `plasma-ui/` | KHÔNG phải skill — `@cruxgarden/plasma-ui` v0.3.0: React + WebGL, panel "liquid glass" hòa trộn khi chạm, snap grid 24px | MIT | `npm i file:/home/dzerok/vendor/skill-repos/plasma-ui` trong project React; docs ở `plasma-ui/docs/`, demo ở `plasma-ui/examples/workspace/`, playground: https://cruxgarden.github.io/plasma-ui/ |
| `antigravity-animation/` | KHÔNG phải skill — 2 file HTML demo particle "antigravity" (basic + pattern), chỉnh qua URL params, GPU-accelerated | GPL-3.0 | Tham khảo kỹ thuật (`antigravity-basic.html`, `antigravity-pattern.html`); KHÔNG nhúng code nguyên bản vào sản phẩm đóng kín khi chưa xử lý điều kiện GPL |
| `awesome/` | KHÔNG phải skill — sindresorhus/awesome: index các awesome list | CC0 | Tra `readme.md` khi cần tìm curated list theo chủ đề; đừng biến nó thành skill |

## 2. Skill đã cài (18) — tóm tắt vai trò

- Design lead: `impeccable` — polish/audit/redesign UI có sẵn, có `context`/`detect` chạy thật.
- Direction lead: `design-taste-frontend` — brief → hướng thẩm mỹ cho landing/portfolio mới.
- Data DB: `ui-ux-pro-max` — tra style/palette/font/motion theo từ khóa.
- Animation: `gsap-core|timeline|scrolltrigger|plugins|react|frameworks|utils|performance` (8).
- Discipline: `full-output-enforcement` (chống cắt code), `interview-me` (chốt yêu cầu), `context-engineering`, `performance-optimization`, `observability-and-instrumentation`, `ci-cd-and-automation`.
- Router: `vibe-code` (skill này).

## 3. Promote / gỡ skill chưa bật

Catalog DSH cập nhật LIVE khi file xuất hiện trong `~/.dsh/skills/` — không cần restart, không cần chat mới (đã xác chứng 05/10/2026).

```bash
# Promote: folder đích PHẢI trùng frontmatter `name:` (tên thật → folder nguồn)
cp -r /home/dzerok/vendor/skill-repos/taste-skill/skills/soft-skill ~/.dsh/skills/high-end-visual-design
cp -r /home/dzerok/vendor/skill-repos/taste-skill/skills/brutalist-skill ~/.dsh/skills/industrial-brutalist-ui
cp -r /home/dzerok/vendor/skill-repos/taste-skill/skills/minimalist-skill ~/.dsh/skills/minimalist-ui
cp -r /home/dzerok/vendor/skill-repos/taste-skill/skills/redesign-skill ~/.dsh/skills/redesign-existing-projects
# taste còn lại: brandkit, gpt-tasteskill(gpt-taste), image-to-code-skill(image-to-code),
#   imagegen-frontend-web, imagegen-frontend-mobile, stitch-skill(stitch-design-taste), taste-skill-v1(design-taste-frontend-v1)
# ui-ux-pro-max siblings: banner-design, brand, design, design-system, slides, ui-styling (nguồn: ui-ux-pro-max-skill/.claude/skills/<tên>)
# addy còn lại: api-and-interface-design, browser-testing-with-devtools, code-review-and-quality,
#   code-simplification, constraint-driven-development, debugging-and-error-recovery, deprecation-and-migration,
#   documentation-and-adrs, doubt-driven-development, frontend-ui-engineering, git-workflow-and-versioning,
#   idea-refine, incremental-implementation, planning-and-task-breakdown, security-and-hardening,
#   shipping-and-launch, source-driven-development, spec-driven-development, test-driven-development, using-agent-skills
#   (nguồn: agent-skills/skills/<tên>)

# Gỡ:
rm -rf ~/.dsh/skills/<folder>
```

Lý do các biến thể trên chưa bật mặc định: trùng trigger với skill lead đã cài (`impeccable` phủ polish/redesign; `tdd`/`code-review`/`writing-plans`/`webapp-testing`/`code-security-audit`/`pptx`/`brand-guidelines` đã có sẵn bằng tiếng Việt-friendly). Chỉ promote khi người dùng thật sự cần phong cách riêng.

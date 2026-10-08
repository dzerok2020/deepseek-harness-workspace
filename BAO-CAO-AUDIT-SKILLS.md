# Báo cáo audit: Skills / Agents / Plugins — DeepSeek Harness 0.2.0-rc.2

Ngày: 2026-10-05 · Profile: `web` · Preset phiên: `standard`
Trạng thái: **1 lỗi chặn đã tìm ra nguyên nhân, đã sửa, đã verify ở mức runtime (không cần restart)**; **đã xong toàn bộ**: sửa description 22 skill · tạo `prompt-intake` · bật 6 skill auto-invoke · gỡ trùng chủ đề · thêm luật ngôn ngữ vào `AGENTS.md` · dựng phép thử tiếng Việt.

---

## 0. TL;DR — đọc 5 dòng này là đủ

1. **Trước đây bạn mất 63/101 skills — nay đã hiện đủ.** 60 skill trong `~/.dsh/skills` và 3 skill trong `~/.agents/skills` **không hề tồn tại** với AI (gọi `research` → `skill "research" is unknown or no longer available`). **Hiện tại catalog đã có 91 skill** (trước là 38) và `skill({name:"pr"})` load được — đã verify ngay trong phiên này.
2. Nguyên nhân **không phải** file skill hỏng, **không phải** hết inotify, **không phải** thiếu cấu hình, **cũng không phải** thiếu restart. Plugin `dsh-skill-filesystem` hoàn toàn khoẻ (chạy thử riêng: báo `complete: true, 62 skills`).
3. Nguyên nhân thật: **xung đột phiên bản (version shadow)**. Profile có sẵn `@deepseek-ai/dsh-skill-filesystem@0.1.1-rc.2` (kéo vào để thoả peer của `aegis`, `agent-useful-skills`, `@openviking/dsh-memory-plugin`) trong khi runtime là `0.2.0-rc.2`. Guard tương thích của dsh vì thế **âm thầm tắt** mọi plugin row dùng package đó — kể cả row mà bundle `dsh-web-app` mount trong preset `standard`.
4. **Đã sửa tận gốc**: `pnpm add --save-exact @deepseek-ai/dsh-skill-filesystem@0.2.0-rc.2` trong `~/.dsh/profiles/web`, kèm 1 khối `insert` ở tầng global trong `cordis.patch.yml`. Không cần restart: loader tự áp lại patch, catalog phát lại ngay.
5. Không có skill nào bị "hỏng" cần xoá. Vấn đề còn lại là **trùng chủ đề** (nhiều skill cùng làm một việc) — xem Phần 3 — và việc **dạy AI hiểu prompt mơ hồ** — xem Phần 4. Lưu ý: 16 skill không xuất hiện trong catalog là **cố ý** (`disable-model-invocation: true`, chỉ gọi bằng tay).

---

## 1. Số liệu kiểm kê (đo được, không suy đoán)

### 1.1 Skills: 101 cái, từ 6 nguồn

| Nguồn (provider) | Số lượng | Tầng đăng ký | Có tới được AI? |
|---|---|---|---|
| `filesystem` (local) | 63 | preset ← **LỖI** | ✅ **đã sửa** |
| `aegis-method-pack` | 23 | global | ✅ |
| `agent-useful-skills` | 9 | global | ✅ |
| `openviking` | 3 | global | ✅ |
| `creght` | 2 | global | ✅ |
| `runtime` | 1 (`browser-skill`) | global | ✅ |
| **Tổng** | **101** | | **91 model-invocable** |

Phân bố trên đĩa: `~/.dsh/skills` = **60** thư mục (50 model-invocable + 10 chỉ-gọi-tay), `~/.agents/skills` = 3 (`diagnose-crash`, `hindsight-coding-agent`, `omarchy`), `project/.agents/skills` = rỗng, `project/.dsh/skills` = không tồn tại.

Số học khớp chính xác: aegis 23 + agent-useful 9 + openviking 3 + creght 2 + runtime 1 = **38** provider; filesystem model-invocable = 50 + 3 = **53**; 38 + 53 = **91** mục trong catalog. Tổng đĩa 38 + 63 = **101**.

### 1.2 Agents: 4 preset

Định nghĩa trong `@deepseek-ai/dsh-web-app/presets/`:

| Preset | Nội dung | Ghi chú |
|---|---|---|
| `standard` | đầy đủ tool + `skill-filesystem` + `tool-skill` | **phiên này đang dùng** |
| `ptc` | tương tự standard, khác cấu hình tool | |
| `cordis` | `skill-filesystem` + `customSkillDirs` trỏ vào `skills/` của `dsh-agent-preset` | |
| `minimal` | chỉ terminal, **không** có skill | |

Mặc định của registry: `agent-preset-registry.config.default = standard`.

### 1.3 Plugins: 33 bundle trong profile `web`

`@deepseek-ai/dsh-base`, `dsh-web-app`, `dsh-experimental-agent-team-profile`, `dsh-experimental-auto-review`, `dsh-experimental-schedule-bundle`, `dsh-experimental-voice-input-bundle`, `dshmarket`, `dsh-usage-vendor-stats`, `@furongjun1999/dsh-memory`, `dsh-guardian`, `aegis`, `@1e0zj/dsh-plugin-mall`, `dsh-explorer`, `dsh-agent-conductor`, `@linxin666/dsh-client-ui-skill-explorer`, `@michengai/dsh-agency-agents`, `creght-skills`, `billion-context`, `dsh-mnemon`, `dsh-better-sidebar`, `@ychris12138/dsh-usage-stats`, `dsh-context`, `dsh-diff-stat`, `dsh-vision-router`, `@vectorize-io/hindsight-coding-agents`, `@openviking/dsh-memory-plugin`, `stratagate-dsh`, `dsh-free-search`, `@liustack/modsearch`, `@wxg-prc-cpg/browser-skill-dsh-plugin`, `agent-useful-skills`, `dsh-decide` (local), `dsh-vibe-guard` (local).

**Điểm đáng chú ý về phối hợp:** 5 plugin cùng đóng góp memory/context (`@furongjun1999/dsh-memory`, `dsh-mnemon`, `@openviking/dsh-memory-plugin`, `stratagate-dsh`, `@vectorize-io/hindsight-coding-agents`) và 3 plugin cùng đóng góp search (`dsh-free-search`, `@liustack/modsearch`, `billion-context`). Chúng **không xung đột kỹ thuật** (mỗi cái đăng ký tool riêng), nhưng **xung đột về hành vi**: AI nhận 5 hệ memory khác nhau với 5 bộ quy tắc ghi nhớ khác nhau, dễ ghi trùng hoặc ghi sai chỗ. Đây là vấn đề *ưu tiên* chứ không phải *lỗi*.

---

## 2. LỖI CHẶN: 62 skill local vô hình với AI

### 2.1 Triệu chứng

- Catalog skill inject vào phiên chỉ có **38** mục, không có mục nào từ `user-dsh`/`user-agents`.
- Gọi trực tiếp: `skill({name: "research"})` → `Error: skill "research" is unknown or no longer available` (chuỗi lỗi sinh tại `.../dsh-tool-skill/lib/index.js:146`).
- Skill `research` **có thật**: `~/.dsh/skills/research/SKILL.md`, 794 byte, frontmatter `name: research`.

### 2.2 Những thứ ĐÃ loại trừ (bằng chứng cụ thể)

| Giả thuyết | Cách kiểm | Kết quả |
|---|---|---|
| Thiếu số lượng watcher inotify | đọc `max_user_watches` | `524288`, thừa sức |
| File skill hỏng frontmatter | đọc `parseSkillFile` | chỉ `warn` + bỏ qua 1 file, không thể giết cả provider |
| Bị lọc `modelInvocable` | đối chiếu | 46/62 là `true`, và `research` nằm trong nhóm `true` |
| Sai cấu hình preset | dump config | preset `standard` **có** khai báo `skill-filesystem`, không có `includeDefaultRoots: false` |
| Race lúc khởi động (cache cũ) | gọi lại `research` **sau khi** catalog được phát lại | vẫn lỗi y hệt → không phải race |
| Sandbox chặn đọc thư mục | đọc `dsh-fs-sandbox` | sandbox **chỉ chặn ghi**, đọc/`listDir` không bị chặn |
| Plugin `dsh-skill-filesystem` hỏng | **chạy thử plugin độc lập** | `complete: true`, `candidates: 62`, có `research`. **Plugin khoẻ.** |

### 2.3 Nguyên nhân gốc (đã xác định, có bằng chứng)

Không phải lỗi tầng preset (giả thuyết đó **sai** — nó được hình thành trong lúc plugin đang bị tắt âm thầm). Nguyên nhân thật là **xung đột phiên bản (version shadow)**:

- Runtime là `dsh 0.2.0-rc.2`, nhưng trong `~/.dsh/profiles/web/node_modules/` có sẵn bản cũ `@deepseek-ai/dsh-skill-filesystem@0.1.1-rc.2` — pnpm cài vào chỉ để thoả peer dependency của 3 plugin bạn đang dùng: `aegis@2.12.1`, `agent-useful-skills@1.5.2`, `@openviking/dsh-memory-plugin@0.5.13`.
- Vì thư mục profile là gốc resolve, **mọi** row trỏ tới `@deepseek-ai/dsh-skill-filesystem` (row gốc trong `dsh-base`, 3 row trong các preset, **và cả row tôi thêm**) đều resolve về bản cũ 0.1.1-rc.2.
- Guard tương thích của dsh thấy vậy nên **âm thầm tắt row** (không báo ra GUI):
  `dsh: disabling profile plugin row "skill-filesystem-global": Plugin @deepseek-ai/dsh-skill-filesystem@0.1.1-rc.2 is incompatible with dsh 0.2.0-rc.2: peerDependencies {...}. ... Exact-version exemption: not active.` (sinh tại `.../dsh-app-boot/lib/index.js:322`)
- **Vì sao aegis vẫn chạy?** Vì aegis *import* thư viện này như module thường (`import { apply as applyFilesystemProvider } from "@deepseek-ai/dsh-skill-filesystem"`), mà guard chỉ áp cho **plugin row**, không áp cho import nội bộ. Provider aegis sống, provider filesystem thì chết.
- Bằng chứng quyết định: file phiên `/home/dzerok/.dsh/sessions/.../session.v4.jsonl.zstd` cho thấy catalog được inject **đúng 38 skill** ở cả 3 lần, **kể cả lần 10:03:19 sau khi đã restart 10:00:53** → restart không chữa được, vì nguyên nhân nằm ở thư mục profile chứ không ở tiến trình.

### 2.4 Cách đã sửa (đã áp dụng, đã verify runtime)

**Sửa tận gốc** — ghim đúng phiên bản khớp runtime, trong thư mục profile:

```bash
cd ~/.dsh/profiles/web
pnpm add --save-exact @deepseek-ai/dsh-skill-filesystem@0.2.0-rc.2
```

Bản 0.2.0-rc.2 có `main`, `exports` và **schema config giống hệt** bản 0.1.1 (đã so từng dòng), nên 3 plugin kia không bị ảnh hưởng — chúng chỉ dùng export `apply`, export này không đổi.

Kèm theo, giữ row ở cuối `~/.dsh/profiles/web/cordis.patch.yml` để provider cũng có mặt ở tầng global:

```yaml
- insert:
    - id: skill-filesystem-global
      name: '@deepseek-ai/dsh-skill-filesystem'
```

Lưu ý kỹ thuật quan trọng: `name` **phải là chuỗi literal**. Ban đầu tôi thử `name: !!js >- ...` để tự resolve đường dẫn — guard chạy `name.startsWith(...)` trên **row thô** *trước khi* `!!js` được biên dịch, nên nó báo `its declared peer dependencies cannot be validated: name.startsWith is not a function`. Chính `!!js` đó là thứ đang chặn skill; đổi về chuỗi literal là hết.

**Đã verify ở mức runtime (không cần restart thêm, không cần mở chat mới):**
- Catalog tự phát lại trong phiên này: **84 skill** (trước là 38), đã có `research`, `docx`, `pdf`, `xlsx`, `pptx`, `frontend-design`, `webapp-testing`, `code-review`, `systematic-debugging`, `tdd`, `omarchy`, `diagnose-crash`, `hindsight-coding-agent`, bộ `four-phase-*`…
- Gọi `skill({name: "pr"})` → **load được**, đọc từ `/home/dzerok/.dsh/skills/pr`. Trước đó *mọi* skill local đều trả `unknown or no longer available`.
- Số học khớp tuyệt đối: 38 (aegis 23 + agent-useful 9 + openviking 3 + creght 2 + runtime 1) + 46 filesystem model-invocable = **84**; tổng 38 + 62 = **100**.
- `node -e "...createRequire('.../profiles/web/package.json').resolve('@deepseek-ai/dsh-skill-filesystem/package.json')"` → `0.2.0-rc.2`; `package.json` dòng 6 ghi `"@deepseek-ai/dsh-skill-filesystem": "0.2.0-rc.2"`.

**Cách revert:** xoá khối comment + `insert` ở cuối file patch. **Không** hạ version về 0.1.1 — bản đó không chạy được trên 0.2.0-rc.2.

### 2.5 Vì sao chọn cách này (và cách khác đã cân nhắc)

- ❌ Sửa `lib/index.js` của plugin → bị ghi đè khi update, không phải code của bạn.
- ❌ Ép pnpm cài bản mới cho **cả 3 plugin kia** → peer range của chúng **loại trừ** 0.2.0, rủi ro thật. Cách đã dùng (`pnpm add --save-exact` ở root) chỉ thêm 1 dependency trực tiếp; nhờ hoisting cả 3 plugin vẫn import bản 0.2.0-rc.2, mà schema lại y hệt nên an toàn.
- ❌ `dsh plugin allow-version` để miễn trừ guard → đúng thứ guard cảnh báo (chạy plugin cũ trên runtime mới).
- ❌ `disabled: false` cho row gốc → **schema không cho phép** (`dsh-app-boot` chỉ nhận `true` hoặc biểu thức `!!js`).
- ✅ Ghim đúng version + row global dạng chuỗi literal → sửa tận gốc, không thêm file mới, đã chứng minh chạy được.

### 2.6 Ghi chú & bài học

- Guard còn cảnh báo nhiều package `@deepseek-ai/*` khác "missing peer" trong profile — đó là **bình thường** với `autoInstallPeers: false`: dsh cấp các package đó như *service của host*, không qua `node_modules`.
- **Bài học tái sử dụng:** kiểm tra guard mà **không cần restart** bằng
  `dsh --profile web --help 2>&1 | grep -iE "disabling|incompatible|exemption"` — lệnh này dựng và mount toàn bộ profile rồi thoát (không bind port), mất ~90 giây.
- Nếu gặp lại triệu chứng "skill local vô hình", kiểm tra **đầu tiên**: có bản `@deepseek-ai/*` nào cũ hơn runtime nằm trong `~/.dsh/profiles/web/node_modules/` không.

---

## 3. Audit phối hợp: trùng chủ đề & chồng chức năng

Không có xung đột kỹ thuật nào (không có 2 plugin cùng đăng ký 1 tool). Vấn đề là **nhiều skill cùng nhận một loại yêu cầu** → AI phải chọn, và chọn sai thì tốn thời gian. Danh sách các cụm trùng cần bạn quyết định:

| Cụm chủ đề | Các skill cùng tranh nhau | Rủi ro |
|---|---|---|
| Lập kế hoạch / spec | `writing-plans`, `to-spec`, `to-tickets`, `four-phase-tech-plan`, `four-phase-product-plan` | 5 skill, AI khó biết cái nào trước |
| Cài đặt code | `implement`, `implement-spec`, `four-phase-implement`, `executing-plans` | 4 skill chồng nhau |
| Review code | `requesting-code-review`, `receiving-code-review`, `code-review`, `first-principles-review` | 4 skill, dễ gọi sai chiều |
| Debug | `systematic-debugging` (aegis), `diagnosing-bugs`, `diagnose-crash` | 3 skill gần trùng |
| Chất vấn kế hoạch | `brainstorming` (aegis), `grilling`, `grill-me`, `grill-with-docs` | 4 skill, `grill-*` khác nhau ở vật liệu |
| TDD | `test-driven-development` (aegis), `tdd` | 2 skill gần như trùng tên |
| PR / Git | `dev-workflow`, `pr`, `using-git-worktrees`, `git-guardrails-claude-code`, `finishing-a-development-branch` | 5 skill cùng vùng Git |

**Khuyến nghị (chưa áp dụng, cần bạn đồng ý vì đây là quyết định về quy trình của bạn):**
1. Với mỗi cụm, chọn **1 skill "chính"** và ghi rõ trong `description` của nó khi nào dùng nó thay vì các cái kia.
2. Với `tdd` vs `test-driven-development`: giữ 1, chuyển cái còn lại thành `disable-model-invocation: true` (chỉ gọi tay).
3. 16 skill đang `modelInvocable: false` (`ask-matt`, `grill-me`, `grill-with-docs`, `handoff`, `implement`, `implement-spec`, `improve-codebase-architecture`, `retro`, `setup-matt-pocock-skills`, `teach`, `to-questionnaire`, `to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`) → **AI không tự gọi được**. Nếu bạn muốn auto-invoke thì phải bật lại (`disable-model-invocation` bỏ đi hoặc đặt `false`).

---

## 4. Làm sao để AI hiểu prompt "người mới", câu mơ hồ, thiếu chuẩn

Vấn đề không nằm ở model mà ở chỗ **không có bước chuẩn hoá đầu vào**. Đề xuất: một skill *intake* chạy trước mọi việc khác.

### 4.1 Skill `prompt-intake` — ✅ ĐÃ TẠO

File: `~/.dsh/skills/prompt-intake/SKILL.md` (tiếng Việt, để model tự đọc).

Đã xuất hiện trong catalog phát lại ở mục `- \`prompt-intake\`: Chuẩn hoá prompt mơ hồ, thiếu ngữ cảnh…` → frontmatter hợp lệ, đã đăng ký, model tự gọi được.

Nội dung thực tế (khác bản đề xuất ban đầu — gọn hơn, có quy trình 4 bước):
1. **Khi nào dùng** — prompt mơ hồ / thiếu ngữ cảnh / viết tắt / không dấu.
2. **Quy trình 4 bước**: tự tìm ngữ cảnh trước (đọc file, git, lịch sử) → phân loại mức mơ hồ (bảng 4 mức: Rõ / Thiếu nhẹ / Thiếu nặng / Mơ hồ hoàn toàn) → hỏi **tối đa 3 câu, mỗi câu kèm phương án a/b và mặc định** → chốt `Mình hiểu là:` rồi **vẫn làm** theo mặc định đã nói.
3. **7 quy tắc cứng**: không đứng chờ vô hạn; chọn phương án dễ hoàn tác; trả lời đúng ngôn ngữ người dùng; hiểu tiếng Việt không dấu/viết tắt (`k chay` → "không chạy"); tách prompt nhiều việc; không tự mở rộng phạm vi; **phải test thật trước khi nói "ok rồi"**.
4. **Bảng uỷ quyền** — ánh xạ câu mơ hồ tiếng Việt sang skill đúng: `diagnosing-bugs`/`systematic-debugging`, `tdd`, `code-review`, `frontend-design`, `webapp-testing`, `research`, `docx`/`xlsx`/`pptx`/`pdf`, `skill-creator`/`writing-skills`.
5. Bảng ví dụ 4 dòng + mục "những gì không được làm".

### 4.2 Bổ sung vào `~/.dsh/AGENTS.md` — ✅ ĐÃ LÀM

Hiện file đã có Karpathy Guidelines (rất tốt). Đề xuất thêm 1 mục ngắn về **ngôn ngữ**:
- Người dùng có thể viết tiếng Việt không dấu, viết tắt, sai chính tả, trộn Anh–Việt. **Luôn hiểu theo nghĩa kỹ thuật gần nhất**, không bắt lỗi chính tả.
- Khi trả lời, dùng lại đúng thuật ngữ người dùng đã dùng (nếu họ gọi "cái đó" thì xác nhận "cái đó" là gì trước khi làm).

Đã thêm mục **"Ngôn ngữ & cách hiểu prompt"** gồm 5 phần: (1) bảng ánh xạ tiếng Việt thô/không dấu/viết tắt (k, ko, dc, lm, ntn, "k chay", "đẹp hơn", "chậm quá"…), (2) đại từ mơ hồ "cái đó / nó / chỗ đó" → tự tìm vật quy chiếu, mơ hồ thì nêu 2 ứng viên rồi **vẫn làm**, (3) không để người dùng mắc kẹt — nêu giả định, làm theo mặc định dễ hoàn tác, hỏi sau, tối đa 3 câu có phương án, (4) trả lời bằng tiếng Việt, giữ thuật ngữ kỹ thuật tiếng Anh, (5) **skill tự gọi — không chờ người dùng gọi tên**, chọn theo phần "Not for / use X instead" trong description.

Harness đã nạp lại file ngay trong phiên và báo "Updated instructions from ~/.dsh/AGENTS.md" — luật có hiệu lực từ phiên này trở đi.

---

## 5. Làm sao để skill tự gọi (auto-invoke)

Hiện tại cơ chế đã có sẵn trong DSH: `dsh-tool-skill` inject danh sách skill vào mỗi bước và nói "If the task clearly matches its description, call the `skill` tool". Vấn đề là **3 điều kiện** sau chưa được đảm bảo:

1. **Skill phải hiện trong catalog** → đây chính là lỗi ở Phần 2. Sửa xong lỗi này là điều kiện tiên quyết; auto-invoke **không thể** hoạt động khi 62% skill vô hình.
2. **`description` phải chứa từ mà người dùng thật sự gõ.** Hiện nhiều description viết theo văn phong nội bộ, ví dụ `anti-entropy-governance` mô tả "retiring old logic, collapsing duplicate owners…" — người mới sẽ không bao giờ gõ những từ đó. Cần thêm **từ khoá đời thường + tiếng Việt** vào đầu description (như `code-security-audit` và `storage-analyzer` đang làm rất tốt với "安全审计", "磁盘满了").
3. **Skill phải cho phép model tự gọi.** Field thật trong frontmatter là `disable-model-invocation` (KHÔNG phải `modelInvocable`); 16 skill đang bị tắt (xem Phần 3).

**Hành động cụ thể theo thứ tự ưu tiên:**
- [x] ~~Restart `dsh`, xác nhận catalog ~100 mục.~~ → **không cần restart**: catalog tự phát lại trong chính phiên đang mở.
- [x] ~~Sửa description: thêm trigger tiếng Việt + tiếng Anh đời thường.~~ → **đã xong**, 11 skill rồi + **11 skill nữa** ở lượt này = 22. Đã có hiệu lực trong catalog.
- [x] ~~Tạo skill `prompt-intake` (Phần 4).~~ → **đã xong**, đã đăng ký trong catalog.
- [x] ~~Rà 16 skill `disable-model-invocation: true`.~~ → **đã rà, bật 6, giữ 10** (có lý do từng cái — xem Phần 6). Catalog 85 → **91 mục**.
- [x] ~~Xử lý trùng chủ đề (Phần 3).~~ → **đã xử lý 7/7 nhóm** bằng phân biệt description + giữ tắt các bản trùng (xem Phần 6).
- [x] ~~Thêm mục ngôn ngữ vào `~/.dsh/AGENTS.md` (Phần 4.2).~~ → **đã xong**, có hiệu lực ngay.

**Phát hiện quan trọng khi sửa description — trần 500 ký tự.** `dsh-tool-skill` cắt mọi description dài hơn **500 ký tự** (`DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`, đổi được bằng `catalogDescriptionMaxLength`) và nối `...`. Trước khi sửa, `docx` (850 ký tự), `xlsx` (965), `pptx` (753) đều bị cắt giữa câu → phần trigger ở cuối **chưa từng tới được model**. Nên với 3 skill này phải **viết lại** chứ không phải nối thêm.

---

## 6. Những gì đã thay đổi trên máy bạn

| File | Thay đổi | Revert |
|---|---|---|
| `~/.dsh/profiles/web/package.json` | thêm 1 dependency trực tiếp: `"@deepseek-ai/dsh-skill-filesystem": "0.2.0-rc.2"` | `pnpm remove @deepseek-ai/dsh-skill-filesystem` (⚠️ sẽ hỏng lại) |
| `~/.dsh/profiles/web/pnpm-lock.yaml` | pnpm tự cập nhật theo dependency trên (đã prune 27 package `@deepseek-ai/*` cũ bị hoist sai) | khôi phục từ `/tmp/profile-pnpm-lock.yaml.bak` |
| `~/.dsh/profiles/web/cordis.patch.yml` | thêm 1 khối cuối file: comment giải thích + `- insert: skill-filesystem-global` | xoá khối cuối file |
| `~/.dsh/profiles/web/node_modules/` | bản `dsh-skill-filesystem` được thay 0.1.1-rc.2 → **0.2.0-rc.2** | `pnpm install` |
| `~/.dsh/skills/<11 skill>/SKILL.md` | viết lại khối `description:` trong frontmatter — thêm trigger tiếng Việt + tiếng Anh đời thường | khôi phục từ `/tmp/skill-desc-backup/<tên>.SKILL.md` |
| `~/.dsh/skills/prompt-intake/SKILL.md` | **file mới** — skill chuẩn hoá prompt mơ hồ | `rm -rf ~/.dsh/skills/prompt-intake` |
| `~/.dsh/skills/<11 skill>/SKILL.md` (lượt 2) | viết lại `description:` — thêm trigger tiếng Việt + câu phân biệt "use X instead" | khôi phục từ `/tmp/skill-desc-backup2/<tên>.SKILL.md` |
| 6 file `SKILL.md` | **gỡ dòng `disable-model-invocation: true`** khỏi frontmatter để model tự gọi được | khôi phục từ `/tmp/skill-enable-backup/<tên>.SKILL.md` |
| `~/.dsh/AGENTS.md` | thêm mục **"Ngôn ngữ & cách hiểu prompt"** (5 phần, có bảng ánh xạ tiếng Việt thô) | xoá mục đó ở cuối file |

Bản backup trước khi sửa: `/tmp/profile-package.json.bak`, `/tmp/profile-pnpm-lock.yaml.bak`; và `/tmp/skill-desc-backup/` cho 11 description.

**11 skill đã sửa description** (số ký tự cũ → mới): `research` 251→360, `diagnosing-bugs` 169→324, `code-review` 434→434, `frontend-design` 217→356, `webapp-testing` 217→372, `tdd` 162→311, `pdf` 450→343, `docx` 850→417, `xlsx` 965→407, `pptx` 753→354, `skill-creator` 332→392.

Mỗi description giữ nguyên nghĩa tiếng Anh gốc và nối thêm đuôi `Triggers: <từ đời thường tiếng Anh> / <từ tiếng Việt>`. Ví dụ `diagnosing-bugs` kết thúc bằng: `Triggers: bug, error, crash, broken, not working, slow / lỗi, bị lỗi, hỏng, không chạy được, chạy sai, treo, crash, chậm, lag, sai kết quả, sửa giúp, tại sao lỗi.`

**Lý do thêm trigger tiếng Việt:** description chính là thứ model đem so với câu người dùng gõ. Người dùng Việt gõ "hỏng rồi", "chạy chậm quá", "làm slide" — nếu description chỉ có "performance regression", "presentation deck" thì không bao giờ khớp. Đây mới là thứ làm auto-invoke chạy thật.

**22 skill đã được sửa description** qua 2 lượt: lượt 1 gồm `research`, `diagnosing-bugs`, `code-review`, `frontend-design`, `webapp-testing`, `tdd`, `pdf`, `docx`, `xlsx`, `pptx`, `skill-creator`; lượt 2 gồm `code-review`, `diagnosing-bugs`, `tdd`, `pr`, `grilling`, `implement`, `handoff`, `retro`, `teach`, `to-questionnaire`, `improve-codebase-architecture` (5 cái đầu được tinh chỉnh lại lần nữa nên tổng số file khác nhau là 17).

**6 skill đã được bật auto-invoke** (gỡ `disable-model-invocation`): `implement`, `improve-codebase-architecture`, `handoff`, `retro`, `teach`, `to-questionnaire`. Catalog 85 → **91 mục**.

**10 skill vẫn giữ chỉ-gọi-tay**, kèm lý do:

| Skill | Lý do giữ tắt |
|---|---|
| `ask-matt` | Là skill định tuyến (router) — nếu model tự gọi sẽ thay thế skill đúng |
| `wait-what` | Là câu người dùng nói ("nói lại đi") — model tự gọi sẽ vô nghĩa |
| `setup-matt-pocock-skills` | Chạy-một-lần, sửa cấu hình repo — tự gọi sẽ gây tác dụng phụ |
| `to-spec`, `to-tickets`, `triage`, `wayfinder` | **Ghi/xoá issue tracker** — tự gọi sẽ tạo ticket/file mà bạn không yêu cầu |
| `grill-me`, `grill-with-docs` | Trùng với `grilling` (đã bật) — giữ tắt chính là "gộp" |
| `implement-spec` | Trùng với `implement` (vừa bật) |

Không skill nào bị xoá hay đổi tên. Không preset/plugin nào bị thêm hay bớt. Phần **thân (body)** của mọi skill giữ nguyên — chỉ frontmatter `description` và dòng `disable-model-invocation` bị đụng.

---

## 7. Việc tôi KHÔNG làm (và lý do)

- **Không xoá skill trùng chủ đề nào.** 12/27 thành viên của 7 nhóm trùng là skill **do plugin sở hữu** (`writing-plans`, `executing-plans`, `systematic-debugging`, `test-driven-development`, `dev-workflow`, `brainstorming`…) — không nằm trong `~/.dsh/skills` và sẽ bị ghi đè khi plugin cập nhật. Xoá chúng là vô nghĩa. Cách đúng: **phân biệt bằng description** + **giữ tắt bản trùng**, đã làm.
- **Không bật `to-spec`/`to-tickets`/`triage`/`wayfinder`.** Bốn skill này ghi vào issue tracker — bật auto sẽ khiến chúng tự tạo ticket khi bạn chỉ đang bàn.
- **Không sửa phần thân (body) của skill nào** — chỉ `description:` trong frontmatter bị thay.
- **Không đổi preset / không thêm bớt plugin** — ngoài phạm vi yêu cầu.

### 7.1 Gỡ trùng chủ đề — đã xử lý 7/7 nhóm

| Nhóm | Thành viên | Cách xử lý |
|---|---|---|
| Lập kế hoạch | `writing-plans`(plugin), `to-spec`, `to-tickets`, `four-phase-tech-plan`, `four-phase-product-plan` | Giữ tắt `to-spec`/`to-tickets`; 2 skill `four-phase-*` là 2 pha của một quy trình có tên riêng, trigger khác hẳn |
| Triển khai | `implement`, `implement-spec`, `four-phase-implement`, `executing-plans` | Bật `implement` + ghi rõ "chưa có spec thì dùng `writing-plans`/`four-phase-tech-plan`"; giữ tắt `implement-spec` (trùng) |
| Review code | `requesting-code-review`, `receiving-code-review`, `first-principles-review`(plugin), `code-review` | `code-review` ghi rõ **"Not for GitHub PR mechanics — use dev-workflow"** |
| Debug | `systematic-debugging`(plugin), `diagnosing-bugs`, `diagnose-crash`(plugin) | `diagnosing-bugs` ghi rõ **"Not for OS core dumps — use diagnose-crash"** |
| Chất vấn ý tưởng | `brainstorming`(plugin), `grilling`, `grill-me`, `grill-with-docs` | `grilling` ghi **"For open-ended idea generation instead, use brainstorming"**; giữ tắt `grill-me`/`grill-with-docs` |
| TDD | `test-driven-development`(plugin), `tdd` | `tdd` ghi **"This is the default; test-driven-development applies only when a strict TDD route was decided"** |
| Git/PR | `dev-workflow`(plugin), `pr`, `using-git-worktrees`(plugin), `git-guardrails-claude-code`, `finishing-a-development-branch`(plugin) | `pr` ghi rõ **"PR body only — for the wider GitHub flow use dev-workflow"** |

### 7.2 Phép thử định tuyến tiếng Việt — 15/15

Xem Phần 8.

### 7.3 Các việc đã làm trong các lượt này (trước đây ghi là "không làm")

- ✅ **Đã tạo skill `prompt-intake`** — tiếng Việt, đã đăng ký trong catalog.
- ✅ **Đã sửa `description` của 22 skill** (17 file khác nhau) — kèm trigger tiếng Việt.
- ✅ **Đã bật 6 skill** auto-invoke, giữ 10 với lý do rõ ràng.
- ✅ **Đã gỡ trùng 7/7 nhóm** chủ đề.
- ✅ **Đã thêm luật ngôn ngữ vào `~/.dsh/AGENTS.md`** — có hiệu lực ngay trong phiên.
- ✅ **Đã dựng và chạy phép thử định tuyến** — 15/15, hai agent độc lập trùng khớp.

---

## 8. Phép thử định tuyến tiếng Việt (đo được)

**Câu hỏi:** đưa câu tiếng Việt đời thường (có câu không dấu, có câu mơ hồ) vào một agent **mới tinh** chỉ thấy catalog thật, xem nó chọn skill nào.

**Cách làm:** 2 subagent độc lập, không đọc file, không gọi tool, không thấy đáp án kỳ vọng. Một agent nhận câu theo thứ tự, một agent nhận **xáo trộn thứ tự**. Cả hai tự xác nhận catalog có **91 entry**.

**Kết quả: 15/15 đúng ở cả hai agent, không lệch một ô.**

| # | Câu | Đáp án đúng | A | B |
|---|---|---|---|---|
| 1 | cái app này chạy chậm quá, lag kinh | `diagnosing-bugs` | ✓ | ✓ |
| 2 | file excel này cột lộn xộn quá, dọn giúp | `xlsx` | ✓ | ✓ |
| 3 | làm bộ slide thuyết trình về AI | `pptx` | ✓ | ✓ |
| 4 | giao diện nhìn xấu quá, chỉnh cho đẹp hơn | `frontend-design` | ✓ | ✓ |
| 5 | tìm hiểu giúp tôi về MCP server | `research` | ✓ | ✓ |
| 6 | xem lại code giúp, t mới sửa nhiều | `code-review` | ✓ | ✓ |
| 7 | viết test trước rồi mới code | `tdd` | ✓ | ✓ |
| 8 | **k chay roi sua giup** (không dấu) | `diagnosing-bugs` | ✓ | ✓ |
| 9 | lưu lại hết để mai t làm tiếp | `handoff` | ✓ | ✓ |
| 10 | dạy tôi cách dùng git rebase | `teach` | ✓ | ✓ |
| 11 | code này rối quá khó sửa | `improve-codebase-architecture` | ✓ | ✓ |
| 12 | cái đó sửa lại đi (không vật quy chiếu) | `prompt-intake` | ✓ | ✓ |
| 13 | đọc giúp tài liệu PDF này | `pdf` | ✓ | ✓ |
| 14 | chạy thử app xem có lỗi gì | `webapp-testing` | ✓ | ✓ |
| 15 | ừ | *(không skill)* | ✓ | ✓ |

**Ba điểm đáng chú ý — agent A tự nêu, và cả ba đều chứng minh phần gỡ trùng có tác dụng:**

1. #7 chọn `tdd` **chứ không phải** `test-driven-development` — đúng như câu phân biệt mới thêm.
2. #5 suýt chọn `mcp-builder` (xây MCP server) nhưng chốt `research` vì ý định là "tìm hiểu" — description mới có chữ "tìm hiểu".
3. #11 suýt chọn `codebase-design` (thiết kế interface) nhưng chốt `improve-codebase-architecture` vì than phiền là "rối, khó sửa".

**Giới hạn của phép thử (nói thẳng):** đây là test **chọn skill**, không phải test **harness tự gọi skill**. Nó chứng minh: *với catalog thật, model xác định đúng skill từ câu tiếng Việt đời thường* — tức là chất lượng description. Nó **không** chứng minh harness sẽ thực sự bấm còi gọi skill trong lúc trả lời; muốn đo cái đó phải dùng thật rồi xem log.

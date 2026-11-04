# Hướng dẫn cài DeepSeek Harness (dsh) từ con số 0 — theo từng hệ điều hành

> Bản hướng dẫn này tái hiện **đúng chiếc máy đang chạy hôm nay** (10/10/2026):
> Omarchy (Arch), Node 26.8.2 qua mise, `@deepseek-ai/dsh@0.2.0-rc.2`, profile `web`
> với 34 plugin, OmniRoute + headroom làm gateway model, Hindsight/Laya chạy bằng
> systemd user unit, 78 skill, và bộ luật AGENTS.md.
>
> **Đọc thuật ngữ:** *terminal* = cửa sổ gõ lệnh; *repo (git)* = thư mục dự án có lịch
> sử sửa đổi; *plugin* = gói mở rộng cài thêm; *API key* = mật khẩu để gọi dịch vụ AI;
> *daemon/service* = chương trình chạy nền tự động mỗi lần bật máy.

---

## Mục lục

1. [Đường tắt khôi phục 1 chạm (Quick Restore) khi cài lại máy](#đường-tắt-khôi-phục-1-chạm-quick-restore-khi-cài-lại-máy)
2. [Bức tranh tổng thể: cái gì nằm ở đâu](#0-bức-tranh-tổng-thể)
3. [Phase 0 — Chuẩn bị](#phase-0--chuẩn-bị)
4. [Phase 1 — Cài phụ thuộc nền tảng theo OS](#phase-1--cài-phụ-thuộc-nền-tảng-theo-os)
5. [Phase 2 — mise + Node.js + pnpm](#phase-2--mise--nodejs--pnpm)
6. [Phase 3 — Cài dsh và chạy lần đầu](#phase-3--cài-dsh-và-chạy-lần-đầu)
7. [Phase 4 — Cấu hình provider AI (để model trả lời được)](#phase-4--cấu-hình-provider-ai)
8. [Phase 5 — Cài plugins giống máy hiện tại](#phase-5--cài-plugins)
9. [Phase 6 — Skills + AGENTS.md + quy ước workspace](#phase-6--skills--agentsmd--quy-ước-workspace)
10. [Phase 7 — Các service chạy nền (nâng cao)](#phase-7--các-service-chạy-nền-nâng-cao)
11. [Phase 8 — Nghiệm thu: đã "giống như bây giờ" chưa?](#phase-8--nghiệm-thu)
12. [Lỗi kinh điển — dán nguyên văn là có thuốc](#lỗi-kinh-điển)
13. [Phụ lục A — Bảng phiên bản chính xác của máy này](#phụ-lục-a)
14. [Phụ lục B — Danh sách 34 plugin và vai trò](#phụ-lục-b)

---

## Đường tắt khôi phục 1 chạm (Quick Restore) khi cài lại máy

> **Áp dụng cho:** Máy Linux (Ubuntu, Debian, Arch, Omarchy...) hoặc Windows 10/11 (chạy qua **WSL2**).
> Sau khi cài lại máy, bạn không cần phải làm thủ công từng bước 8 phase.
> Toàn bộ 34 plugin, 91 skills, AGENTS.md, cấu hình gateway và test suites đã được đóng gói sẵn trong repo này (`dsh-backup/`).

### Chỉ 3 bước đơn giản:

#### Bước 1: Cài Node.js, pnpm và dsh
- **Trên Linux (Ubuntu/Debian)**:
  ```bash
  sudo apt update && sudo apt install -y git curl build-essential
  curl https://mise.run | sh
  ~/.local/bin/mise use --global node@26.8.2
  npm install -g pnpm @deepseek-ai/dsh@0.2.1-rc.2
  ```
- **Trên Windows 10/11**:
  - Mở PowerShell (Admin), gõ `wsl --install` rồi khởi động lại máy.
  - Mở terminal Ubuntu trong WSL2 và chạy các lệnh Linux như trên.

#### Bước 2: Clone repo workspace và chạy restore script
```bash
# Clone repo về máy (thay dzerok2020 bằng username của bạn nếu cần)
git clone https://github.com/dzerok2020/deepseek-harness-workspace.git ~/Documents/deepseek-harness/default-workspace
cd ~/Documents/deepseek-harness/default-workspace

# Chạy lệnh khôi phục tự động
bash tools/restore-dsh.sh
```

Script này tự động:
1. Tạo thư mục `~/.dsh` và chép luật `AGENTS.md` (Karpathy, Tiếng Việt thô, Cinematic Spatial UI).
2. Khôi phục toàn bộ **91 skills** vào `~/.dsh/skills/`.
3. Khôi phục profile `web` với đầy đủ cấu hình `cordis.patch.yml`, `pnpm-workspace.yaml`.
4. Tự động thích ứng các đường dẫn theo máy mới (`$HOME` và thư mục workspace).
5. Chạy `pnpm install` và liên kết tất cả 12 plugin cục bộ (`dsh-decide`, `dsh-vibe-guard`, `dsh-loop-guard`...).
6. Chạy bộ kiểm tra sức khỏe `bash tools/dsh-health.sh` để nghiệm thu.

#### Bước 3: Cấu hình API Key và khởi động DSH
```bash
# Đặt API key của bạn vào ~/.bashrc (hoặc cấu hình trong Web GUI Settings -> Providers):
export DEEPSEEK_API_KEY="sk-..."
export OR_API_KEY="sk-..."

# Khởi động DeepSeek Harness Web GUI:
dsh web
```
Truy cập trình duyệt: `http://127.0.0.1:3080` là bạn đã có lại 100% môi trường làm việc như hiện tại!

---

---

## 0. Bức tranh tổng thể

DeepSeek Harness (`dsh`) là một **launcher dạng dòng lệnh**: bạn gõ `dsh web`, nó khởi
đ động một GUI web (trình điều khiển agent AI) chạy trên máy của bạn ở cổng 3080.
Kiến trúc 4 tầng:

```
dsh (npm global, lệnh `dsh`)
 └─ Profile: ~/.dsh/profiles/<tên>          ← web / headless / tui...
     ├─ package.json      → danh sách plugin-bundle (các "layer" xếp theo thứ tự)
     ├─ node_modules/     → plugin bên thứ ba (pnpm cài vào đây)
     └─ cordis.patch.yml  → LAYER CẤU HÌNH CỦA BẠN (provider AI, model mặc định...)
 └─ Home: ~/.dsh/
     ├─ AGENTS.md         → luật toàn cục cho mọi phiên
     ├─ skills/           → mỗi skill 1 thư mục có SKILL.md
     ├─ sessions/ logs/   → lịch sử phiên, log
     └─ profiles/web/cordis.patch.yml  → chỗ cấu hình provider
 └─ Model đi đâu?  provider trong patch → API của hãng (hoặc GATEWAY cục bộ)
```

Máy "như bây giờ" chọn đường gateway:

```
dsh web ──provider "or"──▶ headroom :8787 (proxy nén context) ──▶ OmniRoute :20128 (gateway đa upstream) ──▶ api.b.ai / codex / gemini...
```

**Hành trình 8 phase**, mỗi phase có lệnh kiểm chứng riêng (không có bằng chứng thì
không được coi là xong):

| Phase | Việc | Kiểm chứng bằng |
|---|---|---|
| 1 | Git, curl, (Windows: WSL2) | `git --version` |
| 2 | mise → Node 26 + pnpm | `node -v` → v26.x |
| 3 | `npm i -g @deepseek-ai/dsh` | `dsh --version` → 0.2.0-rc.2 |
| 4 | cordis.patch.yml + API key | GUI trả lời được 1 câu |
| 5 | Plugin qua `dsh plugin` | `dsh --profile web --dump-config` |
| 6 | Skills + AGENTS.md | `ls ~/.dsh/skills` |
| 7 | systemd/pm2 services (optional) | `systemctl --user status` |
| 8 | Health script | `bash tools/dsh-health.sh` |

---

## Phase 0 — Chuẩn bị

- Một tài khoản API của hãng model bạn định dùng (DeepSeek, OpenAI, Anthropic,
  OpenRouter, hoặc nhiều nguồn như máy này dùng OmniRoute). API key trả tiền theo
  token — giữ bí mật, **không** paste key vào file nào nằm trong Git.
- Khoảng 2 GB ổ trống (node_modules của plugin khá nặng).
- Biết mở terminal và gõ lệnh. Trên Windows: terminal = PowerShell.

---

## Phase 1 — Cài phụ thuộc nền tảng theo OS

### 1A. Arch Linux / Omarchy / EndeavourOS (máy này là Omarchy)

```bash
sudo pacman -Syu --noconfirm git base-devel curl unzip
```

> Omarchy: mọi thứ trên đã có sẵn; chạy `omarchy update` nếu lâu ngày chưa cập nhật.

### 1B. Ubuntu / Debian / Linux Mint / Pop!_OS

```bash
sudo apt update && sudo apt install -y git curl unzip build-essential ca-certificates
```

### 1C. macOS (Intel hoặc Apple Silicon đều được)

```bash
xcode-select --install                 # bộ công cụ dòng lệnh (có git) — hiện hộp thoại, bấm Install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git
```

### 1D. Windows 10/11 — con đường khuyên dùng: WSL2

DeepSeek Harness chạy tốt nhất trên môi trường kiểu Unix. **Đừng cài native nếu bạn
mới bắt đầu**: các service nền (Phase 7) dùng systemd, mà systemd chỉ có trong WSL2.

```powershell
# PowerShell (Administrator):
wsl --install -d Ubuntu        # bật WSL2 + cài Ubuntu, máy sẽ khởi động lại
```

Sau khi reboot: mở app **Ubuntu**, tạo user + password, rồi cập nhật:

```bash
sudo apt update && sudo apt install -y git curl unzip build-essential
```

Từ bước này, **cứ làm đúng như mục 1B** — mọi lệnh tiếp theo trong guide này chạy
trong terminal Ubuntu/WSL2. File của bạn ở `\\wsl.localhost\Ubuntu\home\<user>\`,
VS Code/GUI mở được từ Windows.

> *Native Windows (không khuyến nghị):* `winget install Git.Git Nodejs.Node`, rồi
> `npm i -g @deepseek-ai/dsh` — dsh web vẫn chạy, nhưng Phase 7 phải thay systemd
> bằng Task Scheduler (xem ghi chú cuối Phase 7) và một số plugin bash-assumption
> có thể lỗi.

**Kiểm chứng:** `git --version` in ra số phiên bản → qua phase.

---

## Phase 2 — mise + Node.js + pnpm

`mise` là "trình quản lý phiên bản": cài Node/pnpm/uv bằng mise để sau này nâng/hạ
phiên bản không đụng hệ điều hành. (Alternatives: nvm trên Linux/macOS — hướng dẫn
này theo mise vì máy hiện tại dùng mise 2026.9.14.)

```bash
# Linux (mọi distro) + macOS:
curl -fsSL https://pixi.sh/install.sh | bash   # hoặc cách chính chủ:
curl https://mise.run | sh

# macOS có thể: brew install mise
```

Bật mise trong shell (thêm dòng cuối vào `~/.bashrc` hoặc `~/.zshrc` — dùng zsh nếu
là macOS/Omarchy mặc định):

```bash
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc    # bash thì thay zsh = bash
exec $SHELL
```

Cài runtime (đúng bản máy này đang chạy):

```bash
mise use -g node@26.8.2
mise use -g pnpm@latest
node -v      # phải in ra v26.8.2
pnpm -v      # 10.x
```

Cài thêm 2 công ty phụ trợ mà máy này có (optional nhưng nên có vì nhiều service sau
dùng chúng):

```bash
mise use -g uv@latest python@latest       # uv: chạy hindsight/headroom/laya
mise use -g gh@latest                      # gh: GitHub CLI để push repo (Phase cuối)
gh auth login                              # đăng nhập tài khoản GitHub (HTTPS + browser)
```

**Kiểm chứng:** `node -v` = v26.8.2, `pnpm -v`, `uv --version`, `gh auth status` báo
`Logged in to github.com account <bạn>`.

---

## Phase 3 — Cài dsh và chạy lần đầu

```bash
npm install -g @deepseek-ai/dsh
dsh --version            # hiện tại là 0.2.0-rc.2
dsh --help               # xem các chế độ: web / headless / tui / plugin ...
```

Tạo workspace (thư mục bạn sẽ làm việc; dsh lấy thư mục hiện hành làm gốc workspace):

```bash
mkdir -p ~/Documents/deepseek-harness/default-workspace
cd ~/Documents/deepseek-harness/default-workspace
dsh web
```

Lần chạy đầu, `dsh` **tự khởi tạo** profile `web` từ template dựng sẵn
(tương đương `--from-default-profile web`): tạo `~/.dsh/profiles/web/` với
`package.json` (danh sách bundle) + `cordis.patch.yml` (layer của bạn).

Mở trình duyệt: **<http://127.0.0.1:3080>** — đây là GUI của dsh (cổng đổi được bằng
`dsh web --port 8080`).

> WSL2: mở đúng URL đó trên trình duyệt Windows (WSL2 tự forward localhost).
> macOS: nếu hiện hộp firewall hỏi "allow incoming connections" cho node → Cho phép
> (nó chỉ bind 127.0.0.1, không lộ ra mạng).

**Kiểm chứng:** GUI tải được, thư mục `~/.dsh/sessions/` + `~/.dsh/profiles/web/` tồn tại.
Chưa cần model — provider cấu hình ở Phase 4.

---

## Phase 4 — Cấu hình provider AI

Toàn bộ cấu hình người dùng nằm trong **`~/.dsh/profiles/web/cordis.patch.yml`** —
một file YAML dạng mảng các "patch entry" nhắm theo id plugin. Cơ chế xếp lớp:
layer của bundle → `cordis.patch.yml` của profile → `~/.dsh/cordis.patch.yml` (toàn
home) → `--patch` trên dòng lệnh. Sửa xong phải **restart `dsh web`** (Ctrl+C, chạy lại).

### 4A. Cách đơn giản nhất (khuyên người mới): nối thẳng 1 API

Ví dụ nối DeepSeek chính chủ (tương tự với OpenAI/Anthropic/OpenRouter — đổi
`baseURL` + `api` cho đúng chuẩn của họ):

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ds:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY      # TÊN BIẾN MÔI TRƯỜNG chứa key (key không nằm trong file này!)
        api: openai-completions          # chuẩn giao tiếp: openai-completions | anthropic-messages
        baseURL: https://api.deepseek.com/v1
        defaultContextWindow: 64000      # kích thước "bộ nhớ" phiên làm việc của model
        defaultMaxTokens: 8192           # độ dài câu trả lời tối đa
        models:
          - id: deepseek-chat
            name: deepseek chat

- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: ds
    model: deepseek-chat
```

Đưa key vào môi trường (thêm vào `~/.zshrc`/`~/.bashrc`, rồi `exec $SHELL`):

```bash
export DEEPSEEK_API_KEY="sk-...key của bạn..."
```

Chạy lại `dsh web`, nhắn "ok" → model trả lời = thành công.

### 4B. Giống máy hiện tại: gateway OmniRoute + headroom (nâng cao)

Máy này **không** nối thẳng từng API, mà đi qua 2 service cục bộ (chi tiết vận hành +
bảo mật + bảng model đã test: xem [`omniroute-setup.md`](./omniroute-setup.md)):

- **OmniRoute** (`npm i -g omniroute` = 3.8.51) — gateway :20128, một đầu mối nhét
  nhiều upstream (codex, api.b.ai, gemini/antigravity, openrouter, ollama...), đọc
  key từ `~/.omniroute/.env`. Chạy: `omniroute serve --no-open --no-recovery`.
- **headroom** (`uv tool install headroom-ai` = 0.39.1) — proxy nén context :8787
  đứng trước OmniRoute. Chạy: `headroom proxy --host 127.0.0.1 --port 8787 --no-ccr`
  (env trong `~/.dsh/.env.headroom-proxy`).

Provider tương ứng trong `cordis.patch.yml` (nguyên văn máy này, model id thuộc về
catalog của gateway nên máy khác sẽ phải thay bằng id của bạn):

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      or:
        displayName: OmniRoute
        apiKeyEnv: OR_API_KEY            # máy này để trống vì relay REQUIRE_API_KEY=false (chỉ bind loopback)
        api: anthropic-messages
        baseURL: http://localhost:8787/v1   # vào headroom, headroom chuyển tiếp sang OmniRoute :20128
        defaultContextWindow: 128000     # ⚠ BẮT BUỘC xem hộp đỏ dưới
        defaultMaxTokens: 16384
        models:
          - id: b-ai/qwen3.8-flash
            name: qwen3.8 flash
```

> 🔴 **Bài học đắt giá (đừng bỏ qua):** relay OmniRoute **từ chối mọi request vượt
> 128000 context token** (HTTP 400 `Input exceeds context window ... limit 128000`).
> Nếu không khai `defaultContextWindow: 128000`, dsh mặc định hiểu là 262144 → bộ
> tự-compaction không bao giờ chạy trước khi đụng tường → phiên chết giữa chừng với
> lỗi 400. Công thức trigger compaction: `min(W×0.8, W − maxTokens − 65536)`.

### 4C. Permission preset (an toàn khi vibe code)

`cordis.patch.yml` của máy này:

```yaml
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:        { sandbox: read-only,        approval: ask }
      workspace-write:  { sandbox: workspace-write,  approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
    defaultPreset: danger-full-access
```

*sandbox* = giới hạn AI được sửa file đâu; *approval* = có hỏi bạn trước khi chạy
lệnh nguy hiểm hay không. Máy này chọn `danger-full-access + never` vì là lab cá nhân
trên máy quen tay — **người mới nên để `workspace-write` + `ask`**, đỡ phải gỡ lỗi vì
AI tự tay xóa thứ không nên xóa.

**Kiểm chứng Phase 4:** `dsh --profile web --dump-config | grep -A3 providers` thấy
provider của bạn; GUI trả lời được một câu hỏi thật.

---

## Phase 5 — Cài plugins

Lệnh quản lý plugin (plugin = gói npm mở rộng tính năng cho dsh; máy này có 34 layer):

```bash
cd <workspace>
dsh plugin --profile web add <tên-package>       # = pnpm add trong ~/.dsh/profiles/web
dsh --profile web --dump-config                  # xem cây cấu hình đã ghép
# Sau khi cài: PHẢI restart dsh web mới nhận (dsh không tự nạp plugin đang chạy)
```

Cài theo nhóm, từ ít tới đủ (danh sách đầy đủ + vai trò: [Phụ lục B](#phụ-lục-b)):

```bash
# Nhóm tìm kiếm web (hữu ích sớm nhất):
dsh plugin --profile web add dsh-free-search @liustack/modsearch

# Nhóm bộ nhớ (mỗi cái 1 không gian nhớ, máy này bật cả 3):
dsh plugin --profile web add stratagate-dsh dsh-mnemon @openviking/dsh-memory-plugin @vectorize-io/hindsight-coding-agents
npm install -g @mnemon-dev/mnemon     # runtime CLI cho dsh-mnemon

# Nhóm UI/tiện ích:
dsh plugin --profile web add dsh-better-sidebar dsh-diff-stat dsh-usage-stats dsh-usage-vendor-stats dshmarket

# Nhóm agent/expert/conductor + skills packs:
dsh plugin --profile web add dsh-agent-conductor @michengai/dsh-agency-agents @wxg-prc-cpg/browser-skill-dsh-plugin @linxin666/dsh-client-ui-skill-explorer @deepseek-ai/dsh-skill-filesystem
dsh plugin --profile web add aegis agent-useful-skills creght-skills dsh-explorer

# Nhóm context/vision:
dsh plugin --profile web add billion-context dsh-context dsh-vision-router
```

**3 plugin cục bộ sống trong repo này** (tự viết, không phải trên marketplace):

```bash
git clone https://github.com/dzerok2020/dsh-decide.git            # tool decide (cần laya, xem Phase 7)
dsh plugin --profile web add file:$PWD            # repo này — cài cả 3:
dsh plugin --profile web add file:$PWD/dsh-loop-guard
dsh plugin --profile web add file:$PWD/dsh-vibe-guard
dsh plugin --profile web add file:$PWD/dsh-decide
bash tools/sync-local-plugins.sh                  # đồng bộ symlink + phát hiện drift
```

> ⚠ **Lỗi đã biết:** `market_install` (tool GUI) từng fail với
> `session "[object Object]" has no live agent` → bỏ qua tool, **cài bằng lệnh
> `dsh plugin` trong terminal như trên** (hoặc `cd ~/.dsh/profiles/web && pnpm add <pkg>`).
> Lưu ý `dsh-vibe-guard` là plugin *chống AI nói dối "xong"* — nó sẽ chặn commit/push
> nguy hiểm, đó là tính năng không phải lỗi; và `dsh-loop-guard` chữa lỗi AI lặp câu
> "Chờ bạn nhé" (xem `dsh-loop-guard/README.md`, tắt tạm bằng env `DSH_LOOP_GUARD=off`).

**Kiểm chứng:** `ls ~/.dsh/profiles/web/node_modules` có các gói trên; mở GUI thấy
tool mới (search/memory...) trong danh sách tool của agent.

---

## Phase 6 — Skills + AGENTS.md + quy ước workspace

**Skill** = hướng dẫn tác vụ đặt trong `~/.dsh/skills/<tên>/SKILL.md`; agent tự đọc
khi yêu cầu khớp mô tả. Máy này có 78 skill (một số do plugin như `creght-skills`,
`agent-useful-skills` cung cấp, phần còn lại là thư mục tự sao chép vào `~/.dsh/skills/`
từ kho skill cá nhân). Cách thêm 1 skill: tạo thư mục, đặt file `SKILL.md`
(frontmatter `name` + `description` rồi nội dung từng bước), restart dsh.

**AGENTS.md 2 tầng:**

```bash
mkdir -p ~/.dsh
nano ~/.dsh/AGENTS.md      # Luật TOÀN CỤC mọi phiên (máy này: Karpathy guidelines +
                           # quy tắc hiểu tiếng Việt không dấu + chuẩn UI premium)
```

Workspace này đã có sẵn `AGENTS.md` cấp dự án (quy trình 5 bước vibe code, luật Git,
Definition of Done, `tools/dsh-health.sh` kiểm tra sức khoẻ hệ thống bằng 1 lệnh).
Project mới thì tạo tự động:

```bash
bash tools/new-project.sh ~/Documents/du-an-moi
```

**Kiểm chứng:** `ls ~/.dsh/skills | wc -l`; nói "hello" trong GUI và thấy agent mở
đầu câu trả lời bằng "Bước X —" (dấu hiệu AGENTS.md được nạp).

---

## Phase 7 — Các service chạy nền (nâng cao)

Máy này có **5 systemd user unit**; nguồn gốc uy tín của unit nằm ngay trong repo:
[`systemd/`](../systemd/) và `~/.config/systemd/user/*` chỉ là **symlink** trỏ về đó.

| Unit | Việc | Cổng |
|---|---|---|
| `omniroute.service` | gateway AI đa upstream | 127.0.0.1:20128 |
| `headroom-proxy.service` | proxy nén context trước gateway | 127.0.0.1:8787 |
| `hindsight-daemon.service` | daemon bộ nhớ Hindsight (`uvx hindsight-api@0.10.3`) | 127.0.0.1:9077 |
| `hindsight-control-plane.service` | UI duyệt bộ nhớ Hindsight | 127.0.0.1:9999 |
| `laya-serve.service` | server Laya cho tool `decide` | 127.0.0.1:8000 |

### 7A. Linux (systemd) — Arch/Ubuntu/WSL2-UBUNTU đều dùng được

```bash
# Bật để service tự chạy cả khi chưa đăng nhập (rất quan trọng cho VPS/WSL):
sudo loginctl enable-linger $USER

# Copy unit vào user systemd bằng symlink, sửa đường dẫn ~/.local/share/mise/... 
# theo đúng máy của bạn, rồi:
for u in omniroute headroom-proxy hindsight-daemon hindsight-control-plane laya-serve; do
  ln -s "$PWD/systemd/$u.service" ~/.config/systemd/user/$u.service 2>/dev/null || true
done
systemctl --user daemon-reload
systemctl --user enable --now hindsight-daemon   # chỉ bật những cái bạn đã cài phần nền
```

Bộ cài phần nền tương ứng (tóm tắt — mỗi mục đã kiểm chứng trên máy này):

- **OmniRoute**: `npm i -g omniroute`; cấu hình `~/.omniroute/.env` (47 dòng env: PORT/HOST/các key upstream; bind `127.0.0.1`).
- **headroom**: `uv tool install headroom-ai`; env `~/.dsh/.env.headroom-proxy` (không có trong repo — tự tạo: `HEADROOM_MODE=cache`).
- **Hindsight**: `mise use -g uv`; daemon chạy bằng `uvx hindsight-api@0.10.3 --idle-timeout 0 --port 9077`; cấu hình `~/.hindsight/coding-agent.json` + env `~/.hindsight/profiles/coding-agent.env` (LLM trỏ `BASE_URL=http://localhost:20128/v1`, `HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU=true` vì không có GPU); CLI `hindsight` (binary của Vectorize) đặt ở `~/.local/bin`. **Sau khi đổi config Hindsight phải restart `dsh web`** (plugin cache client theo harness+directory).
- **Laya**: `uv venv .laya-venv && uv pip install --python .laya-venv laya torch --index-strategy ...` (máy này: laya 0.3.26 + torch 2.14.1 **cpu** + transformers); model `convaiinnovations/laya` cache từ HuggingFace; `~/.dsh/decide.json` = `{"layaUrl": "http://127.0.0.1:8000"}`.

### 7B. macOS — không có systemd

Thay bằng **launchd** (chính chủ macOS) hoặc gọn hơn: dùng [**pm2**](https://pm2.keymetrics.io/):

```bash
brew install pm2
pm2 start "omniroute serve --no-open --no-recovery" --name omniroute
pm2 start "headroom proxy --host 127.0.0.1 --port 8787 --no-ccr" --name headroom
pm2 save && pm2 startup    # tự bật lại khi đăng nhập
```

(Plugin `dsh-mnemon`/`stratagate-dsh` không cần service riêng; Hindsight/Laya là
optional — bỏ qua nếu bạn chưa cần.)

### 7C. Windows native — Task Scheduler

`Task Scheduler → Create Task → At log on → Run a shell/PowerShell script khởi chạy
từng service`. Thực tế: **dùng WSL2 (mục 1D) rồi làm theo 7A**, đỡ đau khổ hơn nhiều.

**Kiểm chứng:** `systemctl --user status omniroute` → `active (running)`;
`curl -s http://127.0.0.1:20128/v1/models | head -c 100` trả về JSON.

---

## Phase 8 — Nghiệm thu

Chạy đúng 8 lệnh sau, tất cả xanh là bạn đã "như bây giờ":

```bash
node -v && npm -v && git --version && uv --version    # v26.8.2 / 11.x / 2.x / 0.12.x
dsh --version                                         # 0.2.0-rc.2
ls ~/.dsh/profiles/web/cordis.patch.yml               # tồn tại
grep -c "defaultContextWindow: 128000" ~/.dsh/profiles/web/cordis.patch.yml  # = 1 (nếu dùng or)
ls ~/.dsh/profiles/web/node_modules | wc -l           # ~ 34+ plugin
ls ~/.dsh/skills | wc -l                              # ~ 78 (tuần tự tăng dần cũng OK)
systemctl --user is-active omniroute headroom-proxy   # active (Phase 7)
bash tools/dsh-health.sh                              # ĐẠT cho từng mục
```

Rồi test cuối trong GUI: hỏi agent "liệt kê tool của bạn" → thấy `web_search`,
`memory_*`, `mnemon_*`, `decide`... xuất hiện = plugin đã nạp đúng.

---

## Lỗi kinh điển

| Triệu chứng (nguyên văn) | Nguyên nhân | Thuốc |
|---|---|---|
| `HTTP 400 "Input exceeds context window ... limit 128000"` / `context_length_exceeded` | Relay OmniRoute chặn >128k nhưng dsh tưởng 262k nên không compaction | Khai `defaultContextWindow: 128000` trên route `or`, restart dsh (đã giải thích Phase 4B) |
| Plugin tool gọi xong trả 401, hoặc config plugin đổi mà không nhận | `dist/dsh.js` có module-level `workspaces` Map cache — đổi gì cũng phải **restart tiến trình dsh** | `Ctrl+C` `dsh web`, chạy lại |
| `market_install`/`market_uninstall` fail `session "[object Object]" has no live agent` | Tool GUI thiếu job owner trong session này | Cài/xóa bằng `dsh plugin --profile web add/remove ...` trong terminal |
| AI lặp "Chưa có yêu cầu mới / Chờ bạn nhé" nhiều lần 1 turn | Lỗi loop đã biết | `cat ~/.dsh/loop-guard-status.json`; tạm tắt: env `DSH_LOOP_GUARD=off` + restart |
| `conductor_dispatch` chết im lặng sau 10 phút | Timeout cứng 10' của plugin, mất kết quả | Task dài chạy nền + báo PID ngay, đừng dispatch việc lâu |
| `b-ai/jev-latest` lỗi 400 `requires /v1/decisions` | OmniRoute chỉ forward chat, không forward endpoint decisions của b.ai | Dùng đường khác (`openrouter/typesafe/jev-router`...) hoặc gọi thẳng `https://api.b.ai/v1/decisions` |
| `agy/gemini-3.8-flash-medium` không có | id không tồn tại trong catalog live | Dùng `antigravity/gemini-3.8-flash-tiered` (đã test 200 OK) |
| `wrangler pages deploy` (dự án khác) xóa env vars | GHI ĐÈ `deployment_configs` bằng `[vars]` trong wrangler.toml | Khai biến ở MỘT nơi duy nhất (wrangler.toml); tên binding trùng nhau thì deploy lỗi ngay |

---

## Phụ lục A

Phiên bản chính xác trên máy "như bây giờ" (Omarchy, x86_64, không GPU):

| Thành phần | Phiên bản | Cách cài |
|---|---|---|
| Node.js | v26.8.2 | `mise use -g node@26.8.2` |
| npm | 11.19.1 | theo Node |
| pnpm | 10.34.6 | `mise use -g pnpm` |
| mise | 2026.9.14 | script `curl https://mise.run` |
| uv / uvx | 0.12.23 | `mise use -g uv` |
| @deepseek-ai/dsh | 0.2.0-rc.2 | `npm i -g @deepseek-ai/dsh` |
| omniroute | 3.8.51 | `npm i -g omniroute` |
| headroom-ai | 0.39.1 | `uv tool install headroom-ai` |
| hindsight-api | 0.10.3 | `uvx hindsight-api@0.10.3` (daemon) |
| @mnemon-dev/mnemon | 0.2.10 | `npm i -g @mnemon-dev/mnemon` |
| laya (+torch cpu, transformers) | 0.3.26 / 2.14.1+cpu / 5.18.0 | `.laya-venv` (uv venv) |
| gh CLI | 2.102.0 | `mise use -g gh` |

## Phụ lục B

34 layer trong `~/.dsh/profiles/web/package.json` (`dsh.profile.bundles`), theo nhóm:

- **Nền của dsh:** `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`,
  `dsh-experimental-agent-team-profile` (agent teams), `dsh-experimental-auto-review`,
  `dsh-experimental-schedule-bundle` (nhắc việc), `dsh-experimental-voice-input-bundle`.
- **Tìm kiếm/web:** `dsh-free-search` (multi-engine), `@liustack/modsearch` (cầu
  fetch/x_search), `dshmarket` (chợ plugin), `@1e0zj/dsh-plugin-mall`.
- **Bộ nhớ:** `stratagate-dsh` (evidence-gated memory), `dsh-mnemon` (+CLI `@mnemon-dev/mnemon`,
  hot memory USER.md/MEMORY.md), `@openviking/dsh-memory-plugin` (OpenViking),
  `@vectorize-io/hindsight-coding-agents` (knowledge pages + 🧠), `@furongjun1999/dsh-memory`,
  `dsh-context`.
- **Agent tăng cường:** `dsh-agent-conductor` (dispatch sang CLI khác),
  `@michengai/dsh-agency-agents` (bảng chuyên gia), `aegis` (method-pack),
  `dsh-guardian`, `dsh-decide` (tool decide → Laya).
- **Skills:** `@deepseek-ai/dsh-skill-filesystem`, `agent-useful-skills`,
  `creght-skills`, `@linxin666/dsh-client-ui-skill-explorer`, `dsh-explorer`.
- **Context/vision/media:** `billion-context` (sidecar cổng 18797),
  `dsh-vision-router` (định tuyến model ảnh), `@wxg-prc-cpg/browser-skill-dsh-plugin`.
- **UI/thống kê:** `dsh-better-sidebar`, `dsh-diff-stat`, `@ychris12138/dsh-usage-stats`,
  `dsh-usage-vendor-stats`.
- **Tự viết (repo này):** `dsh-loop-guard` (chống loop), `dsh-vibe-guard` (cổng
  "không có bằng chứng không có xong" + chặn git nguy hiểm).

---

*Hướng dẫn viết 2026-10-10, đối chiếu nguyên văn máy dzerok (Omarchy). Có gì sai với
máy của bạn → paste nguyên văn lỗi vào GUI và báo maintainer của repo này.*

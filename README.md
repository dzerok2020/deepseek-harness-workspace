# DeepSeek Harness Workspace & One-Click Restore Suite

> **Kho lưu trữ Workspace và Bộ công cụ khôi phục 1 chạm (Quick Restore) cho DeepSeek Harness (`dsh`)**.  
> Hỗ trợ cài đặt và khôi phục hoạt động 100% trên cả **Windows 11 thật (Native PowerShell - Không cần WSL2)** lẫn **Linux / WSL2 / macOS**.

---

## 📌 Tổng quan

Repository này là môi trường làm việc chuẩn (default workspace) và bộ sao lưu hoàn chỉnh của **DeepSeek Harness** — nền tảng AI Agentic Coding mạnh mẽ.

Toàn bộ hệ sinh thái đã được tinh chỉnh, kiểm thử và đóng gói sẵn trong repo:
- **34 plugin** cấu hình sẵn trong profile `web`, bao gồm các plugin cốt lõi do chính workspace phát triển:
  - `dsh-loop-guard`: Chống lặp vô hạn và kẹt session khi AI gọi tool.
  - `dsh-vibe-guard`: Bảo vệ an toàn mã nguồn, ngăn chặn các lệnh Git nguy hiểm (`git push --force`, `git reset --hard`) và ép buộc kỷ luật *Definition of Done* (phải có bằng chứng thật mới được báo "xong").
  - `dsh-decide`: Công cụ phân loại siêu tốc (System-1 decision) tối ưu token.
  - `dsh-cost-gate`: Giám sát và kiểm soát ngân sách tiêu thụ token.
- **91 User Skills** độc lập (đã làm phẳng toàn bộ symlink, tương thích đa nền tảng): UI/UX Pro Max, Animation GSAP, ThreeUI, Full Output Enforcement, Testing, Systematic Debugging, Karpathy Guidelines...
- **Luật toàn cục `AGENTS.md`**: Tích hợp hướng dẫn Karpathy, cơ chế nhận diện tiếng Việt thô (không bắt lỗi chính tả), và tiêu chuẩn thiết kế Cinematic Spatial UI.
- **259 bài kiểm thử tự động (Unit & Regression Tests)**: Bảo đảm 100% tính ổn định khi chạy lại hệ thống.

---

## 🚀 Khôi phục 1 chạm (Quick Restore) khi cài lại máy

Chọn một trong 2 cách bên dưới tùy thuộc vào hệ điều hành của bạn.

---

### Cách 1: Chạy trực tiếp trên Windows 11 thật (Native PowerShell - KHÔNG cần WSL2)

Không cần cài đặt máy ảo hay bật tính năng WSL2, DSH chạy trực tiếp trên Windows 11 thông qua Node.js và PowerShell.

#### Bước 1: Cài đặt công cụ nền tảng bằng winget
Mở **PowerShell** (hoặc Windows Terminal) với quyền thông thường và chạy:

```powershell
# Cài đặt Git, Node.js LTS và Python 3.12 qua winget
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
```

> 💡 **Lưu ý:** Sau khi cài xong, hãy **tắt và mở lại PowerShell** để Windows cập nhật biến môi trường `PATH`.

Tiếp theo, cài đặt `pnpm` và công cụ dòng lệnh `dsh`:
```powershell
npm install -g pnpm @deepseek-ai/dsh@0.2.1-rc.2
```

#### Bước 2: Clone workspace và chạy script khôi phục
```powershell
# Chuyển tới thư mục Documents và clone repo
cd $env:USERPROFILE\Documents
git clone https://github.com/dzerok2020/deepseek-harness-workspace.git
cd deepseek-harness-workspace

# Chạy script khôi phục tự động cho Windows:
powershell -ExecutionPolicy Bypass -File tools\restore-dsh.ps1
```

**Script `restore-dsh.ps1` tự động thực hiện:**
1. Khởi tạo thư mục `$env:USERPROFILE\.dsh` (tương ứng `C:\Users\<Tên_Bạn>\.dsh`).
2. Khôi phục file luật toàn cục `AGENTS.md` và file cấu hình mẫu `decide.json`.
3. Khôi phục toàn bộ **91 skills** vào `$env:USERPROFILE\.dsh\skills\`.
4. Tự động chuyển đổi các đường dẫn trong `package.json` và `cordis.patch.yml` sang chuẩn Windows (`C:/...`).
5. Chạy `pnpm install` và tạo **NTFS Junctions** kết nối các plugin cục bộ (`mklink /J` — không yêu cầu Administrator hay Developer Mode).

#### Bước 3: Cấu hình API Key và khởi chạy Web GUI
```powershell
# Đặt API Key trong PowerShell (hoặc có thể nhập trực tiếp trên Web GUI Settings -> Providers):
$env:DEEPSEEK_API_KEY = "sk-..."
$env:OR_API_KEY = "sk-..."

# Khởi chạy DeepSeek Harness Web GUI:
dsh web
```
Mở trình duyệt truy cập: **`http://127.0.0.1:3080`**.

---

### Cách 2: Chạy trên Linux (Ubuntu / Debian / Arch / Omarchy) hoặc qua WSL2

#### Bước 1: Cài đặt Node.js, pnpm và dsh
Mở Terminal và chạy:
```bash
# Cập nhật và cài các gói cơ bản
sudo apt update && sudo apt install -y git curl build-essential

# Cài Node.js (khuyên dùng mise hoặc nvm, Node >= 20 hoặc 26.8.2)
curl https://mise.run | sh
~/.local/bin/mise use --global node@26.8.2

# Cài đặt pnpm và dsh CLI
npm install -g pnpm @deepseek-ai/dsh@0.2.1-rc.2
```

#### Bước 2: Clone workspace và chạy script khôi phục
```bash
# Clone repo về máy
git clone https://github.com/dzerok2020/deepseek-harness-workspace.git ~/Documents/deepseek-harness/default-workspace
cd ~/Documents/deepseek-harness/default-workspace

# Chạy script khôi phục tự động
bash tools/restore-dsh.sh
```

#### Bước 3: Cấu hình API Key và khởi chạy
```bash
# Thêm key vào ~/.bashrc hoặc export tạm thời:
export DEEPSEEK_API_KEY="sk-..."
export OR_API_KEY="sk-..."

# Khởi chạy DeepSeek Harness Web GUI:
dsh web
```
Truy cập trình duyệt: **`http://127.0.0.1:3080`**.

---

## 🧩 Cấu trúc hệ thống & Thành phần chính

### 1. Kiến trúc 4 tầng của DSH
```
dsh (npm global CLI)
 └─ Profile: ~/.dsh/profiles/web/ (hoặc %USERPROFILE%\.dsh\profiles\web)
     ├─ package.json        → Khai báo 34 bundle layer plugin và plugin cục bộ
     ├─ node_modules/       → Thư viện pnpm và junction/symlink plugin
     └─ cordis.patch.yml    → Layer cấu hình người dùng (providers, model budgets, presets)
 └─ DSH Home: ~/.dsh/
     ├─ AGENTS.md           → Luật toàn cục (áp dụng cho mọi dự án và mọi session)
     ├─ skills/             → Thư mục chứa 91 skills hỗ trợ AI
     └─ decide.json         → Cấu hình bộ phân loại System-1
 └─ Workspace: default-workspace/
     ├─ AGENTS.md           → Hợp đồng vibe code cấp workspace
     ├─ dsh-backup/         → Bản lưu trữ cấu hình sạch để khôi phục
     ├─ tools/              → Bộ script khôi phục, kiểm tra sức khỏe và đồng bộ
     └─ test/               → Bộ kiểm thử tự động 259 test cases
```

### 2. Các Plugin cục bộ phát triển riêng trong Workspace

| Tên Plugin | Đường dẫn | Chức năng chính |
|---|---|---|
| **`dsh-loop-guard`** | `./dsh-loop-guard` | Giám sát và phát hiện vòng lặp vô hạn (chống lặp câu trả lời, lặp tool call rỗng). Tự động ngắt và bảo toàn context. |
| **`dsh-vibe-guard`** | `./dsh-vibe-guard` | Cổng bảo vệ kỷ luật lập trình: chặn `git push --force`, `git reset --hard`, ép buộc kiểm chứng trước khi báo "xong". |
| **`dsh-decide`** | `./dsh-decide` | Tích hợp công cụ `decide` (System-1) đưa ra lựa chọn dạng nhị phân/thang điểm với chi phí token tối thiểu. |
| **`dsh-cost-gate`** | `./dsh-cost-gate` | Kiểm soát ngân sách tiêu thụ token, bảo vệ chống vượt hạn mức chi phí LLM. |
| **`dsh-tool-name-normalize`** | `./dsh-tool-name-normalize` | Chuẩn hóa tên tool gọi từ các mô hình khác nhau về đúng chuẩn schema DSH. |

---

## 🛠️ Bộ công cụ vận hành & Kiểm tra sức khỏe (Health Check)

Workspace tích hợp sẵn các công cụ tự động để bảo đảm hệ thống luôn hoạt động chuẩn xác:

### 1. Kiểm tra sức khỏe toàn hệ thống
```bash
# Chạy script chẩn đoán tự động (kiểm tra profile, bundle, skills, loop-guard, git)
bash tools/dsh-health.sh
```

### 2. Chạy toàn bộ 259 Unit & Regression Tests
```bash
node --test test/
```
Tất cả các bài test phải chuyển màu xanh (`pass 259, fail 0`).

### 3. Đồng bộ ngân sách Model & Providers
Khi bạn thêm model mới trong Web GUI Settings, chạy script để cập nhật test catalog:
```bash
python3 tools/sync_model_budgets.py --expect tools/web-model-budgets.yml --apply
```

---

## 📜 Kỷ luật làm việc (Dành cho Cả Người & AI)

Mọi phiên AI chạy trong workspace này đều tuân thủ 2 văn bản quy ước:

1. **`~/.dsh/AGENTS.md` (Luật toàn cục)**:
   - **4 nguyên tắc Karpathy**: *Think Before Coding* (hiểu rõ giả định), *Simplicity First* (đơn giản tối đa, không phỏng đoán tính năng), *Surgical Changes* (chỉ sửa đúng chỗ cần sửa, không đổi code lân cận), *Goal-Driven Execution* (có tiêu chí kiểm chứng, lặp lại cho tới khi test pass).
   - **Ngôn ngữ & Prompt Intake**: Hiểu tiếng Việt thô, viết tắt, không dấu (`k`, `ko`, `dc`, `lm`, `ntn`, `hong`...), không bao giờ bắt bẻ chính tả.
   - **Cinematic Spatial UI**: Mọi giao diện web tạo mới đều phải đạt chất lượng cao, có chiều sâu, micro-interactions và chuyển động có chủ đích ngay từ vòng đầu tiên.

2. **`./AGENTS.md` (Hợp đồng Workspace)**:
   - **Definition of Done**: Bắt buộc phải có bằng chứng kiểm thử thật (lệnh chạy thật, kết quả test pass/fail, ảnh chụp màn hình). Không chấp nhận báo "xong" bằng lời nói suông.
   - **Kỷ luật Git**: Một thay đổi logic = một commit; không commit file rác hoặc secrets.

---

## 📁 Cấu trúc thư mục Workspace

```
.
├── AGENTS.md                              # Hợp đồng vibe code cấp workspace
├── README.md                              # Tài liệu hướng dẫn chính (file này)
├── dsh-backup/                            # Bản backup cấu hình sạch chuẩn hóa
│   ├── AGENTS.md                          # Backup luật toàn cục
│   ├── decide.json                        # Backup cấu hình decide
│   ├── .credentials.yaml.example          # Mẫu cấu hình bảo mật
│   ├── profiles/web/                      # Backup cấu hình profile web (package.json, cordis.patch.yml)
│   └── skills/                            # Đầy đủ 91 skills đã làm phẳng
├── dsh-loop-guard/                        # Mã nguồn plugin chống lặp vô hạn
├── dsh-vibe-guard/                        # Mã nguồn plugin cổng an toàn vibe coding
├── dsh-decide/                            # Mã nguồn plugin phân loại System-1
├── dsh-cost-gate/                         # Mã nguồn plugin quản lý chi phí token
├── docs/                                  # Tài liệu chi tiết các giải pháp kỹ thuật
│   ├── huong-dan-cai-dat-deepseek-harness-tu-so.md  # Cẩm nang cài đặt chi tiết từ số 0
│   ├── vibe-rails.md                      # Bảng phân loại ray chạy và ngân sách token
│   └── vibe-code-cho-nguoi-moi.md         # Hướng dẫn vibe coding cho người mới bắt đầu
├── test/                                  # 259 bài kiểm thử hồi quy tự động
└── tools/                                 # Bộ script tự động hóa
    ├── restore-dsh.ps1                    # Script khôi phục 1 chạm trên Windows 11 Native
    ├── restore-dsh.sh                     # Script khôi phục 1 chạm trên Linux / WSL2
    ├── adapt-restore-config.mjs           # Bộ chuyển đổi đường dẫn cấu hình đa nền tảng
    └── dsh-health.sh                      # Script kiểm tra sức khỏe hệ thống
```

---

## 📄 Bản quyền & Đóng góp

- Repository này thuộc về **@dzerok2020**.
- Cốt lõi DeepSeek Harness phát triển bởi nhóm **DeepSeek-AI**.
- Tự do sử dụng, chỉnh sửa và cấu hình lại cho nhu cầu cá nhân. Khi đóng góp ý kiến hoặc phát hiện lỗi, hãy tạo Issue hoặc Pull Request trên GitHub.

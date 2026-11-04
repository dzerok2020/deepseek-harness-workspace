# tools/restore-dsh.ps1
# Khôi phục toàn bộ cấu hình, 34 plugin, 91 skills, AGENTS.md trên Windows 11 thật (Native PowerShell)
# Chạy trực tiếp trong PowerShell (Terminal Windows), KHÔNG CẦN WSL2!

param (
    [string]$DshHome = "$env:USERPROFILE\.dsh"
)

$ErrorActionPreference = "Stop"

function Write-Green($text)  { Write-Host $text -ForegroundColor Green }
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   KHÔI PHỤC DEEPSEEK HARNESS (DSH) TRÊN WINDOWS 11 THẬT (POWERSHELL)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$Workspace = (Get-Item $PSScriptRoot).Parent.FullName
$BackupDir = Join-Path $Workspace "dsh-backup"

Write-Host "Workspace Root : $Workspace"
Write-Host "DSH Home Dir   : $DshHome"
Write-Host ""

# 1. Kiểm tra công cụ cần thiết trên Windows
Write-Host ">>> [1/7] Kiểm tra công cụ trên Windows (Git, Node.js, pnpm)..." -ForegroundColor Yellow
$missing = @()
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $missing += "git" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += "node (Node.js)" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { $missing += "pnpm" }

if ($missing.Count -gt 0) {
    Write-Host "LỖI: Thiếu các công cụ sau trên Windows: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Bạn có thể cài nhanh bằng winget trong PowerShell:" -ForegroundColor Yellow
    Write-Host "   winget install Git.Git"
    Write-Host "   winget install OpenJS.NodeJS.LTS"
    Write-Host "Sau đó mở lại PowerShell và chạy: npm install -g pnpm"
    exit 1
}

$nodeVer = node -v
$pnpmVer = pnpm -v
$gitVer = git --version
Write-Green "  ✓ $nodeVer | pnpm: $pnpmVer | $gitVer"

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    Write-Host "  ⚠ Chưa tìm thấy lệnh 'dsh'. Đang cài đặt @deepseek-ai/dsh@0.2.1-rc.2..." -ForegroundColor Yellow
    npm install -g @deepseek-ai/dsh@0.2.1-rc.2
}
Write-Green "  ✓ dsh CLI đã sẵn sàng"

# 2. Tạo thư mục cấu trúc ~/.dsh
Write-Host ">>> [2/7] Khởi tạo thư mục $DshHome..." -ForegroundColor Yellow
$ProfileWeb = Join-Path $DshHome "profiles\web"
$SkillsDir = Join-Path $DshHome "skills"

New-Item -ItemType Directory -Force -Path $DshHome, $ProfileWeb, $SkillsDir | Out-Null
Write-Green "  ✓ Đã chuẩn bị cấu trúc thư mục DSH"

# 3. Khôi phục global AGENTS.md & decide.json
Write-Host ">>> [3/7] Khôi phục AGENTS.md toàn cục & cấu hình..." -ForegroundColor Yellow
Copy-Item (Join-Path $BackupDir "AGENTS.md") (Join-Path $DshHome "AGENTS.md") -Force
Write-Green "  ✓ Đã chép AGENTS.md (Luật Karpathy, tiếng Việt thô, Cinematic Spatial UI)"

$decideDst = Join-Path $DshHome "decide.json"
if (-not (Test-Path $decideDst)) {
    Copy-Item (Join-Path $BackupDir "decide.json") $decideDst -Force
    Write-Green "  ✓ Đã tạo decide.json (mẫu)"
}

$credsDst = Join-Path $DshHome ".credentials.yaml.example"
if (-not (Test-Path $credsDst)) {
    Copy-Item (Join-Path $BackupDir ".credentials.yaml.example") $credsDst -Force
    Write-Green "  ✓ Đã đặt file mẫu .credentials.yaml.example"
}

# 4. Khôi phục toàn bộ 91 User Skills
Write-Host ">>> [4/7] Khôi phục 91 skills vào $SkillsDir..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $BackupDir "skills\*") -Destination $SkillsDir -Recurse -Force
$skillCount = (Get-ChildItem -Directory $SkillsDir).Count
Write-Green "  ✓ Đã khôi phục $skillCount skills vào $SkillsDir"

# 5. Khôi phục cấu hình profile web và điều chỉnh đường dẫn theo Windows
Write-Host ">>> [5/7] Điều chỉnh cấu hình profile web theo đường dẫn Windows..." -ForegroundColor Yellow
Copy-Item (Join-Path $BackupDir "profiles\web\pnpm-workspace.yaml") (Join-Path $ProfileWeb "pnpm-workspace.yaml") -Force
if (Test-Path (Join-Path $BackupDir "profiles\web\pnpm-lock.yaml")) {
    Copy-Item (Join-Path $BackupDir "profiles\web\pnpm-lock.yaml") (Join-Path $ProfileWeb "pnpm-lock.yaml") -Force
}

$adaptScript = Join-Path $Workspace "tools\adapt-restore-config.mjs"
node "$adaptScript" "$Workspace" "$DshHome" "$BackupDir" "$ProfileWeb"
Write-Green "  ✓ Đã đồng bộ package.json & cordis.patch.yml cho Windows"

# 6. Chạy pnpm install và tạo Junction cho plugin cục bộ
Write-Host ">>> [6/7] Cài đặt dependencies (pnpm install) và tạo liên kết plugin cục bộ..." -ForegroundColor Yellow
Push-Location $ProfileWeb
try {
    pnpm install --no-frozen-lockfile
} finally {
    Pop-Location
}
Write-Green "  ✓ pnpm install hoàn tất"

# Tạo Junction trên Windows cho các plugin cục bộ (Junction không cần quyền Admin)
$nodeModulesDir = Join-Path $ProfileWeb "node_modules"
$localPlugins = @("dsh-decide", "dsh-vibe-guard", "dsh-loop-guard", "dsh-tool-name-normalize")

foreach ($p in $localPlugins) {
    $srcDir = Join-Path $Workspace $p
    $dstDir = Join-Path $nodeModulesDir $p

    if (Test-Path $srcDir) {
        if (Test-Path $dstDir) {
            # Xóa thư mục cũ hoặc junction cũ
            cmd /c "rmdir /s /q `"$dstDir`"" 2>$null
        }
        # Tạo NTFS Junction (mklink /J hoạt động tốt không cần Admin)
        cmd /c "mklink /J `"$dstDir`" `"$srcDir`"" | Out-Null
        Write-Green "  ✓ Đã liên kết plugin cục bộ (Junction): $p"
    }
}

# 7. Nghiệm thu hoàn tất
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Green "   KHÔI PHỤC HOÀN TẤT 100% TRÊN WINDOWS 11 NATIVE!"
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "CÁC BƯỚC ĐỂ BẮT ĐẦU DÙNG:" -ForegroundColor Cyan
Write-Host "1. Thiết lập API Key trong PowerShell (hoặc nhập vào Web GUI Settings -> Providers):"
Write-Host '   $env:DEEPSEEK_API_KEY = "sk-..."'
Write-Host '   $env:OR_API_KEY = "sk-..."'
Write-Host ""
Write-Host "2. Khởi chạy DeepSeek Harness Web GUI:"
Write-Host "   dsh web" -ForegroundColor Green
Write-Host ""
Write-Host "3. Mở trình duyệt truy cập: http://127.0.0.1:3080" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan

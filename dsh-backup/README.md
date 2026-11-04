# Thư mục lưu trữ cấu hình DSH (dsh-backup)

Thư mục này chứa toàn bộ cấu hình, cài đặt profile, danh sách plugin và 91 skills của DeepSeek Harness.
Khi cài lại máy trên Linux hoặc Windows (WSL2), chỉ cần chạy 1 lệnh duy nhất:

```bash
bash tools/restore-dsh.sh
```

## Cấu trúc thư mục:
- `AGENTS.md`: Chỉ dẫn toàn cục (Luật Karpathy, hiểu tiếng Việt thô, chuẩn Cinematic Spatial UI).
- `decide.json`: Cấu hình cho công cụ `decide` (Jev / Laya).
- `.credentials.yaml.example`: File mẫu hướng dẫn đặt API keys.
- `profiles/web/`:
  - `package.json`: Danh sách 34 plugin của profile `web`.
  - `pnpm-workspace.yaml`: Cấu hình nodeLinker hoisted và version overrides chống xung đột.
  - `pnpm-lock.yaml`: Lockfile bảo đảm tái tạo 100% đúng phiên bản dependency.
  - `cordis.patch.yml`: Toàn bộ cấu hình 9Router, OmniRoute, ChatGPT Web bridge, cost gate, loop guard, vibe guard, v.v.
- `skills/`: Toàn bộ 91 skills tự chứa hoàn chỉnh (không phụ thuộc symlink ngoài).

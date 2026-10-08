# Hợp đồng làm việc cho dự án {{TÊN_DỰ_ÁN}}

> File này do `tools/new-project.sh` tạo ra. Nó là "luật chơi" cho mọi AI agent
> làm việc trong thư mục này. Ngắn, cụ thể, có thể kiểm chứng được — đừng viết
> những câu chung chung kiểu "viết code cho tốt".

## 1. Cách chạy dự án

```bash
# Lệnh chạy thử (điền khi có):
#   npm run dev      hoặc   python main.py   hoặc   ...
# Lệnh chạy test:
#   npm test         hoặc   node --test      hoặc   ...
```

## 2. Định nghĩa "xong" (Definition of Done)

Một việc chỉ được coi là xong khi **tất cả** các điều sau đúng:

- [ ] Có lệnh test chạy được, và **toàn bộ** test xanh.
- [ ] Kết quả test được **dán nguyên văn** vào câu trả lời (không tóm tắt, không
      nói "đã test rồi").
- [ ] Nếu là giao diện: có **ảnh chụp màn hình desktop và mobile**.
- [ ] Đã **commit** thay đổi (1 thay đổi logic = 1 commit).
- [ ] Nếu không chạy được test trong môi trường này: ghi rõ **"chưa verify"** và
      nói cần bạn kiểm tra tay bước nào.

## 3. Sửa lỗi: 4 nhịp bắt buộc

1. **Tái hiện** — viết test (hoặc lệnh) thể hiện đúng lỗi, chạy cho nó **đỏ**.
2. **Tìm gốc** — giải thích *vì sao* lỗi xảy ra, không chỉ chỗ nó lộ ra.
3. **Sửa gốc** — sửa nguyên nhân; sau đó chạy **toàn bộ** test, không chỉ test mới.
4. **Chốt** — commit, và nói rõ cái gì đã đổi hành vi.

Cấm: sửa mò, `try/catch` che lỗi, tắt test, hạ thấp assertion cho xanh.

## 4. Kỷ luật Git

- 1 thay đổi logic = 1 commit, thông điệp nói **vì sao** chứ không chỉ "update".
- **Không** `git push --force`, **không** `git reset --hard`, **không**
  `git clean -fd` khi chưa hỏi bạn.
- **Không** tự push lên remote - trừ khi bạn yêu cầu rõ.
- Không commit bí mật (`.env`, API key, token).

## 5. Quy ước trong dự án này

- Ngôn ngữ trả lời: tiếng Việt, giải thích ngắn gọn một câu khi dùng thuật ngữ mới.
- File không dùng nữa thì xoá hẳn, không để lại `*.bak`, `*_old`, `copy 2`.
- Không thêm thư viện mới nếu chưa nói lý do và chưa được bạn đồng ý.

## 6. Bối cảnh chung

Workspace mẹ có hướng dẫn nền ở `~/.dsh/AGENTS.md` (luôn có hiệu lực) và cẩm
nang `docs/vibe-code-cho-nguoi-moi.md` trong workspace
`/home/dzerok/Documents/deepseek-harness/default-workspace`.

# dsh-vibe-guard

Hai cổng bảo vệ agent cho DeepSeek Harness, rút từ các pattern cốt lõi của
*AI Agents in Depth* và từ lỗi thật đã quan sát được trong chính harness này.

## 1. Cổng xác minh (verify gate) - done nghĩa là đã kiểm chứng
Sau mỗi lượt sửa file, lượt chỉ được đóng khi đã có một lệnh kiểm tra THẬT
chạy và ĐẠT (test / lint / typecheck / build). Nếu chưa, harness tự steer
thêm một lượt, nêu rõ bằng chứng còn thiếu.

- Một đợt sửa chỉ bị ngắt tối đa một lần (không tạo vòng lặp vô hạn).
- Kiểm tra ĐẠT mới xoá nợ; kiểm tra THẤT BẠI vẫn còn nợ.
- Lần sửa thất bại không tạo nợ.

## 2. Cổng hành động không thể hoàn tác (irreversible gate)
Chặn TRƯỚC khi thực thi các lệnh không thể khôi phục: rm -rf /, rm -rf ~,
git push --force, git reset --hard, git clean -fdx, git checkout -- .,
chmod -R 777, curl ... | sh, npm publish, dd if=..., docker system prune -af,
DROP TABLE, kill -9 -1, sudo rm ...

Lệnh bị chặn không hề chạy; harness trả về lý do kèm hai đường ra: làm cho
thao tác có thể khôi phục, hoặc kiểm tra read-only rồi để người dùng tự chạy.

Cổng này đăng ký bằng ctx.tools.guard() nên là monotonic: không listener nào
có thể force-allow một call đã bị nó từ chối.

## Cài đặt
    dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-vibe-guard
    # restart dsh

Gỡ:
    dsh plugin --profile web remove dsh-vibe-guard

## Cấu hình (đặt trong cordis.patch.yml, mục insert của plugin)
| khoá | mặc định | ý nghĩa |
|---|---|---|
| enabled | true | bật/tắt toàn bộ plugin |
| verifyGate | true | bật cổng xác minh |
| irreversibleGate | true | bật cổng hành động không hoàn tác |
| maxPerSession | 3 | số lần tối đa được nhắc xác minh trong một phiên |
| editTools | danh sách | tên tool được coi là ghi/sửa file |
| shellTools | danh sách | tên tool được coi là chạy shell |
| verifyPatterns | danh sách | regex nhận diện lệnh kiểm tra |
| editShellPatterns | danh sách | regex nhận diện lệnh shell có ghi file |
| irreversiblePatterns | danh sách | luật {id, why, pattern} cho lệnh không hoàn tác |
| allowPatterns | [] | ngoại lệ chủ động cho irreversiblePatterns |
| gateMessage | null | thay toàn bộ thông điệp nhắc xác minh |

Tắt nhanh bằng biến môi trường: DSH_VIBE_GUARD=off

## Kiểm thử
    node --test test/policy.test.mjs

18 test phủ: nhận diện tool ghi/sửa, lệnh kiểm tra, lệnh không hoàn tác,
danh sách allow, nợ xác minh, trần nhắc mỗi phiên, nội dung thông điệp.

## Vì sao có plugin này
Đây là hai gap P0 trong docs/AGENT-FORMULA-DSH.vi.md (G1 verification gate,
G3 irreversible-action guard): mô hình có thể nói đã xong mà chưa từng chạy
kiểm tra, và có thể gọi lệnh phá huỷ không thể khôi phục. Cả hai được thực thi
ở tầng harness, bên ngoài context, nên không phụ thuộc thiện chí của mô hình.

Lớp thứ ba của cùng tài liệu (G2, tool-name fidelity) được sửa bằng
tools/patch-toolname-fuzzy.mjs.

// Bản ngắn bơm mỗi lượt: chỉ giữ phần chống đoán bừa + chống hỏi thừa.
// Toàn văn skill nằm ở ~/.dsh/skills/prompt-intake/SKILL.md và đã có trong catalog;
// đặt DSH_PROMPT_INTAKE=full để quay lại hành vi bơm toàn văn.
export const SHORT_POLICY = [
  'Prompt intake (bản ngắn) — nếu yêu cầu mơ hồ:',
  '(1) tự khảo sát ngữ cảnh (file, git, log) trước khi hỏi;',
  '(2) đoán được thì nêu một dòng giả định rồi làm luôn phần dễ hoàn tác;',
  '(3) chỉ hỏi khi quyết định lớn, tối đa 3 câu kèm phương án chọn;',
  '(4) trả lời cùng ngôn ngữ của người dùng.',
  'Toàn văn quy tắc: skill `prompt-intake` — gọi khi cần.',
].join(' ');

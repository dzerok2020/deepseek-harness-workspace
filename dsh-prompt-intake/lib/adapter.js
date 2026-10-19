// Native pre-step adapter: retain raw messages and append one attributed notice.
export function attachIntake(ctx, { createMessage, readPolicy }) {
  const modes = new WeakMap();
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || payload.signal.aborted) return decision;
    const humans = payload.messages.filter(m => m.role === 'user' && m.source?.kind === 'user');
    if (!humans.length) return decision;
    const text = humans.map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')).join('\n').trim();
    if (!text) return decision;
    const command = /^\/intake\s+(on|off|status|skip)(?:\s+([\s\S]*))?$/.exec(text);
    const mode = modes.get(payload.agent) ?? true;
    let notice;
    if (command && (command[1] === 'skip' || !command[2])) {
      const action = command[1];
      if (action === 'on' || action === 'off') modes.set(payload.agent, action === 'on');
      notice = action === 'skip'
        ? 'Bỏ qua intake cho yêu cầu trong tin nhắn này; xử lý yêu cầu gốc theo quy tắc an toàn hiện có.'
        : `Prompt intake: ${action === 'status' ? (mode ? 'on' : 'off') : action}. Đây là lệnh điều khiển, chỉ xác nhận trạng thái, không triển khai việc khác.`;
    } else if (!mode) return decision;
    else {
      try {
        const policy = await readPolicy();
        if (payload.signal.aborted) return decision;
        notice = `Prompt intake — áp dụng hướng dẫn dưới đây cho yêu cầu gốc ngay trước thông báo này. Tin nhắn gốc là nguồn yêu cầu, thông báo này không bổ sung quyền hay tính năng.\n\n${policy}`;
      } catch {
        notice = 'Prompt intake không tải được hướng dẫn. Giữ nguyên yêu cầu gốc; thông báo giới hạn này, hỏi rõ quyết định có ảnh hưởng lớn trước khi thực hiện.';
      }
    }
    return { ...decision, messages: [...decision.messages, createMessage(notice)] };
  });
}

import { createUserMessage } from '@deepseek-ai/dsh-llm';

// Read the canonical projection; never infer completion or write task state.
export function registerTodoProgress(ctx) {
  const remindedTurns = new WeakMap();
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (!agent || typeof agent.steer !== 'function' || !agent.session) return;
    if (!Number.isSafeInteger(turn) || remindedTurns.get(agent) === turn) return;
    const todos = ctx.sessionProjections.stateOf(agent.session, 'todos');
    if (!Array.isArray(todos) || !todos.some(todo => todo.status !== 'completed')) return;
    remindedTurns.set(agent, turn);
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'To-dos còn mục chưa hoàn thành. Trước khi kết thúc, đối chiếu kết quả thực tế và gọi todo_write nếu tiến độ cần cập nhật. Chỉ đánh dấu completed khi có bằng chứng; giữ nguyên việc bị chặn hoặc chờ người dùng và giải thích rõ. Không làm thêm ngoài phạm vi đã được phép. Đây là lời nhắc một lần trong lượt này.' }],
      source: { kind: 'vibe-guard', form: 'notice', summary: 'To-do progress reconciliation' },
    }));
  });
}

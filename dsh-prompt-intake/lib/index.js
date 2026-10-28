import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { attachIntake } from './adapter.js';
import { SHORT_POLICY } from './policy.js';

export const name = 'dsh-prompt-intake';
export function apply(ctx) {
  if (process.env.DSH_PROMPT_INTAKE === 'off') return;
  attachIntake(ctx, {
    createMessage: text => createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'prompt-intake', form: 'notice', summary: 'Làm rõ yêu cầu — giữ nguyên prompt gốc' },
    }),
    // Mặc định chỉ bơm bản ngắn (~420 B thay vì ~4,5 KB toàn văn mỗi lượt).
    readPolicy: () => process.env.DSH_PROMPT_INTAKE === 'full'
      ? readFile(join(homedir(), '.dsh', 'skills', 'prompt-intake', 'SKILL.md'), 'utf8')
      : Promise.resolve(SHORT_POLICY),
  });
}

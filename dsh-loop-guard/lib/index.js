// dsh-loop-guard — điểm vào plugin.
//
// Vai trò: giữ text của các "context section" biến động ổn định trong một turn, để
// `RuntimeContextProjection.project()` của host không sinh snapshot mới ở mỗi bước, nhờ đó
// chốt `if (turnEnds && decision.messages.length === 0) break;` trong vòng `turn()` của
// `@deepseek-ai/dsh-agent-loop` thoả và turn kết thúc bình thường (hết cảnh lặp
// "Chưa có yêu cầu mới — mình đang chờ bạn nhé").
//
// Lý do kỹ thuật chi tiết nằm ở đầu `lib/policy.js`.
//
// Plugin này CỐ Ý không import package nào của DSH: nó chỉ cần hook `system-prompt/assemble`
// nên không phụ thuộc `@deepseek-ai/dsh-*` (tránh lỗi phân giải module khi chạy từ workspace).
// Trạng thái được ghi ra `$DSH_HOME/loop-guard-status.json` để kiểm tra mà không cần tool.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createFreezeGuard, sessionIdOf, shouldRefresh } from './policy.js';

export const name = 'dsh-loop-guard';

// Không phụ thuộc service nào: hook `system-prompt/assemble` là event chung.
export const inject = [];

/** Tắt nhanh không cần sửa cấu hình: `DSH_LOOP_GUARD=off`. */
const OFF_VALUES = new Set(['off', '0', 'false', 'no', 'tắt', 'tat']);

const STATUS_FILENAME = 'loop-guard-status.json';
const STATUS_MIN_INTERVAL_MS = 2000;
const LOG_FIRST_N = 5;
const LOG_EVERY_N = 25;

function dshHome() {
  const explicit = process.env.DSH_HOME;
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.dsh');
}

function isOff() {
  const raw = process.env.DSH_LOOP_GUARD;
  if (typeof raw !== 'string') return false;
  return OFF_VALUES.has(raw.trim().toLowerCase());
}

function safeLogger(ctx) {
  const logger = ctx?.logger;
  return {
    info: (message) => {
      try {
        logger?.info?.(message);
      } catch {
        /* log lỗi không được làm hỏng lượt */
      }
    },
    warn: (message) => {
      try {
        logger?.warn?.(message);
      } catch {
        /* im lặng */
      }
    },
  };
}

export function apply(ctx, rawConfig) {
  const log = safeLogger(ctx);
  const guard = createFreezeGuard(rawConfig);
  const cfg = guard.config;

  if (isOff() || !cfg.enabled) {
    log.info('[dsh-loop-guard] đang TẮT (DSH_LOOP_GUARD=off hoặc enabled: false).');
    return;
  }

  const statusFile = join(dshHome(), STATUS_FILENAME);
  let statusDirty = false;
  let lastStatusWriteAt = 0;
  let freezeEvents = 0;
  let writeFailed = false;

  function flushStatus(force = false) {
    if (!statusDirty && !force) return;
    const now = Date.now();
    if (!force && now - lastStatusWriteAt < STATUS_MIN_INTERVAL_MS) return;
    statusDirty = false;
    lastStatusWriteAt = now;
    try {
      mkdirSync(dirname(statusFile), { recursive: true });
      writeFileSync(statusFile, `${JSON.stringify(guard.summarize(), null, 2)}\n`, 'utf8');
      writeFailed = false;
    } catch (error) {
      if (!writeFailed) {
        writeFailed = true;
        log.warn(`[dsh-loop-guard] không ghi được ${statusFile}: ${error?.message ?? error}`);
      }
    }
  }

  /**
   * Đóng băng các section biến động trong assembly hiện tại.
   * Gọi được cả trước và sau `next()` nên không phụ thuộc thứ tự đăng ký với plugin khác.
   */
  function freezeAssembly(assembly, session) {
    if (assembly === null || typeof assembly !== 'object') return;
    const report = guard.apply(assembly, session);
    if (!report.changed) return;
    statusDirty = true;
    freezeEvents += 1;
    flushStatus();
    const shouldLog = freezeEvents <= LOG_FIRST_N || freezeEvents % LOG_EVERY_N === 0;
    if (shouldLog) {
      const detail = report.frozen
        .map((item) =>
          item.reinserted
            ? `${item.section} (chèn lại, giữ ${item.kept} ký tự)`
            : `${item.section} (giữ ${item.kept} ký tự, bỏ qua ${item.produced})`,
        )
        .join('; ');
      log.info(
        `[dsh-loop-guard] đã đóng băng trong turn: ${detail} — tổng ${freezeEvents} lần. ` +
          'Nhờ vậy runtime context không đổi giữa các bước và turn được đóng đúng cách.',
      );
    }
  }

  // Chỉ turn mới thật hoặc tin nhắn THẬT của người dùng mới được xoá cache (cho phép bơm bản mới nhất).
  // Tin nhắn do plugin/host tiêm — điển hình là snapshot runtime context append ở mỗi bước — KHÔNG xoá
  // cache, nếu không guard sẽ tự vô hiệu hoá đúng trong ca lỗi cần chữa.
  ctx.on('session/event', (session, event) => {
    try {
      if (sessionIdOf(session) === '' && session === undefined) return;
      const type = event?.type;
      if (shouldRefresh(cfg, type, event)) {
        guard.refresh(session);
        statusDirty = true;
        flushStatus(true);
      } else if (type === 'turn/end') {
        flushStatus(true);
      }
    } catch (error) {
      log.warn(`[dsh-loop-guard] bỏ qua lỗi khi xử lý session/event: ${error?.message ?? error}`);
    }
  });

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    let session;
    try {
      session = context?.agent?.session;
      // Trường hợp plugin khác đã bơm context TRƯỚC khi tới lượt ta.
      freezeAssembly(assembly, session);
    } catch (error) {
      log.warn(`[dsh-loop-guard] bỏ qua lỗi khi đóng băng (trước next): ${error?.message ?? error}`);
    }

    const result = await next();

    try {
      // Trường hợp plugin khác bơm context BÊN TRONG `next()` (dsh-memory làm vậy).
      freezeAssembly(result, session);
    } catch (error) {
      log.warn(`[dsh-loop-guard] bỏ qua lỗi khi đóng băng (sau next): ${error?.message ?? error}`);
    }

    return result;
  });

  log.info(
    `[dsh-loop-guard] đang BẬT — đóng băng theo turn: [${cfg.sections.join(', ')}] (khớp tiền tố với '*'); ` +
      `xoá cache khi: ${cfg.refreshEvents.join(', ')}; chèn lại section thiếu: ${cfg.reinsert ? 'có' : 'không'}; ` +
      `trần session: ${cfg.maxSessions}. Trạng thái: ${statusFile}`,
  );
  flushStatus(true);
}

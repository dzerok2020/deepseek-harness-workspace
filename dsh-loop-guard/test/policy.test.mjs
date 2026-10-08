// Test cho dsh-loop-guard.
//
// Phần quan trọng nhất là "mô phỏng vòng turn" ở cuối: nó dựng lại đúng ngữ nghĩa của host
//   - `RuntimeContextProjection.project()`: chỉ sinh message mới khi text snapshot KHÁC bản đã giữ
//   - vòng `turn()` của @deepseek-ai/dsh-agent-loop: `if (turnEnds && decision.messages.length === 0) break;`
// rồi chạy 2 kịch bản: KHÔNG có guard (tái hiện lỗi lặp vô hạn) và CÓ guard (turn đóng sau 1 bước).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANONYMOUS_SESSION,
  DEFAULT_FREEZE_SECTIONS,
  DEFAULT_MAX_SESSIONS,
  compileConfig,
  createFreezeGuard,
  isInjectedMessage,
  sessionIdOf,
  shouldRefresh,
  targetsSection,
} from '../lib/policy.js';

// ---------------------------------------------------------------------------
// Mô phỏng host
// ---------------------------------------------------------------------------

function renderContextSections(assembly) {
  return assembly.contexts
    .filter((item) => item && typeof item.text === 'string' && item.text.length > 0)
    .map((item) => ({ name: item.name, text: item.text }));
}

function joinContextSections(sections) {
  return `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${sections
    .map((section) => section.text)
    .join('\n\n')}`;
}

/**
 * Mô phỏng một turn gồm nhiều step.
 * `makeAssembly(step)` phải trả về assembly mới (tức là mỗi bước plugin bơm lại text mới nhất).
 * Trả về `{ steps, appended, closedAt, retained }`.
 */
function simulateTurn({ makeAssembly, guard, session, maxSteps = 20, retainedBefore }) {
  let retained = retainedBefore;
  const appended = [];
  let closedAt = null;

  for (let step = 1; step <= maxSteps; step += 1) {
    const assembly = makeAssembly(step);
    if (guard) guard.apply(assembly, session);

    const snapshot = joinContextSections(renderContextSections(assembly));
    let produced = false;
    // project(): nếu chưa có bản giữ và snapshot rỗng thì không gửi gì cả.
    if (!(retained === undefined && snapshot.length === 0)) {
      if (retained !== snapshot) {
        retained = snapshot;
        produced = true;
      }
    }
    appended.push(produced);

    // Vòng turn(): từ bước thứ 2 trở đi, không có message mới => turn đóng.
    if (step > 1 && !produced) {
      closedAt = step;
      break;
    }
  }

  return { appended, closedAt, retained, steps: appended.length };
}

function windowAssembly(step, extra = {}) {
  return {
    sections: [],
    contexts: [
      { name: 'aegis:routing', text: 'AEGIS_DSH_ROUTING_BOOTSTRAP (ổn định)' },
      {
        name: 'lingshu:session-window',
        text: `【本会话近期对话】\n[assistant] câu trả lời số ${step} — dài dần theo từng bước`,
      },
      { name: 'lingshu:auto-recall', text: `【灵枢最近记忆】\n- [contextual] mục ${step}` },
    ],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Config / tiện ích thuần
// ---------------------------------------------------------------------------

test('compileConfig: mặc định đúng và an toàn với dữ liệu rác', () => {
  const cfg = compileConfig(undefined);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.sections, [...DEFAULT_FREEZE_SECTIONS]);
  assert.deepEqual(cfg.refreshEvents, ['turn/start', 'user/message']);
  assert.equal(cfg.reinsert, true);
  assert.equal(cfg.maxSessions, DEFAULT_MAX_SESSIONS);

  for (const garbage of [null, 42, 'x', [], { sections: 3, refreshEvents: {}, maxSessions: -5 }]) {
    const safe = compileConfig(garbage);
    assert.equal(safe.enabled, true);
    assert.ok(Array.isArray(safe.sections) && safe.sections.length > 0);
    assert.ok(Array.isArray(safe.refreshEvents) && safe.refreshEvents.length > 0);
    assert.equal(safe.maxSessions, DEFAULT_MAX_SESSIONS);
  }

  // Tắt hẳn việc đóng băng bằng danh sách rỗng tường minh.
  assert.deepEqual(compileConfig({ sections: [] }).sections, []);
  assert.equal(compileConfig({ enabled: false }).enabled, false);
  // Lọc phần tử rác nhưng giữ phần tử hợp lệ.
  assert.deepEqual(compileConfig({ sections: ['  a  ', '', 7, 'b', 'a'] }).sections, ['a', 'b']);
});

test('sessionIdOf: nhận cả id lẫn sessionId, không bao giờ throw', () => {
  assert.equal(sessionIdOf({ id: 's1' }), 's1');
  assert.equal(sessionIdOf({ sessionId: 's2' }), 's2');
  assert.equal(sessionIdOf({ id: 's1', sessionId: 's2' }), 's1');
  assert.equal(sessionIdOf({ id: 123 }), '123');
  assert.equal(sessionIdOf(undefined), '');
  assert.equal(sessionIdOf(null), '');
  assert.equal(sessionIdOf({}), '');
});

test('targetsSection: khớp chính xác, tiền tố + "*", và "*"', () => {
  assert.equal(targetsSection(['lingshu:session-window'], 'lingshu:session-window'), true);
  assert.equal(targetsSection(['lingshu:session-window'], 'lingshu:auto-recall'), false);
  assert.equal(targetsSection(['lingshu:*'], 'lingshu:auto-recall'), true);
  assert.equal(targetsSection(['lingshu:*'], 'aegis:routing'), false);
  assert.equal(targetsSection(['*'], 'bất-kỳ'), true);
  assert.equal(targetsSection([], 'x'), false);
  assert.equal(targetsSection(['x'], ''), false);
});

test('shouldRefresh: chỉ đúng các sự kiện đã cấu hình', () => {
  const cfg = compileConfig(undefined);
  assert.equal(shouldRefresh(cfg, 'turn/start'), true);
  assert.equal(shouldRefresh(cfg, 'user/message'), true);
  assert.equal(shouldRefresh(cfg, 'turn/end'), false);
  assert.equal(shouldRefresh(cfg, 'tool/end'), false);
  assert.equal(shouldRefresh(cfg, undefined), false);
  assert.equal(shouldRefresh(compileConfig({ refreshEvents: ['turn/start'] }), 'user/message'), false);
  assert.equal(shouldRefresh(compileConfig({ enabled: false }), 'turn/start'), false);
});

// ---------------------------------------------------------------------------
// Bộ đóng băng
// ---------------------------------------------------------------------------

test('apply: bước đầu ghi nhận, các bước sau bị ghi đè bằng bản đã ghi nhận', () => {
  const guard = createFreezeGuard({});
  const session = { id: 's1' };

  const first = windowAssembly(1);
  guard.apply(first, session);
  assert.equal(first.contexts[1].text.includes('số 1'), true);
  assert.equal(guard.summarize().counters.freezes, 0);
  // Bộ đếm tính theo TỪNG KHỐI: 2 khối biến động (session-window + auto-recall).
  assert.equal(guard.summarize().counters.stores, 2);

  const second = windowAssembly(2);
  const report = guard.apply(second, session);
  assert.equal(report.changed, true);
  assert.equal(second.contexts[1].text.includes('số 1'), true, 'phải giữ bản của bước 1');
  assert.equal(second.contexts[1].text.includes('số 2'), false);
  assert.equal(second.contexts[2].text.includes('mục 1'), true, 'auto-recall cũng bị đóng băng');

  // Section không nằm trong danh sách thì phải để yên.
  assert.equal(second.contexts[0].text, 'AEGIS_DSH_ROUTING_BOOTSTRAP (ổn định)');

  const third = guard.apply(windowAssembly(3), session);
  assert.equal(third.changed, true);
  // Bước 2 và bước 3, mỗi bước đóng băng 2 khối => 4.
  assert.equal(guard.summarize().counters.freezes, 4);
  assert.equal(guard.summarize().counters.assemblies, 3);
});

test('refresh: xoá cache để turn mới được bơm bản mới nhất', () => {
  const guard = createFreezeGuard({});
  const session = { id: 's1' };
  guard.apply(windowAssembly(1), session);

  assert.equal(guard.refresh(session), true);
  assert.equal(guard.cacheSize(), 0);

  const fresh = windowAssembly(2);
  const report = guard.apply(fresh, session);
  assert.equal(report.changed, false, 'sau refresh, bản mới được GHI NHẬN chứ không bị đè');
  assert.equal(fresh.contexts[1].text.includes('số 2'), true);
  // 2 khối ghi nhận lần đầu + 2 khối ghi nhận lại sau refresh = 4.
  assert.equal(guard.summarize().counters.stores, 4);
  assert.equal(guard.summarize().counters.refreshes, 1);
  // Sau bước apply ở trên, cache đã được ghi nhận lại => refresh phải xoá được lần nữa.
  assert.equal(guard.refresh(session), true, 'refresh xoá được bản vừa ghi nhận lại');
  assert.equal(guard.cacheSize(), 0);
  assert.equal(guard.refresh(session), false, 'refresh khi cache rỗng thì không có gì để xoá');
});

test('reinsert: section biến động vắng mặt giữa turn được chèn lại bản cũ', () => {
  const guard = createFreezeGuard({});
  const session = { id: 's1' };
  guard.apply(windowAssembly(1), session);

  // Bước 2: plugin bên kia không bơm khối session-window nữa (ví dụ autoRecall bị tắt giữa chừng).
  const second = {
    sections: [],
    contexts: [{ name: 'aegis:routing', text: 'AEGIS_DSH_ROUTING_BOOTSTRAP (ổn định)' }],
  };
  const report = guard.apply(second, session);
  assert.equal(report.changed, true);
  const reinserted = second.contexts.find((item) => item.name === 'lingshu:session-window');
  assert.ok(reinserted, 'phải chèn lại khối đã biến mất');
  assert.equal(reinserted.text.includes('số 1'), true);
  // Chèn lại 2 khối đã biến mất (session-window + auto-recall).
  assert.equal(guard.summarize().counters.reinserts, 2);

  // Khi tắt reinsert thì không chèn nữa (người dùng chủ động chọn hành vi này).
  const noReinsert = createFreezeGuard({ reinsert: false });
  noReinsert.apply(windowAssembly(1), session);
  const again = { sections: [], contexts: [{ name: 'aegis:routing', text: 'x' }] };
  noReinsert.apply(again, session);
  assert.equal(again.contexts.length, 1);
});

test('cô lập theo session và trần LRU', () => {
  const guard = createFreezeGuard({ maxSessions: 2 });
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  guard.apply(windowAssembly(1), a);
  guard.apply(windowAssembly(9), b);
  // 'a' phải giữ bản 1 dù 'b' có bản khác.
  const aAgain = windowAssembly(5);
  guard.apply(aAgain, a);
  assert.equal(aAgain.contexts[1].text.includes('số 1'), true);

  // Thêm session thứ ba => session cũ nhất ('a') bị đẩy ra.
  guard.apply(windowAssembly(1), c);
  assert.equal(guard.cacheSize(), 2);

  // Dữ liệu méo: assembly không hợp lệ không được làm nổ.
  assert.deepEqual(guard.apply(undefined, a), { changed: false, frozen: [] });
  assert.deepEqual(guard.apply({}, a), { changed: false, frozen: [] });
  assert.deepEqual(guard.apply({ contexts: null }, a), { changed: false, frozen: [] });

  // Session không có id thì gom vào khoá ẩn danh.
  guard.apply(windowAssembly(1), {});
  const status = guard.summarize();
  assert.ok(status.sessions.some((item) => item.session === ANONYMOUS_SESSION));
});

test('enabled:false thì không can thiệp gì', () => {
  const guard = createFreezeGuard({ enabled: false });
  const assembly = windowAssembly(2);
  const before = assembly.contexts.map((item) => item.text);
  const report = guard.apply(assembly, { id: 's1' });
  assert.equal(report.changed, false);
  assert.deepEqual(assembly.contexts.map((item) => item.text), before);
  assert.equal(guard.cacheSize(), 0);
});

test('summarize: có số liệu dùng để chẩn đoán', () => {
  const guard = createFreezeGuard({});
  guard.apply(windowAssembly(1), { id: 's1' });
  guard.apply(windowAssembly(2), { id: 's1' });
  guard.refresh({ id: 's1' });
  const status = guard.summarize();
  assert.equal(status.plugin, 'dsh-loop-guard');
  assert.equal(status.enabled, true);
  assert.equal(status.counters.assemblies, 2);
  assert.equal(status.counters.freezes, 2);
  assert.equal(status.counters.refreshes, 1);
  assert.equal(status.activeSessions, 0);
  assert.ok(status.lastFreeze !== null);
  assert.ok(status.lastRefresh !== null);
  assert.deepEqual(status.freezeSections, [...DEFAULT_FREEZE_SECTIONS]);
});

// ---------------------------------------------------------------------------
// Mô phỏng vòng turn — bằng chứng chính
// ---------------------------------------------------------------------------

test('TÁI HIỆN LỖI: không có guard thì turn không bao giờ đóng (lặp vô hạn)', () => {
  const result = simulateTurn({
    makeAssembly: (step) => windowAssembly(step),
    guard: null,
    session: { id: 's1' },
    maxSteps: 15,
  });
  assert.equal(result.closedAt, null, 'đúng như báo lỗi: turn không bao giờ đóng');
  assert.equal(result.steps, 15);
  assert.deepEqual(result.appended, new Array(15).fill(true));
});

test('ĐÃ SỬA: có guard thì turn đóng ngay bước thứ 2', () => {
  const guard = createFreezeGuard({});
  const result = simulateTurn({
    makeAssembly: (step) => windowAssembly(step),
    guard,
    session: { id: 's1' },
    maxSteps: 15,
  });
  assert.equal(result.closedAt, 2, 'bước 2 không còn snapshot mới => turn đóng');
  assert.deepEqual(result.appended, [true, false]);
  // Bước 2 đóng băng 2 khối biến động.
  assert.equal(guard.summarize().counters.freezes, 2);
});

test('ĐÃ SỬA: mỗi turn mới được phép bơm lại đúng một snapshot', () => {
  const guard = createFreezeGuard({});
  const session = { id: 's1' };

  const turn1 = simulateTurn({
    makeAssembly: (step) => windowAssembly(step),
    guard,
    session,
    maxSteps: 10,
  });
  assert.equal(turn1.closedAt, 2);
  assert.equal(turn1.appended.filter(Boolean).length, 1, 'turn 1 chỉ 1 snapshot');

  // Người dùng gửi yêu cầu mới: host append turn/start + user/message => guard xoá cache.
  assert.equal(shouldRefresh(guard.config, 'turn/start'), true);
  guard.refresh(session);

  const turn2 = simulateTurn({
    makeAssembly: (step) => windowAssembly(100 + step),
    guard,
    session,
    maxSteps: 10,
    retainedBefore: turn1.retained,
  });
  assert.equal(turn2.closedAt, 2);
  assert.equal(turn2.appended[0], true, 'turn 2 được bơm bản mới');
  assert.equal(turn2.appended[1], false, 'rồi đóng băng trở lại');
  assert.equal(turn2.retained.includes('số 101'), true, 'model thấy dữ liệu mới của turn 2');
});

test('ĐÃ SỬA: section biến mất giữa turn cũng không làm turn mở lại', () => {
  const guard = createFreezeGuard({});
  const result = simulateTurn({
    makeAssembly: (step) => {
      const assembly = windowAssembly(step);
      // Bước 3 trở đi: khối session-window biến mất (nguồn bơm bị ngắt giữa chừng).
      if (step >= 3) assembly.contexts = assembly.contexts.filter((item) => item.name !== 'lingshu:session-window');
      return assembly;
    },
    guard,
    session: { id: 's1' },
    maxSteps: 10,
  });
  assert.equal(result.closedAt, 2);
});

test('chế độ đóng băng toàn bộ: sections ["*"] chặn mọi nguồn biến động', () => {
  const guard = createFreezeGuard({ sections: ['*'] });
  const result = simulateTurn({
    makeAssembly: (step) => ({
      sections: [],
      contexts: [
        { name: 'plugin-lạ:context', text: `giá trị đổi mỗi bước ${step}` },
        { name: 'lingshu:session-window', text: `cửa sổ ${step}` },
      ],
    }),
    guard,
    session: { id: 's1' },
    maxSteps: 10,
  });
  assert.equal(result.closedAt, 2);
  assert.equal(guard.summarize().counters.freezes, 2);
});

// ---------------------------------------------------------------------------
// Payload THẬT lấy từ session JSONL (record `user/message`, seq 33).
//
// Mỗi bước DSH append MỘT message `user/message` là snapshot runtime context, và text của section
// `lingshu:session-window` trong đó đổi mỗi bước (thêm một dòng `[assistant] …`). Nếu coi nó là tin
// nhắn người dùng thật thì guard tự xoá cache mỗi bước => `freezes` luôn 0 => guard vô hiệu hoá
// ĐÚNG trong ca lỗi mà nó sinh ra để chữa. Đây là lỗi thiết kế bản đầu, các test dưới khoá lại.
// ---------------------------------------------------------------------------

const RUNTIME_CONTEXT_EVENT = {
  type: 'user/message',
  data: {
    role: 'user',
    surfaceOp: 'append',
    source: {
      kind: 'runtime-context',
      form: 'snapshot',
      sections: [
        { name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
        { name: 'lingshu:session-window', text: '【本会话近期对话】\n[assistant] bước 1' },
      ],
    },
  },
};

test('tin tiêm (runtime-context snapshot) KHÔNG được refresh cache', () => {
  const cfg = compileConfig({});
  assert.equal(isInjectedMessage(RUNTIME_CONTEXT_EVENT.data), true);
  assert.equal(shouldRefresh(cfg, 'user/message', RUNTIME_CONTEXT_EVENT), false);
});

test('tin nhắn THẬT của người dùng vẫn refresh cache', () => {
  const cfg = compileConfig({});
  const realUser = {
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user', rpcId: 'd4370f68-0000-0000-0000-000000000000', clientTimeZone: 'Asia/Saigon' },
    },
  };
  assert.equal(isInjectedMessage(realUser.data), false);
  assert.equal(shouldRefresh(cfg, 'user/message', realUser), true);
});

test('mọi nguồn tiêm khác đều không refresh: plugin:aegis, time-context, system-reminder', () => {
  const cfg = compileConfig({});
  for (const kind of ['plugin:aegis', 'plugin:stratagate-memory', 'time-context', 'system-reminder']) {
    assert.equal(
      shouldRefresh(cfg, 'user/message', { type: 'user/message', data: { source: { kind } } }),
      false,
      kind,
    );
  }
});

test('turn/start luôn refresh; message không có source giữ hành vi cũ (refresh)', () => {
  const cfg = compileConfig({});
  assert.equal(shouldRefresh(cfg, 'turn/start', { type: 'turn/start', data: { turn: 2 } }), true);
  assert.equal(isInjectedMessage({}), false);
  assert.equal(isInjectedMessage(undefined), false);
  assert.equal(isInjectedMessage({ source: {} }), false);
  assert.equal(shouldRefresh(cfg, 'user/message', { type: 'user/message', data: { role: 'user' } }), true);
});

test('sự kiện không nằm trong refreshEvents thì không bao giờ refresh', () => {
  const cfg = compileConfig({ refreshEvents: ['turn/start'] });
  assert.equal(shouldRefresh(cfg, 'user/message', RUNTIME_CONTEXT_EVENT), false);
  assert.equal(shouldRefresh(cfg, 'step/start', { type: 'step/start' }), false);
  assert.equal(shouldRefresh(cfg, 'turn/start', { type: 'turn/start' }), true);
});

test('tái hiện lỗi gốc: refresh theo MỌI user/message => freezes=0; lọc tin tiêm => đóng băng được', () => {
  const session = { id: 's-1' };
  const step = (text) => ({ contexts: [{ name: 'lingshu:session-window', text }] });

  // Hành vi CŨ: mỗi bước có `user/message` (kể cả tin tiêm) là xoá cache => không bao giờ đóng băng.
  const old = createFreezeGuard({});
  old.apply(step('bước 1'), session);
  old.refresh(session);
  assert.deepEqual(old.apply(step('bước 2'), session).frozen, []);

  // Hành vi MỚI: tin tiêm không xoá cache => bước 2 bị giữ nguyên text của bước 1.
  const fixed = createFreezeGuard({});
  fixed.apply(step('bước 1'), session);
  const report = fixed.apply(step('bước 2'), session);
  assert.equal(report.changed, true);
  assert.equal(report.frozen.length, 1);
  assert.equal(report.frozen[0].section, 'lingshu:session-window');
  assert.equal(report.frozen[0].kept, 'bước 1'.length);
});

// dsh-loop-guard — logic thuần, không phụ thuộc host, test được bằng `node --test`.
//
// BỐI CẢNH (vì sao plugin này tồn tại):
// Một số plugin bơm "runtime context" vào mỗi bước bằng hook `system-prompt/assemble`.
// Ví dụ `@furongjun1999/dsh-memory` bơm hai khối `lingshu:auto-recall` và
// `lingshu:session-window`; khối sau chứa "các message gần nhất", nghĩa là text của nó
// ĐỔI mỗi khi model trả lời thêm một câu.
//
// Host (`@deepseek-ai/dsh-agent-loop`) có `RuntimeContextProjection.project()`:
// nó giữ lại bản context đã gửi lần trước và CHỈ tạo thêm một `user/message` snapshot
// khi text khác bản đã giữ. Vòng `turn()` có chốt:
//     if (turnEnds && decision.messages.length === 0) break;
// Tức là turn chỉ được đóng khi bước kế tiếp KHÔNG có message mới nào.
//
// Nếu text đổi mỗi bước => luôn có snapshot mới => `messages.length > 0` => turn không
// bao giờ đóng => sau khi trả lời xong, host mở thêm bước không có yêu cầu người dùng =>
// model trả lời "Chưa có yêu cầu mới / Chờ bạn nhé" => chính câu đó lại làm cửa sổ đổi =>
// thêm bước nữa. Vòng lặp tự nuôi, mỗi vòng còn append thêm một snapshot vào session.
//
// CÁCH CHỮA (tối thiểu, không sửa plugin bên thứ ba):
// Đóng băng text của các context section biến động TRONG MỘT TURN. Bước đầu của turn ghi
// nhận text; mọi bước sau trong cùng turn bị ghi đè bằng bản đã ghi nhận => text không đổi
// => `project()` trả `undefined` => chốt trên thoả => turn kết thúc bình thường.
// Sang turn mới thì xoá cache => bơm lại bản mới nhất (tối đa 1 snapshot mới mỗi turn).
//
// Xem test/policy.test.mjs: test "vòng lặp" mô phỏng lại đúng ngữ nghĩa `project()` và
// chứng minh có guard thì turn kết thúc, không guard thì lặp vô hạn.

/** Các section mặc định bị đóng băng theo turn (khớp theo tên chính xác hoặc tiền tố + `*`). */
export const DEFAULT_FREEZE_SECTIONS = Object.freeze([
  'lingshu:session-window',
  'lingshu:auto-recall',
]);

/** Sự kiện session làm cache được phép tính lại (đầu turn mới / có yêu cầu mới của người dùng). */
export const DEFAULT_REFRESH_EVENTS = Object.freeze(['turn/start', 'user/message']);

/** Số session tối đa được giữ cache (LRU thô: xoá session cũ nhất khi vượt). */
export const DEFAULT_MAX_SESSIONS = 64;

/** Khoá dùng khi không lấy được id session (hiếm; gom chung một chỗ). */
export const ANONYMOUS_SESSION = '<anonymous>';

/**
 * Lấy id session từ nhiều hình dạng khác nhau. DSH dùng `session.id`; một số event/host
 * khác dùng `session.sessionId`. Luôn trả chuỗi (rỗng nếu không có), không bao giờ throw.
 */
export function sessionIdOf(raw) {
  const value = raw?.id ?? raw?.sessionId;
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
}

function normalizeNameList(value, fallback) {
  if (value === undefined || value === null) return [...fallback];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  // Danh sách rỗng do người dùng khai báo tường minh là hợp lệ (tắt hẳn việc đóng băng),
  // nhưng danh sách rỗng do dữ liệu rác thì quay về mặc định.
  if (out.length === 0 && (Array.isArray(value) ? value.length > 0 : true)) return [...fallback];
  return out;
}

function toPositiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** Chuẩn hoá cấu hình người dùng (từ cordis.patch.yml) thành cấu hình đầy đủ, an toàn. */
export function compileConfig(raw) {
  const src = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    sections: normalizeNameList(src.sections, DEFAULT_FREEZE_SECTIONS),
    refreshEvents: normalizeNameList(src.refreshEvents, DEFAULT_REFRESH_EVENTS),
    reinsert: src.reinsert !== false,
    maxSessions: toPositiveInt(src.maxSessions, DEFAULT_MAX_SESSIONS),
  };
}

/** Tên section có nằm trong danh sách đóng băng không (khớp chính xác, `"*"`, hoặc `"tiền tố*"`). */
export function targetsSection(patterns, sectionName) {
  if (typeof sectionName !== 'string' || sectionName === '') return false;
  if (!Array.isArray(patterns)) return false;
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern === '') continue;
    if (pattern === '*') return true;
    if (pattern === sectionName) return true;
    if (pattern.endsWith('*') && sectionName.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Tin nhắn này có phải do hệ thống/plugin TIÊM vào (không phải người dùng gõ)?
 *
 * DSH ghi CẢ tin nhắn tiêm lẫn tin nhắn thật dưới cùng một loại sự kiện `user/message`.
 * Bản snapshot runtime context (host dựng từ `assembly.contexts`) là ví dụ điển hình: nó có
 * `source = { kind: 'runtime-context', form: 'snapshot', sections: [...] }` và được append ở
 * MỖI bước. Tin nhắn thật của người dùng có `source = { kind: 'user', rpcId, clientTimeZone }`.
 *
 * Không có `source` (hoặc `kind` không phải chuỗi khác rỗng) thì coi như tin thật — giữ nguyên
 * hành vi cũ để host khác vẫn refresh được.
 */
export function isInjectedMessage(message) {
  const kind = message?.source?.kind;
  if (typeof kind !== 'string' || kind === '') return false;
  return kind !== 'user';
}

/**
 * Sự kiện session này có làm cache được tính lại không.
 *
 * `event` là payload `{ type, data }` của hook `session/event`. Với `user/message`, tin TIÊM thì
 * KHÔNG được refresh: snapshot runtime context đổi text mỗi bước, refresh theo nó sẽ xoá cache mỗi
 * bước và guard không bao giờ đóng băng được — đúng ca lỗi mà guard sinh ra để chữa. `turn/start`
 * luôn refresh vì đó là turn mới thật.
 */
export function shouldRefresh(cfg, eventType, event) {
  if (!cfg || cfg.enabled === false) return false;
  if (typeof eventType !== 'string' || eventType === '') return false;
  if (!Array.isArray(cfg.refreshEvents) || !cfg.refreshEvents.includes(eventType)) return false;
  if (eventType === 'user/message' && isInjectedMessage(event?.data ?? event)) return false;
  return true;
}

/**
 * Bộ đóng băng. Trạng thái: `Map<sessionKey, Map<sectionName, text>>`.
 *
 * `apply(assembly, session)` được gọi ở mỗi lần assemble system prompt; nó sửa `assembly.contexts`
 * TẠI CHỖ (host đọc chính object này) và trả về báo cáo `{ changed, frozen }`.
 * Hàm này không bao giờ throw với dữ liệu méo: mọi nhánh đều kiểm tra kiểu.
 */
export function createFreezeGuard(rawConfig) {
  const cfg = compileConfig(rawConfig);
  const cache = new Map();
  const counters = {
    assemblies: 0,
    stores: 0,
    freezes: 0,
    reinserts: 0,
    refreshes: 0,
    producedChars: 0,
    keptChars: 0,
  };
  let lastFreeze = null;
  let lastRefresh = null;

  function sessionEntry(key) {
    let per = cache.get(key);
    if (per === undefined) {
      per = new Map();
      cache.set(key, per);
      // LRU thô: Map giữ thứ tự chèn, xoá khoá cũ nhất khi vượt trần.
      while (cache.size > cfg.maxSessions) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
    }
    return per;
  }

  /** Quên cache của một session => bước kế tiếp sẽ ghi nhận bản text mới. */
  function refresh(session) {
    const key = sessionIdOf(session) || ANONYMOUS_SESSION;
    const existed = cache.delete(key);
    counters.refreshes += 1;
    lastRefresh = { at: Date.now(), session: key, existed };
    return existed;
  }

  function freezeInto(assembly, key, per) {
    const frozen = [];
    const seen = new Set();
    for (const item of assembly.contexts) {
      if (item === null || typeof item !== 'object') continue;
      const section = typeof item.name === 'string' ? item.name : '';
      if (!targetsSection(cfg.sections, section)) continue;
      seen.add(section);
      const text = typeof item.text === 'string' ? item.text : '';
      if (!per.has(section)) {
        per.set(section, text);
        counters.stores += 1;
        continue;
      }
      const previous = per.get(section);
      if (previous === text) continue;
      item.text = previous; // <-- điểm chữa: giữ nguyên text đã gửi trong turn này
      counters.freezes += 1;
      counters.producedChars += text.length;
      counters.keptChars += previous.length;
      if (lastFreeze === null || frozen.length === 0) {
        lastFreeze = {
          at: Date.now(),
          session: key,
          section,
          produced: text.length,
          kept: previous.length,
        };
      }
      frozen.push({ section, produced: text.length, kept: previous.length });
    }
    return { frozen, seen };
  }

  function apply(assembly, session) {
    if (!cfg.enabled) return { changed: false, frozen: [] };
    if (assembly === null || typeof assembly !== 'object') return { changed: false, frozen: [] };
    if (!Array.isArray(assembly.contexts)) return { changed: false, frozen: [] };
    counters.assemblies += 1;
    const key = sessionIdOf(session) || ANONYMOUS_SESSION;
    const per = sessionEntry(key);

    const { frozen, seen } = freezeInto(assembly, key, per);

    if (cfg.reinsert) {
      // Nếu một section biến động vắng mặt ở bước này nhưng đã có bản ghi nhận, chèn lại bản cũ.
      // Không làm vậy thì text sẽ "nhấp nháy" có/không giữa các bước => snapshot vẫn đổi => vẫn lặp.
      for (const [section, text] of per) {
        if (seen.has(section) || text === '') continue;
        assembly.contexts.push({ name: section, text });
        counters.reinserts += 1;
        frozen.push({ section, reinserted: true, kept: text.length });
      }
    }

    if (frozen.length > 0 && lastFreeze === null) {
      lastFreeze = { at: Date.now(), session: key, section: frozen[0].section };
    }
    return { changed: frozen.length > 0, frozen };
  }

  /** Ảnh chụp trạng thái để ghi ra file JSON cho người dùng/agent kiểm tra. */
  function summarize() {
    return {
      plugin: 'dsh-loop-guard',
      enabled: cfg.enabled,
      freezeSections: cfg.sections,
      refreshEvents: cfg.refreshEvents,
      reinsert: cfg.reinsert,
      maxSessions: cfg.maxSessions,
      counters: { ...counters },
      lastFreeze,
      lastRefresh,
      activeSessions: cache.size,
      sessions: [...cache.entries()].map(([session, per]) => ({
        session,
        sections: [...per.entries()].map(([section, text]) => ({ section, chars: text.length })),
      })),
    };
  }

  return {
    config: cfg,
    apply,
    refresh,
    summarize,
    cacheSize: () => cache.size,
  };
}

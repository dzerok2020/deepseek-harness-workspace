// Giới hạn tool theo scope (dùng bên trong một agent preset).
// `allow`: chỉ giữ các tool GLOBAL có tên trong danh sách; `deny`: bỏ các tool đó.
// Tool do chính preset đăng ký (bash, read, write, web…) không bị lọc —
// vì `tools.restrict()` chỉ lọc lớp được thừa hưởng, không lọc lớp của chính scope.
export const name = "dsh-tool-filter";
export const inject = ["tools"];

const quoted = (message) => new Set([...String(message).matchAll(/"([^"]+)"/g)].map((m) => m[1]));

export function apply(ctx, config = {}) {
  const allow = Array.isArray(config.allow) ? config.allow.filter(Boolean) : undefined;
  const deny = Array.isArray(config.deny) ? config.deny.filter(Boolean) : undefined;
  if (!allow && !deny) return;

  const restrict = (a, d) => {
    const filter = {};
    if (a && a.length > 0) filter.allow = a;
    if (d && d.length > 0) filter.deny = d;
    if (filter.allow === undefined && filter.deny === undefined) return false;
    ctx.tools.restrict(filter);
    return true;
  };

  try {
    if (restrict(allow, deny)) return;
  } catch (error) {
    // Tên trong config có thể đã biến mất sau khi gỡ plugin: bỏ đúng tên bị báo
    // rồi thử lại, để preset không bị "broken" chỉ vì config cũ.
    const bad = quoted(error?.message ?? "");
    if (bad.size === 0) {
      ctx.logger?.warn?.(`dsh-tool-filter: ${error?.message ?? error}`);
      return;
    }
    const a = allow?.filter((n) => !bad.has(n));
    const d = deny?.filter((n) => !bad.has(n));
    try {
      if (restrict(a, d)) {
        ctx.logger?.warn?.(`dsh-tool-filter: bỏ qua tên không còn tồn tại: ${[...bad].join(", ")}`);
      }
    } catch (second) {
      // Không lọc được thì thà chạy với đủ tool còn hơn làm hỏng preset.
      ctx.logger?.warn?.(`dsh-tool-filter: không áp dụng được filter: ${second?.message ?? second}`);
    }
  }
}
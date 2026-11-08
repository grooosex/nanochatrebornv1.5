import type { ImageParams } from "./types";
import { applyPromptSlots } from "./prompt-slots";

export const APPEARANCE_MODULE_NAME = "角色";

function uid(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface RandomItem {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  /** 角色选择里的 id。有这个才跟着那边走。 */
  sourceId?: string;
  /** 在模块里改过名字，就不再跟着角色选择的名字。 */
  nameCustom?: boolean;
}

export interface RandomGroup {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  order: number;
  starred?: boolean;
}

export interface RandomScheme {
  id: string;
  name: string;
  order: number;
  enabled: Record<string, boolean>;
}

export interface RandomModule {
  id: string;
  name: string;
  pick: "random" | "seq";
  items: RandomItem[];
  /** 下次顺序要选的项。空着就是从第一项开始。 */
  nextId?: string | null;
  /** 抽一次接着用几张。1 或空着就是每张都重抽。 */
  rounds?: number;
  /** 这一项已经用了几次。轮数用完、关掉随机或删掉符号就清掉。 */
  hold?: { itemId: string; used: number } | null;
  /** 由角色选择维护。复制出来的没有这个。 */
  linked?: "appearances";
  /** 空着就是最外层。 */
  groupId?: string | null;
  starred?: boolean;
  order?: number;
  /** 保存的开关方案。按条目 id，不看名字和顺序。 */
  schemes?: RandomScheme[];
}

export interface RandomBank {
  enabled: boolean;
  modules: RandomModule[];
  /** 多个模块合在一次里抽时，各自记位置。键是「角色&动作」。 */
  comboLast?: Record<string, string>;
  /** 组合标签各自记「这一项用了几次」。键同上。 */
  comboHold?: Record<string, { itemId: string; used: number }>;
  /** 用户删掉了自动的「角色」模块。下次打开随机设置会在最外层再建。 */
  appearanceModuleDismissed?: boolean;
  groups?: RandomGroup[];
  /** 快速配置里模块池的高度。 */
  poolHeight?: number;
  /** 上一张成功的图实际用到的条目。红框只画这些。失败不改。 */
  shownItemIds?: string[];
}

type PromptFields = Pick<ImageParams, "promptFront" | "promptMid" | "promptBack" | "negative">;

const TAG_SRC = String.raw`<ran_id="([^"]+)"((?:&"[^"]+")*)>`;

export function emptyBank(): RandomBank {
  return { enabled: false, modules: [], comboLast: {} };
}

export function moduleTag(names: string[]) {
  return `<ran_id=${names.map((n) => `"${n}"`).join("&")}>`;
}

export function appendPrompt(mid: string, piece: string) {
  const t = mid.replace(/\s+$/, "");
  if (!t) return piece;
  if (t.endsWith(",")) return `${t}${piece}`;
  return `${t},${piece}`;
}

export function appendPromptLine(mid: string, piece: string) {
  const t = mid.replace(/\s+$/, "");
  return t ? `${t}\n\n${piece}` : piece;
}

export function badModuleName(name: string, modules: RandomModule[], exceptId?: string) {
  const n = name.trim();
  if (!n) return "先写模块名";
  if (/["&<>]/.test(n)) return "名字里不能有引号和 &";
  if (modules.some((m) => m.id !== exceptId && m.name === n)) return "已经有同名模块";
  return "";
}

export function bankSwitch(bank: RandomBank, enabled: boolean): RandomBank {
  if (enabled) return { ...bank, enabled: true };
  return {
    ...bank,
    enabled: false,
    modules: bank.modules.map((m) => ({ ...m, nextId: null, hold: null })),
    comboLast: {},
    comboHold: {},
  };
}

export function moduleRounds(mod: RandomModule) {
  const n = Math.floor(Number(mod.rounds));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** 顺序模式下，下一张会用到的那一项。轮数还没用完时是正在复用的项。 */
export function seqTurnItem(mod: RandomModule): RandomItem | null {
  const pool = mod.items.filter((item) => item.enabled);
  if (!pool.length) return null;
  const rounds = moduleRounds(mod);
  if (mod.hold && mod.hold.used < rounds) {
    const held = pool.find((item) => item.id === mod.hold?.itemId);
    if (held) return held;
  }
  if (mod.nextId) {
    const at = pool.find((item) => item.id === mod.nextId);
    if (at) return at;
  }
  return pool[0];
}

/** 手动指定下一次从这一项开始，并清掉还没走完的轮数。 */
export function jumpSeq(mod: RandomModule, itemId: string): RandomModule {
  return { ...mod, nextId: itemId, hold: null };
}

export function setModuleRounds(bank: RandomBank, id: string, rounds: number): RandomBank {
  const n = Math.max(1, Math.floor(rounds) || 1);
  return {
    ...bank,
    modules: bank.modules.map((m) => {
      if (m.id !== id) return m;
      if (n <= 1) {
        const next = { ...m };
        delete next.rounds;
        return next;
      }
      return { ...m, rounds: n };
    }),
  };
}

/** 换随机或顺序时丢掉正在复用的那一项，下一张按新方式重抽。轮数保留。 */
export function setModulePick(bank: RandomBank, id: string, pick: RandomModule["pick"]): RandomBank {
  const mod = bank.modules.find((m) => m.id === id);
  if (!mod || mod.pick === pick) return bank;
  const comboHold = { ...(bank.comboHold ?? {}) };
  for (const key of Object.keys(comboHold)) {
    if (key.split("&").includes(mod.name)) delete comboHold[key];
  }
  return {
    ...bank,
    comboHold,
    modules: bank.modules.map((m) => (m.id === id ? { ...m, pick, hold: null } : m)),
  };
}

function tagRe() {
  return new RegExp(TAG_SRC, "g");
}

function namesOf(first: string, rest: string) {
  const names = [flatName(first)];
  for (const m of rest.matchAll(/&"([^"]+)"/g)) names.push(flatName(m[1]));
  return names;
}

function flatName(name: string) {
  return name.replace(/[ \t]*[\r\n]+[ \t]*/g, "");
}

export interface RanSpan {
  start: number;
  end: number;
  names: string[];
}

/** 语法完整、点到的模块都还在，才算活的块。缺一个名字整块不算。 */
export function liveRanSpans(text: string, moduleNames: Iterable<string>): RanSpan[] {
  const have = moduleNames instanceof Set ? moduleNames : new Set(moduleNames);
  const out: RanSpan[] = [];
  for (const m of text.matchAll(tagRe())) {
    const names = namesOf(m[1], m[2] || "").filter(Boolean);
    if (!names.length || names.some((name) => !have.has(name))) continue;
    out.push({ start: m.index, end: m.index + m[0].length, names });
  }
  return out;
}

/** 活的语法块后面空出骰子的位置。这不是提示词里的字，保存前会拿掉。 */
export const RAN_SLOT = "\u2003\u2003";

export function withRanSlots(text: string, moduleNames: Iterable<string>): string {
  const spans = liveRanSpans(text, moduleNames);
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.end) + RAN_SLOT;
    at = span.end;
  }
  return out + text.slice(at);
}

export function stripRanSlots(text: string): string {
  return text.replaceAll("\u2003", "");
}

export function cleanCaret(shown: string, caret: number): number {
  return stripRanSlots(shown.slice(0, Math.max(0, caret))).length;
}

function tagKeys(text: string) {
  const keys = new Set<string>();
  for (const m of text.matchAll(tagRe())) {
    const names = namesOf(m[1], m[2] || "");
    keys.add(names.length > 1 ? `&${names.join("&")}` : names[0]);
  }
  return keys;
}

function blob(p: PromptFields) {
  return [p.promptFront || "", p.promptMid || "", p.promptBack || "", p.negative || ""].join("\n");
}

/** 符号从这份提示词里消失，就忘掉它的顺序位置和轮数进度。没变化时返回 null。 */
export function forgetIfPrompt(bank: RandomBank, prev: PromptFields, next: PromptFields): RandomBank | null {
  const before = tagKeys(blob(prev));
  const after = tagKeys(blob(next));
  let modules = bank.modules;
  const combo = { ...(bank.comboLast ?? {}) };
  const comboHold = { ...(bank.comboHold ?? {}) };
  let changed = false;
  for (const key of before) {
    if (after.has(key)) continue;
    changed = true;
    if (key.startsWith("&")) {
      delete combo[key.slice(1)];
      delete comboHold[key.slice(1)];
    } else modules = modules.map((m) => (m.name === key ? { ...m, nextId: null, hold: null } : m));
  }
  if (!changed) return null;
  return { ...bank, modules, comboLast: combo, comboHold };
}

function enabledItems(mod: RandomModule) {
  return mod.items.filter((item) => item.enabled);
}

function indexOfNext(pool: RandomItem[], nextId?: string | null) {
  if (!nextId) return 0;
  const i = pool.findIndex((item) => item.id === nextId);
  return i >= 0 ? i : 0;
}

type Hold = { itemId: string; used: number };

function readHold(bank: RandomBank, names: string[]): Hold | null {
  if (names.length === 1) return bank.modules.find((m) => m.name === names[0])?.hold ?? null;
  return bank.comboHold?.[names.join("&")] ?? null;
}

function writeHold(bank: RandomBank, names: string[], hold: Hold): RandomBank {
  if (names.length === 1) {
    const name = names[0];
    return { ...bank, modules: bank.modules.map((m) => (m.name === name ? { ...m, hold } : m)) };
  }
  const key = names.join("&");
  return { ...bank, comboHold: { ...(bank.comboHold ?? {}), [key]: hold } };
}

function pickFresh(
  names: string[],
  unique: RandomModule[],
  pool: RandomItem[],
  bank: RandomBank,
  rng: () => number,
): { value: string; itemId: string; bank: RandomBank } {
  const allSeq = unique.every((mod) => mod.pick === "seq");
  if (!allSeq) {
    const item = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    return { value: item.content.trim(), itemId: item.id, bank };
  }
  if (names.length === 1) {
    const mod = unique[0];
    const idx = indexOfNext(pool, mod.nextId);
    const item = pool[idx];
    const next = pool[(idx + 1) % pool.length];
    return {
      value: item.content.trim(),
      itemId: item.id,
      bank: { ...bank, modules: bank.modules.map((m) => (m.id === mod.id ? { ...m, nextId: next.id } : m)) },
    };
  }
  const key = names.join("&");
  const idx = indexOfNext(pool, bank.comboLast?.[key]);
  const item = pool[idx];
  const next = pool[(idx + 1) % pool.length];
  return {
    value: item.content.trim(),
    itemId: item.id,
    bank: { ...bank, comboLast: { ...(bank.comboLast ?? {}), [key]: next.id } },
  };
}

function resolve(
  names: string[],
  bank: RandomBank,
  rng: () => number,
  used?: Set<string>,
): { value: string; bank: RandomBank; missing: string[] } {
  const unique: RandomModule[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const mod = bank.modules.find((m) => m.name === name);
    if (!mod) missing.push(name);
    else if (!unique.includes(mod)) unique.push(mod);
  }
  const pool = unique.flatMap((mod) => enabledItems(mod));
  if (!pool.length) {
    for (const mod of unique) if (!missing.includes(mod.name)) missing.push(mod.name);
    return { value: "", bank, missing };
  }
  const rounds = Math.min(...unique.map(moduleRounds));
  const hold = readHold(bank, names);
  const held = hold ? pool.find((item) => item.id === hold.itemId) : undefined;
  if (hold && held && hold.used < rounds) {
    used?.add(held.id);
    return { value: held.content.trim(), bank: writeHold(bank, names, { itemId: held.id, used: hold.used + 1 }), missing };
  }
  const picked = pickFresh(names, unique, pool, bank, rng);
  used?.add(picked.itemId);
  return { value: picked.value, bank: writeHold(picked.bank, names, { itemId: picked.itemId, used: 1 }), missing };
}

function expandField(
  text: string,
  bank: RandomBank,
  rng: () => number,
  missing: string[],
  seen: Map<string, string>,
  used: Set<string>,
) {
  let next = bank;
  const stack = new Set<string>();
  const walk = (src: string, depth: number): string => {
    if (depth > 8 || !src.includes("<ran_id=")) return src;
    return src.replace(tagRe(), (full, first: string, rest: string) => {
      const names = namesOf(first, rest || "");
      const key = names.length > 1 ? names.join("&") : names[0];
      const cached = seen.get(key);
      if (cached !== undefined) return cached;
      if (stack.has(key)) return full;
      stack.add(key);
      const got = resolve(names, next, rng, used);
      next = got.bank;
      missing.push(...got.missing);
      const inner = walk(got.value, depth + 1);
      stack.delete(key);
      seen.set(key, inner);
      return inner;
    });
  };
  return { text: walk(text, 0), bank: next };
}

/** 开关关着时原样返回，符号当普通字。开着时换成选中的内容，并推进顺序和轮数。同一张图里同一个符号只算一轮。 */
export function expandParams(
  params: ImageParams,
  bank: RandomBank | undefined,
  rng: () => number = Math.random,
  opts?: { fillMissing?: boolean },
) {
  if (!bank?.enabled) return { params, bank, missing: [] as string[], charMissing: [] as number[], usedItemIds: [] as string[] };
  const missing: string[] = [];
  const seen = new Map<string, string>();
  const used = new Set<string>();
  let next = bank;
  const apply = (text: string) => {
    const got = expandField(text || "", next, rng, missing, seen, used);
    next = got.bank;
    return got.text;
  };
  const slotted = applyPromptSlots(
    params,
    {
      promptFront: apply(params.promptFront),
      promptMid: apply(params.promptMid),
      promptBack: apply(params.promptBack),
      negative: apply(params.negative),
    },
    opts?.fillMissing === true,
  );
  return {
    params: slotted.params,
    bank: next,
    missing: [...new Set(missing)],
    charMissing: slotted.charMissing,
    usedItemIds: [...used],
  };
}

function holdKey(hold?: Hold | null) {
  return hold ? `${hold.itemId}:${hold.used}` : "";
}

/** 出图成功后，把这次推进写回现在的随机库。画的过程中用户改过的位置不动。 */
export function mergeDrawProgress(before: RandomBank, after: RandomBank, current: RandomBank): RandomBank {
  let modChanged = false;
  const modules = current.modules.map((cur) => {
    const pre = before.modules.find((m) => m.id === cur.id);
    const post = after.modules.find((m) => m.id === cur.id);
    if (!pre || !post) return cur;
    if ((cur.nextId ?? null) !== (pre.nextId ?? null) || holdKey(cur.hold) !== holdKey(pre.hold)) return cur;
    if ((post.nextId ?? null) === (cur.nextId ?? null) && holdKey(post.hold) === holdKey(cur.hold)) return cur;
    modChanged = true;
    return { ...cur, nextId: post.nextId ?? null, hold: post.hold ?? null };
  });
  const comboLast = { ...(current.comboLast ?? {}) };
  let comboChanged = false;
  const keys = new Set([
    ...Object.keys(before.comboLast ?? {}),
    ...Object.keys(after.comboLast ?? {}),
    ...Object.keys(current.comboLast ?? {}),
  ]);
  for (const key of keys) {
    const pre = before.comboLast?.[key] ?? null;
    const cur = current.comboLast?.[key] ?? null;
    if (cur !== pre) continue;
    const post = after.comboLast?.[key] ?? null;
    if (post === cur) continue;
    comboChanged = true;
    if (post == null) delete comboLast[key];
    else comboLast[key] = post;
  }
  const comboHold = { ...(current.comboHold ?? {}) };
  let holdChanged = false;
  const holdKeys = new Set([
    ...Object.keys(before.comboHold ?? {}),
    ...Object.keys(after.comboHold ?? {}),
    ...Object.keys(current.comboHold ?? {}),
  ]);
  for (const key of holdKeys) {
    if (holdKey(current.comboHold?.[key]) !== holdKey(before.comboHold?.[key])) continue;
    const post = after.comboHold?.[key];
    if (holdKey(post) === holdKey(current.comboHold?.[key])) continue;
    holdChanged = true;
    if (post) comboHold[key] = post;
    else delete comboHold[key];
  }
  if (!modChanged && !comboChanged && !holdChanged) return current;
  return {
    ...current,
    ...(modChanged ? { modules } : {}),
    ...(comboChanged ? { comboLast } : {}),
    ...(holdChanged ? { comboHold: Object.keys(comboHold).length ? comboHold : undefined } : {}),
  };
}

export function setShownItems(bank: RandomBank, ids: string[]): RandomBank {
  const next = [...new Set(ids.filter((id) => typeof id === "string" && id))];
  const prev = bank.shownItemIds ?? [];
  if (prev.length === next.length && prev.every((id, i) => id === next[i])) return bank;
  return { ...bank, shownItemIds: next };
}

export interface RandomSnapModule {
  id: string;
  name: string;
  pick: "random" | "seq";
  rounds: number;
  itemId?: string;
  used?: number;
  enabled: Record<string, boolean>;
}

export interface RandomSnapCombo {
  key: string;
  itemId: string;
  used: number;
  rounds: number;
}

export interface RandomSnap {
  modules: RandomSnapModule[];
  combos?: RandomSnapCombo[];
}

/** 这张图用过的模块。不含图片。随机一轮记成下次再走一次同一条。 */
export function captureRandomSnap(before: RandomBank, after: RandomBank, usedIds: string[]): RandomSnap | undefined {
  const used = new Set(usedIds.filter((id) => typeof id === "string" && id));
  if (!used.size) return;
  const modules: RandomSnapModule[] = [];
  const seen = new Set<string>();
  const push = (mod: RandomModule, itemId?: string, usedCount?: number) => {
    if (seen.has(mod.id)) return;
    seen.add(mod.id);
    modules.push({
      id: mod.id,
      name: mod.name,
      pick: mod.pick === "seq" ? "seq" : "random",
      rounds: moduleRounds(mod),
      ...(itemId ? { itemId, used: usedCount ?? 1 } : {}),
      enabled: Object.fromEntries(mod.items.map((item) => [item.id, item.enabled])),
    });
  };
  for (const mod of after.modules) {
    const itemId = mod.hold?.itemId;
    if (itemId && used.has(itemId)) push(mod, itemId, mod.hold?.used ?? 1);
  }
  const combos: RandomSnapCombo[] = [];
  for (const [key, hold] of Object.entries(after.comboHold ?? {})) {
    if (!hold || !used.has(hold.itemId)) continue;
    const prev = before.comboHold?.[key];
    if (prev && prev.itemId === hold.itemId && prev.used === hold.used) continue;
    const found = key.split("&").map((name) => after.modules.find((m) => m.name === name));
    if (found.some((m) => !m)) continue;
    const present = found.filter((m): m is RandomModule => !!m);
    combos.push({ key, itemId: hold.itemId, used: hold.used, rounds: Math.min(...present.map(moduleRounds)) });
    for (const mod of present) push(mod);
  }
  if (!modules.length && !combos.length) return;
  return { modules, ...(combos.length ? { combos } : {}) };
}

/** 填入、应用参数、插入(中)。勾选、轮数、顺序或随机照这张图。顺序从第一个亮着的项第 1 次开始。随机清掉抽中项，下一张重抽并算第 1 次。 */
export function restoreRandomSnap(bank: RandomBank, snap: RandomSnap | undefined): RandomBank {
  if (!snap?.modules?.length && !snap?.combos?.length) return bank;
  let changed = false;
  const modules = bank.modules.map((mod) => {
    const byId = snap.modules?.find((row) => row.id === mod.id);
    const byName = (snap.modules ?? []).filter((row) => row.name === mod.name);
    const row = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (!row) return mod;
    changed = true;
    const flags = row.enabled ?? {};
    const items = mod.items.map((item) => (item.id in flags ? { ...item, enabled: flags[item.id] === true } : item));
    const pool = items.filter((item) => item.enabled);
    const seq = row.pick === "seq";
    const next: RandomModule = {
      ...mod,
      items,
      pick: seq ? "seq" : "random",
      nextId: seq ? (pool[0]?.id ?? null) : null,
      hold: null,
    };
    if ((row.rounds ?? 1) > 1) next.rounds = Math.floor(row.rounds);
    else delete next.rounds;
    return next;
  });
  const comboHold = { ...(bank.comboHold ?? {}) };
  const comboLast = { ...(bank.comboLast ?? {}) };
  let comboChanged = false;
  for (const combo of snap.combos ?? []) {
    const found = combo.key.split("&").map((name) => modules.find((m) => m.name === name));
    if (found.some((m) => !m)) continue;
    const present = found.filter((m): m is RandomModule => !!m);
    if (!present.some((m) => m.items.some((item) => item.id === combo.itemId && item.enabled))) continue;
    comboChanged = true;
    delete comboHold[combo.key];
    delete comboLast[combo.key];
  }
  if (!changed && !comboChanged) return bank;
  return {
    ...bank,
    ...(changed ? { modules } : {}),
    ...(comboChanged ? { comboHold, comboLast } : {}),
  };
}

export function snapHasRandomItems(snap: RandomSnap | undefined) {
  return (snap?.modules ?? []).some((row) => Object.keys(row.enabled ?? {}).length > 0);
}

function sameEnabled(a: Record<string, boolean>, b: Record<string, boolean>) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((id) => b[id] === a[id]);
}

/** 用现在模块里的开关改收藏记下的勾选。只动这条里已有的模块。轮数、顺序或随机、抽中项不动。 */
export function refreshSnapEnabled(snap: RandomSnap, bank: RandomBank): RandomSnap {
  let changed = false;
  const modules = snap.modules.map((row) => {
    const byId = bank.modules.find((mod) => mod.id === row.id);
    const byName = bank.modules.filter((mod) => mod.name === row.name);
    const mod = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (!mod) return row;
    const enabled = Object.fromEntries(mod.items.map((item) => [item.id, item.enabled === true]));
    if (sameEnabled(row.enabled ?? {}, enabled)) return row;
    changed = true;
    return { ...row, enabled };
  });
  return changed ? { ...snap, modules } : snap;
}

export interface RanDraft {
  id: string;
  name: string;
  pick: "random" | "seq";
  rounds: number;
  nextId: string | null;
  enabled: Record<string, boolean>;
}

export function ranDraftOf(mod: RandomModule): RanDraft {
  return {
    id: mod.id,
    name: mod.name,
    pick: mod.pick === "seq" ? "seq" : "random",
    rounds: moduleRounds(mod),
    nextId: mod.nextId ?? null,
    enabled: Object.fromEntries(mod.items.map((item) => [item.id, item.enabled === true])),
  };
}

export function ranDraftDirty(mod: RandomModule, draft: RanDraft): boolean {
  if ((mod.pick === "seq" ? "seq" : "random") !== (draft.pick === "seq" ? "seq" : "random")) return true;
  if (moduleRounds(mod) !== Math.max(1, Math.floor(draft.rounds) || 1)) return true;
  const enabled = Object.fromEntries(mod.items.map((item) => [item.id, item.enabled === true]));
  if (!sameEnabled(enabled, draft.enabled)) return true;
  if (draft.pick === "seq" && (mod.nextId ?? null) !== (draft.nextId ?? null)) return true;
  return false;
}

function dropComboKeys(modName: string, comboHold: Record<string, { itemId: string; used: number }>, comboLast: Record<string, string>) {
  let changed = false;
  for (const key of Object.keys(comboHold)) {
    if (!key.split("&").includes(modName)) continue;
    delete comboHold[key];
    changed = true;
  }
  for (const key of Object.keys(comboLast)) {
    if (!key.split("&").includes(modName)) continue;
    delete comboLast[key];
    changed = true;
  }
  return changed;
}

/** 把弹窗草稿写进模块。没改的不动。改了勾选、轮数或顺序/随机，就清掉这一轮还没走完的次数。 */
export function commitRanDrafts(bank: RandomBank, drafts: RanDraft[]): RandomBank {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const comboHold = { ...(bank.comboHold ?? {}) };
  const comboLast = { ...(bank.comboLast ?? {}) };
  let comboChanged = false;
  const modules = bank.modules.map((mod) => {
    const draft = byId.get(mod.id);
    if (!draft || !ranDraftDirty(mod, draft)) return mod;
    const rounds = Math.max(1, Math.floor(draft.rounds) || 1);
    const pick = draft.pick === "seq" ? "seq" : "random";
    const items = mod.items.map((item) => {
      const flag = draft.enabled[item.id];
      if (typeof flag !== "boolean" || flag === (item.enabled === true)) return item;
      return { ...item, enabled: flag };
    });
    const pool = items.filter((item) => item.enabled);
    const next: RandomModule = { ...mod, items, pick, hold: null };
    if (pick === "seq") next.nextId = draft.nextId && pool.some((item) => item.id === draft.nextId) ? draft.nextId : (pool[0]?.id ?? null);
    else next.nextId = null;
    if (rounds > 1) next.rounds = rounds;
    else delete next.rounds;
    if (dropComboKeys(mod.name, comboHold, comboLast)) comboChanged = true;
    return next;
  });
  if (!comboChanged && modules.every((mod, i) => mod === bank.modules[i])) return bank;
  return { ...bank, modules, comboHold, comboLast };
}

/** 收藏里改过的模块，同步这一条记下的勾选、轮数、顺序或随机。抽中哪一项不动。 */
export function patchSnapFromDrafts(snap: RandomSnap, bank: RandomBank, drafts: RanDraft[]): RandomSnap {
  const dirty = drafts.filter((draft) => {
    const mod = bank.modules.find((row) => row.id === draft.id);
    return !!mod && ranDraftDirty(mod, draft);
  });
  if (!dirty.length || !snap.modules?.length) return snap;
  let changed = false;
  const modules = snap.modules.map((row) => {
    const byId = dirty.find((draft) => draft.id === row.id);
    const byName = dirty.filter((draft) => bank.modules.find((mod) => mod.id === draft.id)?.name === row.name);
    const draft = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (!draft) return row;
    changed = true;
    const rounds = Math.max(1, Math.floor(draft.rounds) || 1);
    const pick: "random" | "seq" = draft.pick === "seq" ? "seq" : "random";
    return {
      ...row,
      pick,
      rounds,
      enabled: { ...draft.enabled },
    };
  });
  return changed ? { ...snap, modules } : snap;
}

export function applyScheme(items: RandomItem[], scheme: RandomScheme, mode: "replace" | "union") {
  return items.map((item) => {
    const flag = scheme.enabled[item.id];
    if (typeof flag !== "boolean") return item;
    if (mode === "union") return flag && !item.enabled ? { ...item, enabled: true } : item;
    return flag === item.enabled ? item : { ...item, enabled: flag };
  });
}

function parseItem(raw: unknown): RandomItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<RandomItem>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const item: RandomItem = {
    id: row.id,
    name: row.name,
    content: typeof row.content === "string" ? row.content : "",
    enabled: row.enabled !== false,
  };
  if (typeof row.sourceId === "string" && row.sourceId) item.sourceId = row.sourceId;
  if (row.nameCustom === true) item.nameCustom = true;
  return item;
}

export function parseRandomBank(raw: unknown): RandomBank {
  const empty = emptyBank();
  if (!raw || typeof raw !== "object") return empty;
  const row = raw as Partial<RandomBank>;
  const modules: RandomModule[] = [];
  if (Array.isArray(row.modules)) {
    for (const mod of row.modules) {
      if (!mod || typeof mod !== "object") continue;
      const m = mod as Partial<RandomModule>;
      if (typeof m.id !== "string" || typeof m.name !== "string" || !m.name.trim()) continue;
      if (modules.some((x) => x.name === m.name || x.id === m.id)) continue;
      const items = Array.isArray(m.items) ? m.items.map(parseItem).filter((x): x is RandomItem => !!x) : [];
      const rounds = moduleRounds(m as RandomModule);
      const hold = parseHold(m.hold);
      const schemes = parseSchemes(m.schemes);
      modules.push({
        id: m.id,
        name: m.name.trim(),
        pick: m.pick === "seq" ? "seq" : "random",
        items,
        nextId: typeof m.nextId === "string" ? m.nextId : null,
        ...(rounds > 1 ? { rounds } : {}),
        ...(hold ? { hold } : {}),
        ...(m.linked === "appearances" ? { linked: "appearances" as const } : {}),
        groupId: typeof m.groupId === "string" ? m.groupId : null,
        ...(m.starred === true ? { starred: true } : {}),
        order: Number.isFinite(Number(m.order)) ? Number(m.order) : modules.length,
        ...(schemes.length ? { schemes } : {}),
      });
    }
  }
  const groups = parseGroups(row.groups);
  const groupIds = new Set(groups.map((g) => g.id));
  for (const mod of modules) {
    if (mod.groupId && !groupIds.has(mod.groupId)) mod.groupId = null;
  }
  const comboLast: Record<string, string> = {};
  if (row.comboLast && typeof row.comboLast === "object") {
    for (const [k, v] of Object.entries(row.comboLast)) {
      if (typeof v === "string") comboLast[k] = v;
    }
  }
  const comboHold: Record<string, Hold> = {};
  if (row.comboHold && typeof row.comboHold === "object") {
    for (const [k, v] of Object.entries(row.comboHold)) {
      const hold = parseHold(v);
      if (hold) comboHold[k] = hold;
    }
  }
  const poolHeight = poolHeightOf(row.poolHeight);
  const shownItemIds = Array.isArray(row.shownItemIds)
    ? [...new Set(row.shownItemIds.filter((id): id is string => typeof id === "string" && !!id))]
    : [];
  return {
    enabled: row.enabled === true,
    modules,
    comboLast,
    ...(Object.keys(comboHold).length ? { comboHold } : {}),
    ...(row.appearanceModuleDismissed === true ? { appearanceModuleDismissed: true } : {}),
    ...(groups.length ? { groups } : {}),
    ...(poolHeight != null ? { poolHeight } : {}),
    ...(shownItemIds.length ? { shownItemIds } : {}),
  };
}

function poolHeightOf(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(216, Math.min(1200, Math.round(n)));
}

function parseGroups(raw: unknown): RandomGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: RandomGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Partial<RandomGroup>;
    if (typeof g.id !== "string" || typeof g.name !== "string" || !g.name.trim()) continue;
    if (groups.some((x) => x.id === g.id)) continue;
    groups.push({
      id: g.id,
      name: g.name.trim(),
      parentId: typeof g.parentId === "string" ? g.parentId : null,
      collapsed: g.collapsed !== false,
      order: Number.isFinite(Number(g.order)) ? Number(g.order) : groups.length,
      ...(g.starred === true ? { starred: true } : {}),
    });
  }
  const ids = new Set(groups.map((g) => g.id));
  for (const g of groups) {
    if (g.parentId && !ids.has(g.parentId)) g.parentId = null;
  }
  const seen = new Set<string>();
  const clean = (id: string | null): boolean => {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const parent = groups.find((g) => g.id === id)?.parentId ?? null;
    const ok = clean(parent);
    seen.delete(id);
    return ok;
  };
  for (const g of groups) {
    if (!clean(g.id)) g.parentId = null;
  }
  return groups;
}

export function orderedGroups(
  bank: RandomBank,
  parentId: string | null,
  orders?: Record<string, number>,
  pinStars = true,
) {
  return (bank.groups ?? [])
    .filter((g) => (g.parentId ?? null) === parentId)
    .sort((a, b) => compareTree(a, b, orders, pinStars));
}

export function orderedModules(
  bank: RandomBank,
  parentId: string | null,
  orders?: Record<string, number>,
  pinStars = true,
) {
  return bank.modules
    .filter((m) => (m.groupId ?? null) === parentId)
    .sort((a, b) => compareTree(a, b, orders, pinStars));
}

function compareTree(
  a: { id: string; order?: number; starred?: boolean },
  b: { id: string; order?: number; starred?: boolean },
  orders: Record<string, number> | undefined,
  pinStars: boolean,
) {
  if (pinStars && Boolean(a.starred) !== Boolean(b.starred)) return a.starred ? -1 : 1;
  return (orders?.[a.id] ?? a.order ?? 0) - (orders?.[b.id] ?? b.order ?? 0);
}

export function groupDescendants(groups: RandomGroup[], id: string) {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const g of groups) {
      if (g.parentId !== pid) continue;
      out.push(g.id);
      walk(g.id);
    }
  };
  walk(id);
  return out;
}

export function deleteRandomGroup(bank: RandomBank, id: string): RandomBank {
  const drop = new Set([id, ...groupDescendants(bank.groups ?? [], id)]);
  const hitLinked = bank.modules.some((m) => m.linked === "appearances" && m.groupId && drop.has(m.groupId));
  return {
    ...bank,
    groups: (bank.groups ?? []).filter((g) => !drop.has(g.id)),
    modules: bank.modules.filter((m) => !(m.groupId && drop.has(m.groupId))),
    ...(hitLinked ? { appearanceModuleDismissed: true } : {}),
  };
}

/** 打开随机设置时调用。联动的「角色」不在了，就在最外层补一份。 */
export function reviveAppearanceModule(bank: RandomBank | undefined, appearances: AppearanceSnap[]): RandomBank {
  const base = bank ?? emptyBank();
  if (base.modules.some((m) => m.linked === "appearances")) return base;
  const ordered = [...appearances].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!ordered.length) return base;
  if (base.modules.some((m) => m.name === APPEARANCE_MODULE_NAME)) return base;
  const siblings = base.modules.filter((m) => (m.groupId ?? null) === null);
  const order = siblings.reduce((n, m) => Math.max(n, m.order ?? 0), -1) + 1;
  const mod = { ...fillLinked(blankLinked(), ordered), groupId: null, order };
  return { ...base, appearanceModuleDismissed: false, modules: [...base.modules, mod] };
}

function parseHold(raw: unknown): Hold | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<Hold>;
  const used = Math.floor(Number(row.used));
  if (typeof row.itemId !== "string" || !row.itemId || !Number.isFinite(used) || used < 0) return null;
  return { itemId: row.itemId, used };
}

export type AppearanceSnap = { id: string; name: string; prompt: string; order: number };

function blankLinked(): RandomModule {
  return {
    id: uid("rm_"),
    name: APPEARANCE_MODULE_NAME,
    pick: "random",
    items: [],
    nextId: null,
    linked: "appearances",
  };
}

function fillLinked(mod: RandomModule, ordered: AppearanceSnap[]): RandomModule {
  const prev = new Map(mod.items.filter((item) => item.sourceId).map((item) => [item.sourceId as string, item]));
  const items = ordered.map((a) => {
    const old = prev.get(a.id);
    if (!old) {
      return { id: uid("ri_"), name: a.name, content: a.prompt, enabled: false, sourceId: a.id };
    }
    const custom = old.nameCustom === true;
    return {
      id: old.id,
      name: custom ? old.name : a.name,
      content: a.prompt,
      enabled: old.enabled,
      sourceId: a.id,
      ...(custom ? { nameCustom: true as const } : {}),
    };
  });
  const nextId = items.some((item) => item.id === mod.nextId) ? mod.nextId ?? null : null;
  const hold = mod.hold && items.some((item) => item.id === mod.hold?.itemId) ? mod.hold : null;
  return { ...mod, name: APPEARANCE_MODULE_NAME, linked: "appearances", items, nextId, hold };
}

function sameItem(a: RandomItem, b: RandomItem) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.content === b.content &&
    a.enabled === b.enabled &&
    (a.sourceId ?? "") === (b.sourceId ?? "") &&
    a.nameCustom === b.nameCustom
  );
}

function sameLinked(a: RandomModule, b: RandomModule) {
  if (a.name !== b.name || a.linked !== b.linked || (a.nextId ?? null) !== (b.nextId ?? null)) return false;
  if (a.items.length !== b.items.length) return false;
  return a.items.every((item, i) => sameItem(item, b.items[i]));
}

/** ensure：没有就按现有角色建一份，用户删掉过则不动。create：新保存了角色，删掉过也要再建。update：只刷新已经在的那份。 */
export function syncAppearanceModule(
  bank: RandomBank | undefined,
  appearances: AppearanceSnap[],
  mode: "ensure" | "create" | "update",
): RandomBank {
  const base = bank ?? emptyBank();
  const ordered = [...appearances].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const linked = base.modules.find((m) => m.linked === "appearances");
  if (!linked) {
    const blocked =
      mode === "update" || (mode === "ensure" && (base.appearanceModuleDismissed === true || ordered.length === 0));
    if (blocked) return base;
    if (base.modules.some((m) => m.name === APPEARANCE_MODULE_NAME)) return base;
    return {
      ...base,
      appearanceModuleDismissed: false,
      modules: [...base.modules, fillLinked(blankLinked(), ordered)],
    };
  }
  const filled = fillLinked(linked, ordered);
  const dismissed = mode === "create" ? false : base.appearanceModuleDismissed;
  if (sameLinked(linked, filled) && dismissed === base.appearanceModuleDismissed) return base;
  return {
    ...base,
    appearanceModuleDismissed: dismissed,
    modules: base.modules.map((m) => (m.id === linked.id ? filled : m)),
  };
}

/** 复制是快照。不带走角色选择的关联，之后两边互不影响。 */
export function duplicateRandomModule(mod: RandomModule, modules: RandomModule[]): RandomModule {
  const base = `${mod.name}(副本)`;
  let name = base;
  let n = 2;
  while (modules.some((m) => m.name === name)) {
    name = `${base}${n}`;
    n += 1;
  }
  const idMap = new Map<string, string>();
  const items = mod.items.map((item) => {
    const id = uid("ri_");
    idMap.set(item.id, id);
    return { id, name: item.name, content: item.content, enabled: item.enabled };
  });
  const schemes = (mod.schemes ?? []).map((scheme) => {
    const enabled: Record<string, boolean> = {};
    for (const [from, on] of Object.entries(scheme.enabled)) {
      const id = idMap.get(from);
      if (id) enabled[id] = on;
    }
    return { ...scheme, id: uid("rs_"), enabled };
  });
  return {
    id: uid("rm_"),
    name,
    pick: mod.pick,
    nextId: null,
    ...(moduleRounds(mod) > 1 ? { rounds: moduleRounds(mod) } : {}),
    groupId: mod.groupId ?? null,
    starred: false,
    order: modules.filter((m) => (m.groupId ?? null) === (mod.groupId ?? null)).reduce((max, m) => Math.max(max, m.order ?? 0), -1) + 1,
    items,
    ...(schemes.length ? { schemes } : {}),
  };
}

function parseSchemes(raw: unknown): RandomScheme[] {
  if (!Array.isArray(raw)) return [];
  const schemes: RandomScheme[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RandomScheme>;
    if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) continue;
    if (schemes.some((scheme) => scheme.id === row.id)) continue;
    const enabled: Record<string, boolean> = {};
    if (row.enabled && typeof row.enabled === "object") {
      for (const [id, on] of Object.entries(row.enabled)) {
        if (id && typeof on === "boolean") enabled[id] = on;
      }
    }
    schemes.push({
      id: row.id,
      name: row.name.trim(),
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : schemes.length,
      enabled,
    });
  }
  return schemes;
}

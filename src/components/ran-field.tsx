import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Dice5, Settings, X } from "lucide-react";
import { useApp } from "@/lib/store";
import {
  applyScheme,
  commitRanDrafts,
  liveRanSpans,
  patchSnapFromDrafts,
  RAN_SLOT,
  ranDraftDirty,
  ranDraftOf,
  seqTurnItem,
  moduleRounds,
  withRanSlots,
  cleanCaret,
  type RanDraft,
  type RandomModule,
  type RandomScheme,
} from "@/lib/random-prompt";
import { LibraryDrawer } from "./LibraryDrawer";
import { RandomSettings } from "./RandomPanels";
import { groupAt, isMostlyChinese, promptSegments, replaceWeightBody } from "@/lib/prompt-groups";
import { tagGloss } from "@/lib/tags";
import { translateText } from "@/lib/translate";

function caretLine(el: HTMLTextAreaElement, position: number) {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "padding", "textIndent", "tabSize", "whiteSpace", "overflowWrap", "wordBreak"] as const) {
    mirror.style[property] = style[property];
  }
  Object.assign(mirror.style, {
    position: "fixed",
    left: "0",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    boxSizing: "border-box",
    width: `${el.clientWidth}px`,
  });
  mirror.textContent = el.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(position) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const caret = marker.getClientRects()[0];
  const bounds = el.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || 22;
  mirror.remove();
  if (!caret) return null;
  const y = bounds.top + el.clientTop + caret.top - el.scrollTop;
  const x = bounds.left + el.clientLeft + caret.left - el.scrollLeft;
  if (y < bounds.top - 1 || y + lineHeight > bounds.bottom + 1) return null;
  return { x: Math.min(bounds.right - 8, Math.max(bounds.left + 2, x)), y, h: lineHeight };
}

export function RanMarks({
  text,
  box,
  favId,
  onInsert,
  onChange,
}: {
  text: string;
  box: RefObject<HTMLTextAreaElement | null>;
  favId?: string;
  onInsert?: (piece: string, how?: "comma" | "line") => void;
  onChange?: (next: string) => void;
}) {
  const modules = useApp((s) => s.settings.random?.modules);
  const names = useMemo(() => (modules ?? []).map((mod) => mod.name), [modules]);
  const known = useMemo(() => new Set(names), [names]);
  const glossOn = useApp((s) => s.settings.promptGloss !== false);
  const netOn = useApp((s) => s.settings.promptNet === true);
  const spans = useMemo(() => liveRanSpans(text, names), [text, names]);
  const shown = useMemo(() => withRanSlots(text, names), [text, names]);
  const segs = useMemo(() => promptSegments(shown, (list) => list.length > 0 && list.every((name) => known.has(name))), [shown, known]);
  const view = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [hit, setHit] = useState<string[] | null>(null);
  const [settings, setSettings] = useState(false);
  const [bubble, setBubble] = useState<{
    index: number;
    body: string;
    zh: string;
    top: number;
    left: number;
    anchorX: number;
    anchorY: number;
    anchorH: number;
    maxW: number;
    replace: boolean;
  } | null>(null);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const [netGloss, setNetGloss] = useState<Record<string, string>>({});
  const netReq = useRef(0);
  useLayoutEffect(() => {
    const el = box.current;
    const mirror = view.current;
    if (!el || !mirror) return;
    const fit = () => {
      const style = getComputedStyle(el);
      mirror.style.left = `${parseFloat(style.borderLeftWidth) || 0}px`;
      mirror.style.top = `${parseFloat(style.borderTopWidth) || 0}px`;
      mirror.style.width = `${el.clientWidth}px`;
      mirror.style.height = `${el.clientHeight}px`;
      mirror.scrollTop = el.scrollTop;
    };
    fit();
    el.addEventListener("scroll", fit);
    const obs = new ResizeObserver(fit);
    obs.observe(el);
    return () => {
      el.removeEventListener("scroll", fit);
      obs.disconnect();
    };
  }, [box, text, spans.length]);
  useEffect(() => {
    if (!netOn) return;
    const seen = new Set<string>();
    for (const seg of segs) {
      if (seg.kind !== "text") continue;
      const body = seg.body.trim();
      if (!body || body.length > 500 || seen.has(body) || netGloss[body] !== undefined) continue;
      seen.add(body);
      const to = isMostlyChinese(body) ? "en" : !tagGloss(body) && /\p{L}/u.test(body) ? "zh" : null;
      if (!to) continue;
      void translateText(body, to)
        .then((value) => {
          setNetGloss((cur) => (cur[body] !== undefined ? cur : { ...cur, [body]: value }));
        })
        .catch(() => {
          setNetGloss((cur) => (cur[body] !== undefined ? cur : { ...cur, [body]: "" }));
        });
    }
  }, [netOn, segs, netGloss]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!glossOn) {
      setBubble(null);
      return;
    }
    const place = (toggle: boolean) => {
      if (document.activeElement !== el) {
        setBubble(null);
        return;
      }
      const caret = el.selectionStart ?? 0;
      if ((el.selectionEnd ?? 0) !== caret) {
        setBubble(null);
        return;
      }
      const found = groupAt(segs, caret);
      if (!found) {
        setBubble(null);
        return;
      }
      const body = found.seg.body.trim();
      const current = bubbleRef.current;
      if (toggle && current && current.index === found.index && current.body === body) {
        setBubble(null);
        return;
      }
      const line = caretLine(el, caret);
      if (!line) {
        setBubble(null);
        return;
      }
      const chinese = isMostlyChinese(body);
      const local = chinese ? null : tagGloss(body);
      const fetched = netGloss[body];
      const gloss = local || fetched || "";
      if (!gloss && (!netOn || fetched === "")) {
        setBubble(null);
        return;
      }
      setBubble({
        index: found.index,
        body,
        zh: gloss || "翻译中",
        top: line.y,
        left: line.x,
        anchorX: line.x,
        anchorY: line.y,
        anchorH: line.h,
        maxW: Math.min(360, window.innerWidth - 24),
        replace: chinese && !!gloss,
      });
      if (gloss || !netOn || body.length > 500 || !/\p{L}/u.test(body)) return;
      const ticket = ++netReq.current;
      const to = chinese ? "en" : "zh";
      void translateText(body, to, true)
        .then((value) => {
          if (ticket !== netReq.current) return;
          setNetGloss((cur) => ({ ...cur, [body]: value }));
          setBubble((cur) => (cur && cur.body === body ? { ...cur, zh: value, replace: chinese } : cur));
        })
        .catch(() => {
          if (ticket !== netReq.current) return;
          setNetGloss((cur) => ({ ...cur, [body]: "" }));
          setBubble((cur) => (cur && cur.body === body ? null : cur));
        });
    };
    const arrows = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (arrows.has(event.key)) return;
      setBubble(null);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (arrows.has(event.key)) place(false);
    };
    const onClick = () => place(true);
    const hide = () => setBubble(null);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);
    el.addEventListener("input", hide);
    el.addEventListener("scroll", hide);
    el.addEventListener("blur", hide);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("input", hide);
      el.removeEventListener("scroll", hide);
      el.removeEventListener("blur", hide);
    };
  }, [box, glossOn, netOn, segs, netGloss]);
  useLayoutEffect(() => {
    const node = pop.current;
    if (!node || !bubble) return;
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.min(360, Math.max(96, vw - pad * 2));
    node.style.maxWidth = `${maxW}px`;
    node.style.left = `${pad}px`;
    node.style.top = `${pad}px`;
    node.style.transform = "none";
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = bubble.anchorX;
    if (left + width > vw - pad) left = vw - pad - width;
    if (left < pad) left = pad;
    const gap = 8;
    let top = bubble.anchorY - height - gap;
    if (top < pad) top = bubble.anchorY + bubble.anchorH + gap;
    if (top < pad || top + height > vh - pad) {
      node.style.visibility = "hidden";
      return;
    }
    node.style.visibility = "";
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [bubble]);
  useEffect(() => {
    if (!bubble) return;
    const hide = () => setBubble(null);
    document.addEventListener("scroll", hide, true);
    return () => document.removeEventListener("scroll", hide, true);
  }, [bubble]);
  if (!spans.length && !glossOn) return null;
  const swap = (index: number, english: string) => {
    let at = 0;
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]!;
      if (i === index && seg.kind === "text") {
        const start = cleanCaret(shown, at);
        const end = cleanCaret(shown, at + seg.text.length);
        onChange?.(text.slice(0, start) + replaceWeightBody(seg.text, english) + text.slice(end));
        setBubble(null);
        return;
      }
      at += seg.text.length;
    }
  };
  return (
    <>
      <div
        ref={view}
        className="pointer-events-none absolute z-10 overflow-hidden whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] leading-relaxed text-transparent"
      >
        {segs.map((seg, i) =>
          seg.kind === "ran" ? (
            <span key={i} className="underline decoration-primary decoration-dashed decoration-1 underline-offset-[3px]">
              {seg.text}
            </span>
          ) : seg.kind === "slot" ? (
            <span key={i} className="relative inline-block">
              {RAN_SLOT}
              <button
                type="button"
                className="pointer-events-auto absolute inset-0 flex items-center justify-end pr-0.5 text-primary"
                aria-label={`调整${seg.names.join("、")}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.dataset.x = String(e.clientX);
                  e.currentTarget.dataset.y = String(e.clientY);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const x = Number(e.currentTarget.dataset.x);
                  const y = Number(e.currentTarget.dataset.y);
                  if (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8) return;
                  setHit(seg.names);
                }}
              >
                <Dice5 className="size-[18px]" />
              </button>
            </span>
          ) : seg.kind === "gap" ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span key={i} data-gi={i}>
              {seg.text}
            </span>
          ),
        )}
      </div>
      {bubble && bubble.zh
        ? createPortal(
            <div
              ref={pop}
              className="fixed z-[90] w-max rounded-[12px] border border-line bg-card px-2.5 py-1.5 text-left text-[12px] leading-4 shadow-lg"
              style={{
                top: Math.max(12, bubble.anchorY - 8),
                left: bubble.anchorX,
                maxWidth: bubble.maxW,
                transform: "translateY(-100%)",
              }}
            >
              <button
                type="button"
                className={`block max-w-full text-left ${bubble.replace ? "pointer-events-auto" : "pointer-events-none"}`}
                onPointerDown={(e) => {
                  if (!bubble.replace) return;
                  e.preventDefault();
                }}
                onClick={() => {
                  if (bubble.replace && bubble.zh && bubble.zh !== "翻译中") swap(bubble.index, bubble.zh);
                }}
              >
                <div className="break-words text-ink">{bubble.body}</div>
                <div className="break-words text-muted">{bubble.zh}</div>
              </button>
            </div>,
            document.body,
          )
        : null}
      {hit ? (
        <RanDiceDialog names={hit} favId={favId} onClose={() => setHit(null)} onOpenSettings={() => setSettings(true)} />
      ) : null}
      {settings ? <RandomSettings onClose={() => setSettings(false)} onInsert={(piece, how) => onInsert?.(piece, how)} /> : null}
    </>
  );
}

const NO_IDS: string[] = [];
const NO_MODULES: RandomModule[] = [];

function RanDiceDialog({
  names,
  favId,
  onClose,
  onOpenSettings,
}: {
  names: string[];
  favId?: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const modules = useApp((s) => s.settings.random?.modules) ?? NO_MODULES;
  const [drafts, setDrafts] = useState<RanDraft[]>(() => draftsFor(names, modules));
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const shownIds = useApp((s) => (s.settings.random?.enabled ? s.settings.random.shownItemIds : undefined)) ?? NO_IDS;
  const draft = drafts[tab] ?? drafts[0];
  const mod = draft ? modules.find((row) => row.id === draft.id) : undefined;
  const dirty = drafts.some((row) => {
    const live = modules.find((item) => item.id === row.id);
    return !!live && ranDraftDirty(live, row);
  });
  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    useApp.getState().setUI({
      confirm: { title: "关闭", body: "关掉会丢掉刚才的修改。", onOk: onClose },
    });
  };
  const openSettings = () => {
    const go = () => {
      onClose();
      onOpenSettings();
    };
    if (!dirty) {
      go();
      return;
    }
    useApp.getState().setUI({
      confirm: { title: "关闭", body: "关掉会丢掉刚才的修改。", onOk: go },
    });
  };
  const save = () => {
    const state = useApp.getState();
    const bank = state.settings.random;
    if (!bank || !drafts.length) {
      onClose();
      return;
    }
    const next = commitRanDrafts(bank, drafts);
    if (next !== bank) state.setSettings({ random: next });
    if (favId) {
      const fav = state.favorites.find((row) => row.id === favId);
      if (fav?.randomSnap) {
        const snap = patchSnapFromDrafts(fav.randomSnap, bank, drafts);
        if (snap !== fav.randomSnap) state.patchFavorite(favId, { randomSnap: snap });
      }
    }
    if (next !== bank) state.toast("已保存");
    onClose();
  };
  if (!draft || !mod) {
    return null;
  }
  const shown = mod.items.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const patch = (next: RanDraft) => setDrafts((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  const setEnabled = (id: string, on: boolean) => {
    const enabled = { ...draft.enabled, [id]: on };
    let nextId = draft.nextId;
    if (draft.pick === "seq" && !on && nextId === id) {
      nextId = mod.items.find((item) => item.id !== id && enabled[item.id] !== false)?.id ?? null;
    }
    patch({ ...draft, enabled, nextId });
  };
  const setVisible = (on: boolean) => {
    const enabled = { ...draft.enabled };
    for (const item of shown) enabled[item.id] = on;
    let nextId = draft.nextId;
    if (draft.pick === "seq" && nextId && enabled[nextId] === false) {
      nextId = mod.items.find((item) => enabled[item.id] !== false)?.id ?? null;
    }
    patch({ ...draft, enabled, nextId });
  };
  const applyPicked = (scheme: RandomScheme, mode: "replace" | "union") => {
    const items = mod.items.map((item) => ({ ...item, enabled: draft.enabled[item.id] !== false }));
    const enabled = Object.fromEntries(applyScheme(items, scheme, mode).map((item) => [item.id, item.enabled === true]));
    let nextId = draft.nextId;
    if (draft.pick === "seq" && nextId && !enabled[nextId]) {
      nextId = mod.items.find((item) => enabled[item.id])?.id ?? null;
    }
    patch({ ...draft, enabled, nextId });
  };
  const schemes = (mod.schemes ?? []).slice().sort((a, b) => a.order - b.order);
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-start justify-center px-5 pt-[8vh] pb-[max(16px,env(safe-area-inset-bottom))]">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label="关闭" onClick={close} />
      <div className="relative flex max-h-[78dvh] w-full max-w-sm flex-col overflow-hidden rounded-[24px] bg-bg text-ink shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 px-5 pt-5 pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <FitTitle text={drafts.length > 1 ? "调整随机" : draft.name} />
            <button type="button" className="grid size-9 shrink-0 place-items-center" aria-label="随机设置" onClick={openSettings}>
              <Settings className="size-5" />
            </button>
          </div>
          <button type="button" className="h-7 shrink-0 rounded-full bg-primary px-3 text-[13px] font-medium text-on-primary" onClick={save}>
            保存
          </button>
          <button type="button" className="grid size-9 shrink-0 place-items-center" aria-label="关闭" onClick={close}>
            <X className="size-5" />
          </button>
        </div>
        {drafts.length > 1 ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-3">
            {drafts.map((row, i) => {
              const live = modules.find((item) => item.id === row.id);
              const mark = !!live && ranDraftDirty(live, row);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`shrink-0 rounded-[8px] border px-3 py-1 text-[13px] ${i === tab ? "border-primary text-primary" : "border-line text-ink"}`}
                  onClick={() => {
                    setTab(i);
                    setQuery("");
                  }}
                >
                  {row.name}
                  {mark ? <span className="ml-1 inline-block size-1.5 rounded-full bg-primary align-middle" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-3">
          <button
            type="button"
            className={`h-6 rounded-full px-2.5 text-[12px] leading-none ${draft.pick === "random" ? "bg-primary text-on-primary" : "border border-line"}`}
            onClick={() => patch({ ...draft, pick: draft.pick === "random" ? "seq" : "random" })}
          >
            {draft.pick === "random" ? "随机" : "顺序"}
          </button>
          <RoundStep rounds={draft.rounds} onChange={(rounds) => patch({ ...draft, rounds })} />
          <span className="ml-auto flex items-center gap-2 text-[13px]">
            <button type="button" className="text-primary" onClick={() => setVisible(true)}>
              全选
            </button>
            <button type="button" className="text-muted" onClick={() => setVisible(false)}>
              全不选
            </button>
          </span>
        </div>
        <div className="flex shrink-0 items-end gap-2 px-5 pb-3">
          {draft.pick === "seq" ? (
            <TurnPick className="min-w-0 flex-[2]" module={turnView(mod, draft)} onPick={(id) => patch({ ...draft, nextId: id })} />
          ) : null}
          <input
            value={query}
            placeholder="搜索"
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-full border border-line bg-card px-3 text-[13px] outline-none"
          />
        </div>
        <div className="shrink-0 px-5 pb-3">
          <LibraryDrawer
            key={mod.id}
            className="min-w-0"
            label="选择方案"
            valueLabel={schemes.find((row) => row.id === picked[mod.id])?.name || "未选择"}
            showNone={false}
            rowApplies
            maxRows={6}
            emptyText="还没有方案"
            deleteAsk={() => "删除这个方案？"}
            items={schemes.map((row) => ({ id: row.id, name: row.name }))}
            onApply={(id) => {
              const scheme = schemes.find((row) => row.id === id);
              if (!scheme) return;
              setPicked((cur) => ({ ...cur, [mod.id]: id }));
              applyPicked(scheme, "replace");
            }}
            onAugment={(id) => {
              const scheme = schemes.find((row) => row.id === id);
              if (!scheme) return;
              setPicked((cur) => ({ ...cur, [mod.id]: id }));
              applyPicked(scheme, "union");
            }}
            onDelete={(id) => {
              setPicked((cur) => (cur[mod.id] === id ? { ...cur, [mod.id]: null } : cur));
              writeSchemes(mod.id, schemes.filter((row) => row.id !== id));
            }}
            onReorder={(ids) => {
              const order = new Map(ids.map((id, i) => [id, i]));
              writeSchemes(
                mod.id,
                schemes.map((row) => ({ ...row, order: order.get(row.id) ?? row.order })),
              );
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {shown.map((item) => {
            const on = draft.enabled[item.id] !== false;
            return (
              <div
                key={item.id}
                className={`mb-2 flex items-center gap-2 rounded-[16px] border px-3 py-2 ${shownIds.includes(item.id) ? "border-danger" : "border-line"}`}
              >
                <button
                  type="button"
                  aria-label={on ? "取消选用" : "选用"}
                  className={`size-4 shrink-0 rounded-full border ${on ? "border-primary bg-primary" : "border-line-strong"}`}
                  onClick={() => setEnabled(item.id, !on)}
                />
                <div className="min-w-0 flex-1 truncate text-[14px]">{item.name || "未命名"}</div>
              </div>
            );
          })}
          {shown.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">没有这一项</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function writeSchemes(modId: string, schemes: RandomScheme[]) {
  const bank = useApp.getState().settings.random;
  if (!bank) return;
  useApp.getState().setSettings({
    random: {
      ...bank,
      modules: bank.modules.map((row) => (row.id === modId ? { ...row, schemes } : row)),
    },
  });
}

function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(18);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let next = 18;
    el.style.fontSize = "18px";
    while (next > 13 && el.scrollWidth > el.clientWidth + 1) {
      next -= 1;
      el.style.fontSize = `${next}px`;
    }
    setSize(next);
  }, [text]);
  return (
    <div ref={ref} className="min-w-0 truncate whitespace-nowrap font-semibold leading-tight" style={{ fontSize: size }}>
      {text}
    </div>
  );
}

function turnView(mod: RandomModule, draft: RanDraft): RandomModule {
  const items = mod.items.map((item) => ({ ...item, enabled: draft.enabled[item.id] !== false }));
  const enabledChanged = items.some((item, i) => item.enabled !== (mod.items[i]?.enabled === true));
  const nextChanged = (draft.nextId ?? null) !== (mod.nextId ?? null);
  const rounds = Math.max(1, Math.floor(draft.rounds) || 1);
  const next: RandomModule = { ...mod, items, pick: draft.pick, nextId: draft.nextId };
  if (rounds > 1) next.rounds = rounds;
  else delete next.rounds;
  if (enabledChanged || nextChanged || moduleRounds(mod) !== rounds || (mod.pick === "seq" ? "seq" : "random") !== draft.pick) next.hold = null;
  return next;
}

function TurnPick({ module, onPick, className }: { module: RandomModule; onPick: (id: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const current = seqTurnItem(module);
  const pool = module.items.filter((item) => item.enabled);
  return (
    <div className={className}>
      <div className="mb-0.5 text-left text-[11px] leading-none text-muted">当前轮到</div>
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-full border border-line bg-card px-3 text-left text-[13px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{current ? current.name || "未命名" : "没有选中的项"}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className={`mt-2 overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-card scroll-thin ${pool.length > 8 ? "max-h-52" : ""}`}>
          {pool.length === 0 ? <p className="flex h-9 items-center px-3 text-[13px] text-muted">没有选中的项</p> : null}
          {pool.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex h-9 w-full items-center px-3 text-left text-[13px] ${item.id === current?.id ? "text-primary" : "text-ink"}`}
              onClick={() => {
                onPick(item.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.name || "未命名"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function draftsFor(names: string[], modules: RandomModule[]) {
  const out: RanDraft[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const mod = modules.find((row) => row.name === name);
    if (!mod || seen.has(mod.id)) continue;
    seen.add(mod.id);
    out.push(ranDraftOf(mod));
  }
  return out;
}

function RoundStep({ rounds, onChange }: { rounds: number; onChange: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(rounds));
  return (
    <span className="inline-flex h-6 items-center gap-1 text-[12px] text-muted">
      轮数
      <span className="inline-flex h-6 items-center rounded-full border border-line bg-card">
        <button type="button" className="grid h-6 w-5 place-items-center" aria-label="增加轮数" onClick={() => onChange(rounds + 1)}>
          <ChevronUp className="size-3" />
        </button>
        {editing ? (
          <input
            autoFocus
            inputMode="numeric"
            aria-label="轮数"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/\D/g, "").replace(/^0+/, ""))}
            onBlur={() => {
              const n = Math.floor(Number(text));
              if (!text || !Number.isFinite(n) || n < 1) setText(String(rounds));
              else if (n !== rounds) onChange(n);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-8 bg-transparent text-center text-[12px] text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            className="min-w-4 px-0.5 text-center text-[12px] text-ink tabular-nums"
            onClick={() => {
              setText(String(rounds));
              setEditing(true);
            }}
          >
            {rounds}
          </button>
        )}
        <button type="button" className="grid h-6 w-5 place-items-center disabled:opacity-30" aria-label="减少轮数" disabled={rounds <= 1} onClick={() => onChange(rounds - 1)}>
          <ChevronDown className="size-3" />
        </button>
      </span>
    </span>
  );
}

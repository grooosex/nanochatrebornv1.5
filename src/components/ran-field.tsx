import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  type RanDraft,
  type RandomModule,
  type RandomScheme,
} from "@/lib/random-prompt";
import { LibraryDrawer } from "./LibraryDrawer";
import { RandomSettings } from "./RandomPanels";

export function RanMarks({
  text,
  box,
  favId,
  onInsert,
}: {
  text: string;
  box: RefObject<HTMLTextAreaElement | null>;
  favId?: string;
  onInsert?: (piece: string, how?: "comma" | "line") => void;
}) {
  const modules = useApp((s) => s.settings.random?.modules);
  const names = useMemo(() => (modules ?? []).map((mod) => mod.name), [modules]);
  const spans = useMemo(() => liveRanSpans(text, names), [text, names]);
  const view = useRef<HTMLDivElement>(null);
  const [hit, setHit] = useState<string[] | null>(null);
  const [settings, setSettings] = useState(false);
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
  if (!spans.length) return null;
  const parts: { key: string; text: string; names?: string[] }[] = [];
  let at = 0;
  spans.forEach((span, i) => {
    if (span.start > at) parts.push({ key: `t${at}`, text: text.slice(at, span.start) });
    parts.push({ key: `s${i}`, text: text.slice(span.start, span.end), names: span.names });
    at = span.end;
  });
  if (at < text.length) parts.push({ key: `t${at}`, text: text.slice(at) });
  return (
    <>
      <div
        ref={view}
        className="pointer-events-none absolute z-10 overflow-hidden whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] leading-relaxed text-transparent"
      >
        {parts.map((part) =>
          part.names ? (
            <span key={part.key}>
              <span className="underline decoration-primary decoration-dashed decoration-1 underline-offset-[3px]">{part.text}</span>
              <span className="relative inline-block">
                {RAN_SLOT}
                <button
                  type="button"
                  className="pointer-events-auto absolute inset-0 flex items-center justify-end pr-0.5 text-primary"
                  aria-label={`调整${part.names.join("、")}`}
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
                    setHit(part.names ?? null);
                  }}
                >
                  <Dice5 className="size-[18px]" />
                </button>
              </span>
            </span>
          ) : (
            <span key={part.key}>{part.text}</span>
          ),
        )}
      </div>
      {hit ? (
        <RanDiceDialog names={hit} favId={favId} onClose={() => setHit(null)} onOpenSettings={() => setSettings(true)} />
      ) : null}
      {settings ? <RandomSettings onClose={() => setSettings(false)} onInsert={(piece, how) => onInsert?.(piece, how)} /> : null}
    </>
  );
}

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
  const modules = useApp((s) => s.settings.random?.modules ?? []);
  const [drafts, setDrafts] = useState<RanDraft[]>(() => draftsFor(names, modules));
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const shownIds = useApp((s) => (s.settings.random?.enabled ? (s.settings.random.shownItemIds ?? []) : []));
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

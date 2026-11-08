import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Copy, Folder, MoreHorizontal, Pencil, Plus, Send, Star } from "lucide-react";
import { useApp } from "@/lib/store";
import {
  deleteRandomGroup,
  duplicateRandomModule,
  groupDescendants,
  moduleRounds,
  moduleTag,
  orderedGroups,
  orderedModules,
  setModulePick,
  setModuleRounds,
  type RandomBank,
  type RandomGroup,
  type RandomModule,
} from "@/lib/random-prompt";
import { autoScrollNearEdge, cn, indexFromY, moveId, nearestScroller, uid } from "@/lib/utils";
import { TextInput } from "./ui-kit";

function saveBank(next: RandomBank) {
  useApp.getState().setSettings({ random: next });
}

function GripBars() {
  return (
    <span className="flex flex-col items-center justify-center gap-[3.5px] text-current" aria-hidden>
      <span className="h-[2px] w-4 rounded-full bg-current" />
      <span className="h-[2px] w-4 rounded-full bg-current" />
      <span className="h-[2px] w-4 rounded-full bg-current" />
    </span>
  );
}

type Draft = { groups: Record<string, number>; mods: Record<string, number> };
type MenuState = { kind: "mod" | "group"; id: string; top: number; right: number };

function endOrder(rows: { order?: number }[]) {
  return rows.reduce((n, row) => Math.max(n, row.order ?? 0), -1) + 1;
}

export function ModuleList({
  bank,
  sortDo,
  onSorting,
  onEdit,
  onCreate,
  onInsert,
}: {
  bank: RandomBank;
  sortDo: { current: { save: () => void; cancel: () => void } };
  onSorting: (on: boolean) => void;
  onEdit: (m: RandomModule) => void;
  onCreate: () => void;
  onInsert: (piece: string) => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const [move, setMove] = useState<{ kind: "mod" | "group"; id: string } | null>(null);
  const [sortMode, setSortMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Draft | null>(null);
  const dragRef = useRef<{ id: string; lane: string } | null>(null);
  const sortRef = useRef(false);
  const bankRef = useRef(bank);
  const press = useRef<{ y: number } | null>(null);
  const pressTimer = useRef(0);
  const lastY = useRef(0);
  const rafRef = useRef(0);
  bankRef.current = bank;
  const pinStars = !(sortMode && draft);
  const groupsOf = (parentId: string | null) => orderedGroups(bank, parentId, draft?.groups, pinStars);
  const modsOf = (parentId: string | null) => orderedModules(bank, parentId, draft?.mods, pinStars);

  const cancelSort = () => {
    sortRef.current = false;
    draftRef.current = null;
    dragRef.current = null;
    setDraft(null);
    setDragId(null);
    setSortMode(false);
    setHoldId(null);
  };

  const finishSort = () => {
    const d = draftRef.current;
    const cur = bankRef.current;
    sortRef.current = false;
    if (d) {
      saveBank({
        ...cur,
        groups: (cur.groups ?? []).map((g) => (d.groups[g.id] == null ? g : { ...g, order: d.groups[g.id] })),
        modules: cur.modules.map((m) => (d.mods[m.id] == null ? m : { ...m, order: d.mods[m.id] })),
      });
    }
    draftRef.current = null;
    dragRef.current = null;
    setDraft(null);
    setDragId(null);
    setSortMode(false);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  useEffect(() => {
    onSorting(sortMode);
    sortDo.current = { save: finishSort, cancel: cancelSort };
  });

  useEffect(() => {
    if (!sortMode) return;
    const applyY = (y: number) => {
      const d = dragRef.current;
      const cur = draftRef.current;
      if (!d || !cur) return;
      const nodes = listRef.current?.querySelectorAll<HTMLElement>(`[data-drag-lane="${CSS.escape(d.lane)}"]`);
      if (!nodes?.length) return;
      const ids = Array.from(nodes)
        .map((el) => el.dataset.rowId)
        .filter((id): id is string => Boolean(id));
      const next = moveId(ids, d.id, indexFromY(nodes, y));
      if (next.join("\0") === ids.join("\0")) return;
      const laneGroups = d.lane.startsWith("g:");
      const map = { ...(laneGroups ? cur.groups : cur.mods) };
      next.forEach((id, i) => {
        map[id] = i;
      });
      const updated = laneGroups ? { ...cur, groups: map } : { ...cur, mods: map };
      draftRef.current = updated;
      setDraft(updated);
    };
    const tick = () => {
      rafRef.current = 0;
      if (!dragRef.current) return;
      const scroller = nearestScroller(listRef.current);
      const dy = scroller ? autoScrollNearEdge(scroller, lastY.current) : 0;
      applyY(lastY.current);
      if (dy) rafRef.current = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      lastY.current = e.clientY;
      const scroller = nearestScroller(listRef.current);
      const dy = scroller ? autoScrollNearEdge(scroller, e.clientY) : 0;
      applyY(e.clientY);
      if (dy && !rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    const onUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      const scroller = nearestScroller(listRef.current);
      if (scroller) scroller.style.touchAction = "";
      dragRef.current = null;
      setDragId(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [sortMode]);

  const clearPress = () => {
    window.clearTimeout(pressTimer.current);
    press.current = null;
    setHoldId(null);
  };

  const enterSort = () => {
    if (bank.modules.length + (bank.groups ?? []).length < 2) return;
    const snap: Draft = { groups: {}, mods: {} };
    const parents = new Set<string | null>([null]);
    for (const g of bank.groups ?? []) parents.add(g.parentId ?? null);
    for (const m of bank.modules) parents.add(m.groupId ?? null);
    for (const p of parents) {
      orderedGroups(bank, p, undefined, true).forEach((g, i) => {
        snap.groups[g.id] = i;
      });
      orderedModules(bank, p, undefined, true).forEach((m, i) => {
        snap.mods[m.id] = i;
      });
    }
    draftRef.current = snap;
    sortRef.current = true;
    setDraft(snap);
    setSortMode(true);
    setHoldId(null);
    setMenu(null);
  };

  const onRowDown = (e: PE<HTMLElement>, id: string) => {
    if (sortRef.current) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearPress();
    press.current = { y: e.clientY };
    setHoldId(id);
    pressTimer.current = window.setTimeout(enterSort, 400);
  };

  const onRowMove = (e: PE<HTMLElement>) => {
    if (sortRef.current || !press.current) return;
    if (Math.abs(e.clientY - press.current.y) > 12) clearPress();
  };

  const onGripDown = (e: PE<HTMLElement>, id: string, lane: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id, lane };
    setDragId(id);
    lastY.current = e.clientY;
    const el = nearestScroller(listRef.current);
    if (el) el.style.touchAction = "none";
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  const openMenu = (el: HTMLElement, kind: "mod" | "group", id: string) => {
    if (menu?.kind === kind && menu.id === id) {
      setMenu(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const menuW = 132;
    const menuH = 168;
    let right = window.innerWidth - r.right;
    right = Math.max(8, Math.min(right, window.innerWidth - menuW - 8));
    let top = r.bottom + 4;
    if (top + menuH > window.innerHeight - 8) top = Math.max(8, r.top - menuH - 4);
    setMenu({ kind, id, top, right });
  };

  const toggleStar = (kind: "mod" | "group", id: string) => {
    const cur = bankRef.current;
    if (kind === "group") {
      saveBank({
        ...cur,
        groups: (cur.groups ?? []).map((g) => (g.id === id ? { ...g, starred: !g.starred } : g)),
      });
      return;
    }
    saveBank({ ...cur, modules: cur.modules.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)) });
  };

  const toggleCollapse = (id: string) => {
    const cur = bankRef.current;
    saveBank({
      ...cur,
      groups: (cur.groups ?? []).map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    });
  };

  const applyMove = (parentId: string | null) => {
    if (!move) return;
    const cur = bankRef.current;
    if (move.kind === "group") {
      if (parentId === move.id) return;
      if (parentId && groupDescendants(cur.groups ?? [], move.id).includes(parentId)) return;
      const siblings = (cur.groups ?? []).filter((g) => g.id !== move.id && (g.parentId ?? null) === parentId);
      saveBank({
        ...cur,
        groups: (cur.groups ?? []).map((g) => (g.id === move.id ? { ...g, parentId, order: endOrder(siblings) } : g)),
      });
    } else {
      const siblings = cur.modules.filter((m) => m.id !== move.id && (m.groupId ?? null) === parentId);
      saveBank({
        ...cur,
        modules: cur.modules.map((m) => (m.id === move.id ? { ...m, groupId: parentId, order: endOrder(siblings) } : m)),
      });
    }
    setMove(null);
  };

  const renderGroups = (parentId: string | null, depth: number): ReactNode =>
    groupsOf(parentId).map((g) => (
      <div key={g.id}>
        <div
          data-drag-lane={`g:${parentId ?? "root"}`}
          data-row-id={g.id}
          className={cn("flex items-center gap-2 py-1.5 select-none", dragId === g.id && "bg-ink/10", !sortMode && holdId === g.id && "bg-ink/5")}
          style={{ marginLeft: depth * 12, touchAction: sortMode ? "pan-y" : "manipulation" }}
          onPointerDown={(e) => onRowDown(e, g.id)}
          onPointerMove={onRowMove}
          onPointerUp={clearPress}
          onPointerCancel={clearPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-primary">
              <Folder className="size-3" />
            </span>
            {g.starred && <Star className="size-3 shrink-0 fill-primary text-primary" />}
            <div className={cn("min-w-0 truncate font-bold", depth === 0 ? "text-[15px]" : depth === 1 ? "text-[14px]" : "text-[13px]")}>{g.name}</div>
          </div>
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center text-muted"
            aria-label={g.collapsed ? "展开" : "收起"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleCollapse(g.id)}
          >
            <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0 fill-current transition", g.collapsed ? "" : "rotate-180")} aria-hidden>
              <path d="M6 9.2 1.4 3.2h9.2L6 9.2z" />
            </svg>
          </button>
          {sortMode ? (
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center text-ink/55"
              aria-label="拖动排序"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => onGripDown(e, g.id, `g:${parentId ?? "root"}`)}
            >
              <GripBars />
            </button>
          ) : (
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center text-muted"
              aria-label="更多"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => openMenu(e.currentTarget, "group", g.id)}
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        </div>
        {!g.collapsed && (
          <div>
            {renderGroups(g.id, depth + 1)}
            {modsOf(g.id).map((mod) => renderMod(mod, depth + 1))}
          </div>
        )}
      </div>
    ));

  const renderMod = (mod: RandomModule, depth: number) => (
    <div
      key={mod.id}
      data-drag-lane={`m:${mod.groupId ?? "root"}`}
      data-row-id={mod.id}
      className={cn(
        "mb-3 rounded-[18px] border border-line bg-card px-3 py-3 select-none",
        dragId === mod.id && "bg-ink/15",
        !sortMode && holdId === mod.id && "bg-ink/8",
      )}
      style={{ marginLeft: depth * 12, touchAction: sortMode ? "pan-y" : "manipulation" }}
      onPointerDown={(e) => onRowDown(e, mod.id)}
      onPointerMove={onRowMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {mod.starred && <Star className="size-3 shrink-0 fill-primary text-primary" />}
          <div className="min-w-0 truncate text-[15px] font-medium">
            {mod.name}
            <span className="ml-1 text-[12px] font-normal text-muted">({mod.items.length})</span>
          </div>
        </div>
        {sortMode ? (
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center text-muted"
            aria-label={`拖动${mod.name}`}
            style={{ touchAction: "none" }}
            onPointerDown={(e) => onGripDown(e, mod.id, `m:${mod.groupId ?? "root"}`)}
          >
            <GripBars />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="grid size-8 place-items-center text-muted"
              aria-label="插入到正面提示词"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onInsert(moduleTag([mod.name]));
                useApp.getState().toast("插入成功");
              }}
            >
              <Send className="size-4" />
            </button>
            <button type="button" className="grid size-8 place-items-center text-muted" aria-label="复制提示词" onPointerDown={(e) => e.stopPropagation()} onClick={() => copyText(moduleTag([mod.name]))}>
              <Copy className="size-4" />
            </button>
            <button
              type="button"
              className="grid size-8 place-items-center text-muted"
              aria-label="更多"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => openMenu(e.currentTarget, "mod", mod.id)}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </>
        )}
      </div>
      {!sortMode && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "h-6 shrink-0 rounded-full px-2.5 text-[12px] leading-none",
              mod.pick === "random" ? "bg-primary text-on-primary" : "border border-line bg-card text-ink",
            )}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => saveBank(setModulePick(bank, mod.id, mod.pick === "random" ? "seq" : "random"))}
          >
            {mod.pick === "random" ? "随机" : "顺序"}
          </button>
          <RoundsBridge rounds={moduleRounds(mod)} onChange={(n) => saveBank(setModuleRounds(bank, mod.id, n))} />
          <button type="button" className="ml-auto grid size-8 place-items-center text-muted" aria-label="编辑" onPointerDown={(e) => e.stopPropagation()} onClick={() => onEdit(mod)}>
            <Pencil className="size-4" />
          </button>
        </div>
      )}
    </div>
  );

  const moveBanned = () => {
    const banned = new Set<string>();
    if (move?.kind === "group") {
      banned.add(move.id);
      for (const id of groupDescendants(bank.groups ?? [], move.id)) banned.add(id);
    }
    return banned;
  };

  return (
    <div ref={listRef}>
      {!sortMode && (
        <div className="mb-3 flex gap-2">
          <button type="button" className="flex h-11 flex-1 items-center justify-center gap-1 rounded-full border border-line bg-card text-[14px]" onClick={onCreate}>
            <Plus className="size-4" /> 添加模块
          </button>
          <button type="button" className="flex h-11 flex-1 items-center justify-center rounded-full border border-line bg-card text-[14px]" onClick={() => setNaming({ name: "" })}>
            创建分组
          </button>
        </div>
      )}
      {renderGroups(null, 0)}
      {modsOf(null).map((mod) => renderMod(mod, 0))}
      {bank.modules.length === 0 && !(bank.groups ?? []).length && <p className="text-center text-[13px] text-muted">还没有模块</p>}
      {menu &&
        createPortal(
          <div className="fixed z-[80] w-32 overflow-hidden rounded-[14px] border border-line bg-card shadow-lg" style={{ top: menu.top, right: menu.right }} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="block w-full px-3 py-2.5 text-left text-[13px]" onClick={() => { toggleStar(menu.kind, menu.id); setMenu(null); }}>
              星标
            </button>
            <button type="button" className="block w-full border-t border-line px-3 py-2.5 text-left text-[13px]" onClick={() => { setMove({ kind: menu.kind, id: menu.id }); setMenu(null); }}>
              移动
            </button>
            {menu.kind === "group" ? (
              <button
                type="button"
                className="block w-full border-t border-line px-3 py-2.5 text-left text-[13px]"
                onClick={() => {
                  const g = (bank.groups ?? []).find((x) => x.id === menu.id);
                  setNaming({ id: menu.id, name: g?.name ?? "" });
                  setMenu(null);
                }}
              >
                重命名
              </button>
            ) : (
              <button
                type="button"
                className="block w-full border-t border-line px-3 py-2.5 text-left text-[13px]"
                onClick={() => {
                  const mod = bank.modules.find((m) => m.id === menu.id);
                  setMenu(null);
                  if (!mod) return;
                  const copy = duplicateRandomModule(mod, bank.modules);
                  saveBank({ ...bank, modules: [...bank.modules, copy] });
                }}
              >
                复制
              </button>
            )}
            <button
              type="button"
              className="block w-full border-t border-line px-3 py-2.5 text-left text-[13px] text-danger"
              onClick={() => {
                const kind = menu.kind;
                const id = menu.id;
                setMenu(null);
                if (kind === "group") {
                  const g = (bank.groups ?? []).find((x) => x.id === id);
                  useApp.getState().setUI({
                    confirm: {
                      title: "删除分组",
                      body: `删除「${g?.name ?? "这个分组"}」和里面的全部分组、模块？这些模块的提示词以后抽不到了。`,
                      danger: true,
                      onOk: () => saveBank(deleteRandomGroup(bankRef.current, id)),
                    },
                  });
                  return;
                }
                const mod = bank.modules.find((m) => m.id === id);
                if (!mod) return;
                useApp.getState().setUI({
                  confirm: {
                    title: "删除模块",
                    body: `删除「${mod.name}」？里面的项也会一起删掉。`,
                    danger: true,
                    onOk: () =>
                      saveBank({
                        ...bankRef.current,
                        modules: bankRef.current.modules.filter((m) => m.id !== id),
                        ...(mod.linked === "appearances" ? { appearanceModuleDismissed: true } : {}),
                      }),
                  },
                });
              }}
            >
              删除
            </button>
          </div>,
          document.body,
        )}
      {naming && (
        <NameDialog
          title={naming.id ? "重命名" : "创建分组"}
          value={naming.name}
          onClose={() => setNaming(null)}
          onOk={(name) => {
            const cur = bankRef.current;
            if (naming.id) {
              saveBank({ ...cur, groups: (cur.groups ?? []).map((g) => (g.id === naming.id ? { ...g, name } : g)) });
            } else {
              const siblings = (cur.groups ?? []).filter((g) => (g.parentId ?? null) === null);
              saveBank({
                ...cur,
                groups: [...(cur.groups ?? []), { id: uid("rg_"), name, parentId: null, collapsed: true, order: endOrder(siblings), starred: false }],
              });
            }
            setNaming(null);
          }}
        />
      )}
      {move && (
        <MoveDialog
          groups={bank.groups ?? []}
          banned={moveBanned()}
          onClose={() => setMove(null)}
          onPick={applyMove}
        />
      )}
    </div>
  );
}

function copyText(text: string) {
  const done = () => useApp.getState().toast("已复制");
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(() => useApp.getState().toast("复制失败"));
    return;
  }
  useApp.getState().toast("复制失败");
}

function RoundsBridge({ rounds, onChange }: { rounds: number; onChange: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(rounds));
  useEffect(() => {
    if (!editing) setDraft(String(rounds));
  }, [rounds, editing]);
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 text-[11px] leading-none text-muted">
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
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").replace(/^0+/, ""))}
            onBlur={() => {
              const n = Math.floor(Number(draft));
              if (!draft || !Number.isFinite(n) || n < 1) setDraft(String(rounds));
              else if (n !== rounds) onChange(n);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-8 bg-transparent text-center text-[12px] text-ink tabular-nums outline-none"
          />
        ) : (
          <button type="button" className="min-w-4 px-0.5 text-center text-[12px] text-ink tabular-nums" onClick={() => setEditing(true)}>
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

function NameDialog({ title, value, onClose, onOk }: { title: string; value: string; onClose: () => void; onOk: (name: string) => void }) {
  const [text, setText] = useState(value);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-6">
      <button type="button" className="absolute inset-0 bg-overlay/40" onClick={onClose} aria-label="关闭" />
      <div className="relative w-full max-w-sm rounded-[24px] bg-bg p-5 text-ink shadow-2xl">
        <div className="mb-4 text-[18px] font-semibold">{title}</div>
        <TextInput value={text} placeholder="分组名称" onChange={(e) => setText(e.target.value)} />
        <div className="mt-4 flex justify-end gap-5 text-[15px]">
          <button type="button" className="text-muted" onClick={onClose}>取消</button>
          <button type="button" className="font-medium text-primary" onClick={() => onOk(text.trim() || "未命名")}>确定</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MoveDialog({
  groups,
  banned,
  onClose,
  onPick,
}: {
  groups: RandomGroup[];
  banned: Set<string>;
  onClose: () => void;
  onPick: (parentId: string | null) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const bank: RandomBank = { enabled: true, modules: [], groups };
  const hasChild = (id: string) => orderedGroups(bank, id).some((g) => !banned.has(g.id));
  const walk = (parentId: string | null, depth: number): ReactNode =>
    orderedGroups(bank, parentId)
      .filter((g) => !banned.has(g.id))
      .map((g) => {
        const nested = hasChild(g.id);
        return (
          <div key={g.id}>
            <div className="flex h-11 items-center" style={{ paddingLeft: 4 + depth * 16 }}>
              {nested ? (
                <button
                  type="button"
                  className="grid size-8 shrink-0 place-items-center text-muted"
                  aria-label={open[g.id] ? "收起" : "展开"}
                  onClick={() => setOpen((cur) => ({ ...cur, [g.id]: !cur[g.id] }))}
                >
                  <ChevronDown className={cn("size-4 transition", open[g.id] ? "" : "-rotate-90")} />
                </button>
              ) : (
                <span className="size-8 shrink-0" />
              )}
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-[14px]" onClick={() => onPick(g.id)}>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-primary">
                  <Folder className="size-3" />
                </span>
                <span className="min-w-0 truncate font-medium">{g.name || "未命名"}</span>
              </button>
            </div>
            {nested && open[g.id] ? walk(g.id, depth + 1) : null}
          </div>
        );
      });
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 py-8">
      <button type="button" className="absolute inset-0 bg-overlay/40" onClick={onClose} aria-label="关闭" />
      <div className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-[24px] bg-bg text-ink shadow-2xl">
        <div className="flex shrink-0 items-center px-5 pb-3 pt-5">
          <h2 className="min-w-0 flex-1 text-[18px] font-semibold">移动</h2>
          <button type="button" className="grid size-9 place-items-center" onClick={onClose} aria-label="关闭">
            <span className="text-[18px]">×</span>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 pb-5">
          <button type="button" className="flex h-11 w-full items-center text-left text-[14px]" onClick={() => onPick(null)}>
            不放进分组
          </button>
          {walk(null, 0)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PoolTree({ bank, picked, onToggle }: { bank: RandomBank; picked: string[]; onToggle: (name: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const toggle = (id: string) => {
    const cur = useApp.getState().settings.random;
    if (!cur) return;
    saveBank({ ...cur, groups: (cur.groups ?? []).map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)) });
  };
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const obs = new ResizeObserver(() => {
      const h = Math.round(el.offsetHeight);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const cur = useApp.getState().settings.random;
        if (!cur) return;
        const next = Math.max(216, Math.min(1200, h));
        if (cur.poolHeight === next) return;
        saveBank({ ...cur, poolHeight: next });
      }, 200);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
  const render = (parentId: string | null, depth: number): ReactNode => (
    <>
      {orderedGroups(bank, parentId).map((g) => (
        <div key={g.id} style={{ marginLeft: depth * 12 }}>
          <div className="flex items-center gap-1 py-1">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-primary">
              <Folder className="size-3" />
            </span>
            <span className={cn("min-w-0 flex-1 truncate", depth === 0 ? "text-[14px]" : "text-[13px]")}>{g.name}</span>
            <button type="button" className="grid size-7 place-items-center text-muted" aria-label={g.collapsed ? "展开" : "收起"} onClick={() => toggle(g.id)}>
              <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0 fill-current transition", g.collapsed ? "" : "rotate-180")} aria-hidden>
                <path d="M6 9.2 1.4 3.2h9.2L6 9.2z" />
              </svg>
            </button>
          </div>
          {!g.collapsed && render(g.id, depth + 1)}
        </div>
      ))}
      {orderedModules(bank, parentId).length > 0 && (
        <div className="flex flex-wrap gap-2 py-1" style={{ marginLeft: depth * 12 }}>
          {orderedModules(bank, parentId).map((mod) => (
            <button
              key={mod.id}
              type="button"
              className={cn("self-start rounded-full px-3 py-1.5 text-[13px] leading-5", picked.includes(mod.name) ? "bg-primary text-on-primary" : "bg-dim text-ink")}
              onClick={() => onToggle(mod.name)}
            >
              {mod.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
  return (
    <div
      ref={box}
      className="mb-5 min-h-[216px] resize-y overflow-y-auto rounded-[16px] border border-line bg-card p-3"
      style={{ height: bank.poolHeight ?? 216, maxHeight: "70vh" }}
    >
      {render(null, 0)}
      {bank.modules.length === 0 && !(bank.groups ?? []).length && <span className="text-[13px] text-muted">还没有模块</span>}
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Folder, Pencil, Plus, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/store";
import {
  APPEARANCE_MODULE_NAME,
  applyScheme,
  badModuleName,
  bankSwitch,
  emptyBank,
  jumpSeq,
  moduleTag,
  orderedGroups,
  orderedModules,
  reviveAppearanceModule,
  seqTurnItem,
  type RandomBank,
  type RandomGroup,
  type RandomItem,
  type RandomModule,
  type RandomScheme,
} from "@/lib/random-prompt";
import { autoScrollNearEdge, cn, indexFromY, moveId, nearestScroller, uid } from "@/lib/utils";
import { LibraryDrawer } from "./LibraryDrawer";
import { GhostBtn, Modal, PrimaryBtn, Switch, TextArea, TextInput } from "./ui-kit";
import { ModuleList, PoolTree } from "./random-list";

function Sheet({
  title,
  extra,
  center,
  onClose,
  onX,
  z,
  children,
}: {
  title: string;
  extra?: ReactNode;
  center?: ReactNode;
  onClose: () => void;
  onX?: () => void;
  z: number;
  children: ReactNode;
}) {
  const closeX = onX ?? onClose;
  return createPortal(
    <div className="fixed inset-0 flex justify-center px-4 py-8" style={{ zIndex: z }}>
      <button type="button" className="absolute inset-0 bg-overlay/40" onClick={onClose} aria-label="关闭" />
      <div className="relative z-10 flex h-full min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-bg text-ink shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
          <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold">{title}</h2>
          {center}
          {extra}
          <button type="button" className="grid size-9 shrink-0 place-items-center" onClick={closeX} aria-label="关闭">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 scroll-thin">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function saveBank(next: RandomBank) {
  useApp.getState().setSettings({ random: next });
}

const NO_SHOWN: string[] = [];

function CopyChip({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="inline rounded-[4px] border border-line bg-card px-0.5 align-baseline text-[11px] leading-4 text-inherit"
      onClick={() => {
        const done = () => useApp.getState().toast("已复制");
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).then(done).catch(() => useApp.getState().toast("复制失败"));
          return;
        }
        useApp.getState().toast("复制失败");
      }}
    >
      {text}
    </button>
  );
}

function addItemTo(moduleId: string, item: { name: string; content: string }) {
  const bank = useApp.getState().settings.random ?? emptyBank();
  const mod = bank.modules.find((row) => row.id === moduleId);
  if (!mod || mod.linked === "appearances") return;
  saveBank({
    ...bank,
    modules: bank.modules.map((row) =>
      row.id === moduleId
        ? { ...row, items: [...row.items, { id: uid("ri_"), name: item.name, content: item.content, enabled: false }] }
        : row,
    ),
  });
  useApp.getState().toast(`已加到「${mod.name}」`);
}

function SchemePicker({ module, onChange }: { module: RandomModule; onChange: (m: RandomModule) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const list = (module.schemes ?? []).slice().sort((a, b) => a.order - b.order);
  const current = list.find((row) => row.id === picked);
  const apply = (id: string, mode: "replace" | "union") => {
    const scheme = list.find((row) => row.id === id);
    if (!scheme) return;
    setPicked(id);
    onChange({ ...module, items: applyScheme(module.items, scheme, mode) });
  };
  return (
    <LibraryDrawer
      className="min-w-0 flex-1"
      label="选择方案"
      valueLabel={current?.name || "未选择"}
      showNone={false}
      rowApplies
      maxRows={6}
      emptyText="还没有方案"
      deleteAsk={() => "删除这个方案？"}
      items={list.map((row) => ({ id: row.id, name: row.name }))}
      onApply={(id) => apply(id, "replace")}
      onAugment={(id) => apply(id, "union")}
      onDelete={(id) => {
        if (picked === id) setPicked(null);
        onChange({ ...module, schemes: list.filter((row) => row.id !== id) });
      }}
      onReorder={(ids) => {
        const order = new Map(ids.map((id, i) => [id, i]));
        onChange({ ...module, schemes: list.map((row) => ({ ...row, order: order.get(row.id) ?? row.order })) });
      }}
    />
  );
}

function SchemeSave({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-5 pt-[12vh]">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label="关闭" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[24px] bg-bg px-5 pt-5 pb-5 text-ink shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold">保存方案</h2>
          <button type="button" className="grid size-9 place-items-center" aria-label="关闭" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <TextInput value={name} placeholder="方案名称" onChange={(e) => setName(e.target.value)} />
        <div className="mt-4 flex gap-3">
          <GhostBtn onClick={onClose}>取消</GhostBtn>
          <PrimaryBtn
            onClick={() => {
              const next = name.trim();
              if (!next) {
                useApp.getState().toast("先起个名字");
                return;
              }
              onSave(next);
            }}
          >
            保存
          </PrimaryBtn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddTargetTree({
  modules,
  groups,
  skipId,
  onPick,
}: {
  modules: RandomModule[];
  groups: RandomGroup[];
  skipId?: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const bank: RandomBank = { enabled: true, modules, groups };
  const visible = (mod: RandomModule) => mod.id !== skipId && mod.linked !== "appearances" && mod.name !== APPEARANCE_MODULE_NAME;
  const branch = (parentId: string | null): boolean =>
    orderedModules(bank, parentId).some(visible) || orderedGroups(bank, parentId).some((g) => branch(g.id));
  const walk = (parentId: string | null, depth: number): ReactNode => {
    const kids = orderedGroups(bank, parentId).filter((g) => branch(g.id));
    const rows = orderedModules(bank, parentId).filter(visible);
    return (
      <>
        {kids.map((g) => (
          <div key={g.id}>
            <button
              type="button"
              className="flex h-11 w-full items-center gap-1 text-left text-[14px]"
              style={{ paddingLeft: 4 + depth * 16 }}
              onClick={() => setOpen((cur) => ({ ...cur, [g.id]: !cur[g.id] }))}
            >
              <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open[g.id] ? "" : "-rotate-90")} />
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-primary" aria-hidden>
                <Folder className="size-3" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{g.name || "未命名"}</span>
            </button>
            {open[g.id] ? walk(g.id, depth + 1) : null}
          </div>
        ))}
        {rows.map((mod) => (
          <button
            key={mod.id}
            type="button"
            className="flex h-11 w-full items-center text-left text-[14px]"
            style={{ paddingLeft: 24 + depth * 16 }}
            onClick={() => onPick(mod.id)}
          >
            <span className="min-w-0 truncate">{mod.name || "未命名"}</span>
          </button>
        ))}
      </>
    );
  };
  if (!branch(null)) return <p className="text-[14px] text-muted">没有其他模块</p>;
  return <div className="max-h-64 overflow-y-auto overscroll-contain scroll-thin">{walk(null, 0)}</div>;
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

function SortActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-[14px]">
      <button type="button" className="text-muted" onClick={onCancel}>
        取消
      </button>
      <button type="button" className="font-medium text-primary" onClick={onSave}>
        保存
      </button>
    </div>
  );
}

function useListSort(sourceIds: string[], enabled: boolean) {
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idsRef = useRef<string[]>([]);
  const dragRef = useRef<string | null>(null);
  const sortingRef = useRef(false);
  const press = useRef<{ y: number } | null>(null);
  const timer = useRef(0);
  const lastY = useRef(0);
  const raf = useRef(0);
  const sourceKey = sourceIds.join("\0");

  useEffect(() => {
    if (!sortingRef.current) idsRef.current = sourceIds.slice();
  }, [sourceKey, sourceIds]);

  useEffect(() => {
    if (!sorting) return;
    const applyY = (y: number) => {
      const id = dragRef.current;
      if (!id) return;
      const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-sort-id]");
      if (!rows?.length) return;
      const next = moveId(idsRef.current, id, indexFromY(rows, y));
      if (next.join("\0") === idsRef.current.join("\0")) return;
      idsRef.current = next;
      setOrder(next);
    };
    const lockScroller = (on: boolean) => {
      const el = nearestScroller(listRef.current);
      if (el) el.style.touchAction = on ? "none" : "";
    };
    const tick = () => {
      raf.current = 0;
      if (!dragRef.current) return;
      const scroller = nearestScroller(listRef.current);
      const dy = scroller ? autoScrollNearEdge(scroller, lastY.current) : 0;
      applyY(lastY.current);
      if (dy) raf.current = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      lastY.current = e.clientY;
      const scroller = nearestScroller(listRef.current);
      const dy = scroller ? autoScrollNearEdge(scroller, e.clientY) : 0;
      applyY(e.clientY);
      if (dy && !raf.current) raf.current = requestAnimationFrame(tick);
    };
    const onUp = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      lockScroller(false);
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragId(null);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      if (raf.current) cancelAnimationFrame(raf.current);
      lockScroller(false);
    };
  }, [sorting]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const clearPress = () => {
    window.clearTimeout(timer.current);
    press.current = null;
    setHoldId(null);
  };

  const onRowDown = (e: PE<HTMLElement>, id: string) => {
    if (!enabled || sortingRef.current) return;
    if (sourceIds.length < 2) return;
    if ((e.target as HTMLElement).closest("[data-row-action]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearPress();
    press.current = { y: e.clientY };
    setHoldId(id);
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!sortingRef.current) clearPress();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    timer.current = window.setTimeout(() => {
      press.current = null;
      const next = sourceIds.slice();
      idsRef.current = next;
      sortingRef.current = true;
      setOrder(next);
      setSorting(true);
      setHoldId(null);
    }, 400);
  };

  const onRowMove = (e: PE<HTMLElement>) => {
    if (sortingRef.current || !press.current) return;
    if (Math.abs(e.clientY - press.current.y) > 12) clearPress();
  };

  const onGripDown = (e: PE<HTMLElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = id;
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

  const cancel = () => {
    window.clearTimeout(timer.current);
    sortingRef.current = false;
    dragRef.current = null;
    const el = nearestScroller(listRef.current);
    if (el) el.style.touchAction = "";
    setSorting(false);
    setOrder(null);
    setDragId(null);
    setHoldId(null);
  };

  const savedOrder = () => (idsRef.current.length ? idsRef.current.slice() : sourceIds.slice());

  return {
    sorting,
    order: order ?? sourceIds,
    dragId,
    holdId,
    listRef,
    onRowDown,
    onRowMove,
    onGripDown,
    cancel,
    savedOrder,
  };
}

export function RandomSettings({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (piece: string, how?: "comma" | "line") => void;
}) {
  const bank = useApp((s) => s.settings.random) ?? emptyBank();
  const appearances = useApp((s) => s.appearances);
  const revived = useRef(false);
  const [tab, setTab] = useState<"mods" | "quick">("mods");
  const [editing, setEditing] = useState<RandomModule | null>(null);
  const [creating, setCreating] = useState(false);
  const [sorting, setSorting] = useState(false);
  const sortDo = useRef({ save: () => {}, cancel: () => {} });
  useEffect(() => {
    if (revived.current || !appearances.length) return;
    revived.current = true;
    const cur = useApp.getState().settings.random ?? emptyBank();
    const next = reviveAppearanceModule(cur, appearances);
    if (next !== cur) saveBank(next);
  }, [appearances]);
  return (
    <>
      <Sheet
        z={60}
        title="随机设置"
        onClose={onClose}
        extra={
          sorting ? (
            <SortActions onCancel={() => sortDo.current.cancel()} onSave={() => sortDo.current.save()} />
          ) : (
            <Switch label="随机模式" on={bank.enabled} onChange={(v) => saveBank(bankSwitch(bank, v))} />
          )
        }
      >
        <div className="mb-4 flex gap-6 text-[15px]">
          <button type="button" className={tab === "mods" ? "font-medium text-ink" : "text-muted"} onClick={() => { if (!sorting) setTab("mods"); }}>
            模块管理
          </button>
          <button type="button" className={tab === "quick" ? "font-medium text-ink" : "text-muted"} onClick={() => { if (!sorting) setTab("quick"); }}>
            快速配置
          </button>
        </div>
        {tab === "mods" ? (
          <ModuleList
            bank={bank}
            sortDo={sortDo}
            onSorting={setSorting}
            onEdit={setEditing}
            onCreate={() => setCreating(true)}
            onInsert={onInsert}
          />
        ) : (
          <QuickPick bank={bank} onInsert={onInsert} />
        )}
      </Sheet>
      {creating && (
        <ModuleDraft
          modules={bank.modules}
          groups={bank.groups ?? []}
          onClose={() => setCreating(false)}
          onInsert={(piece) => onInsert(piece, "line")}
          onSave={(mod) => {
            const cur = useApp.getState().settings.random ?? emptyBank();
            const siblings = cur.modules.filter((m) => (m.groupId ?? null) === null);
            const order = siblings.reduce((n, m) => Math.max(n, m.order ?? 0), -1) + 1;
            saveBank({ ...cur, modules: [...cur.modules, { ...mod, groupId: null, order }] });
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <ModuleEditor
          module={bank.modules.find((m) => m.id === editing.id) ?? editing}
          modules={bank.modules}
          groups={bank.groups ?? []}
          onClose={() => setEditing(null)}
          onChange={(next) => saveBank({ ...bank, modules: bank.modules.map((m) => (m.id === next.id ? next : m)) })}
          onInsert={(piece) => onInsert(piece, "line")}
        />
      )}
    </>
  );
}

function SeqTurn({ module, onPick }: { module: RandomModule; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = seqTurnItem(module);
  const pool = module.items.filter((item) => item.enabled);
  return (
    <div className="mt-4">
      <div className="mb-1 text-[13px] text-muted">当前轮到</div>
      <button
        type="button"
        className="flex h-11 w-full items-center gap-2 rounded-full border border-line bg-card px-4 text-left text-[14px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{current ? current.name || "未命名" : "没有选中的项"}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`mt-2 overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-card scroll-thin ${pool.length > 8 ? "max-h-[22rem]" : ""}`}
        >
          {pool.length === 0 && <p className="flex h-11 items-center px-4 text-[14px] text-muted">没有选中的项</p>}
          {pool.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex h-11 w-full items-center px-4 text-left text-[14px] ${item.id === current?.id ? "text-primary" : "text-ink"}`}
              onClick={() => {
                onPick(item.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.name || "未命名"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleEditor({
  module,
  modules,
  groups,
  onClose,
  onChange,
  onInsert,
}: {
  module: RandomModule;
  modules: RandomModule[];
  groups: RandomGroup[];
  onClose: () => void;
  onChange: (m: RandomModule) => void;
  onInsert: (piece: string) => void;
}) {
  const [item, setItem] = useState<RandomItem | "new" | null>(null);
  const [name, setName] = useState(module.name);
  const [savingScheme, setSavingScheme] = useState(false);
  const linked = module.linked === "appearances";
  const sort = useListSort(module.items.map((item) => item.id), !linked);
  const allOn = module.items.length > 0 && module.items.every((item) => item.enabled);
  const allOff = module.items.length > 0 && module.items.every((item) => !item.enabled);
  const setAll = (enabled: boolean) => onChange({ ...module, items: module.items.map((item) => ({ ...item, enabled })) });
  const shown = sort.order
    .map((id) => module.items.find((item) => item.id === id))
    .filter((item): item is RandomItem => !!item);
  const shownIds = useApp((s) => (s.settings.random?.enabled ? (s.settings.random.shownItemIds ?? NO_SHOWN) : NO_SHOWN));
  useEffect(() => setName(module.name), [module.name]);
  const reverse = () => {
    if (shown.length < 2) return;
    if (sort.sorting) sort.cancel();
    const items = [...shown].reverse();
    for (const row of module.items) if (!items.some((item) => item.id === row.id)) items.push(row);
    onChange({ ...module, items });
  };
  return (
    <>
      <Sheet
        z={64}
        title="编辑模块"
        onClose={onClose}
        extra={
          sort.sorting ? (
            <SortActions
              onCancel={() => sort.cancel()}
              onSave={() => {
                const map = new Map(module.items.map((item) => [item.id, item]));
                const items = sort.savedOrder().map((id) => map.get(id)).filter((item): item is RandomItem => !!item);
                for (const item of module.items) if (!items.some((x) => x.id === item.id)) items.push(item);
                onChange({ ...module, items });
                sort.cancel();
              }}
            />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="h-7 shrink-0 whitespace-nowrap rounded-full bg-primary px-3 text-[13px] font-medium text-on-primary"
                onClick={() => setSavingScheme(true)}
              >
                保存方案
              </button>
              <div className="flex shrink-0 items-center gap-1 text-[13px]">
                <button type="button" className={allOn ? "text-primary" : "text-muted"} onClick={() => setAll(true)}>
                  全选
                </button>
                <button type="button" className={allOff ? "text-primary" : "text-muted"} onClick={() => setAll(false)}>
                  全不选
                </button>
              </div>
            </div>
          )
        }
      >
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[13px] text-muted">名称</label>
          <button type="button" className="grid size-5 place-items-center text-ink" aria-label="倒序" onClick={reverse}>
            <span className="flex flex-col">
              <ChevronUp className="size-3" />
              <ChevronDown className="-mt-1 size-3" />
            </span>
          </button>
        </div>
        <TextInput
          value={name}
          disabled={linked}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (linked) {
              setName(module.name);
              return;
            }
            const err = badModuleName(name, modules, module.id);
            if (err) {
              useApp.getState().toast(err);
              setName(module.name);
              return;
            }
            if (name.trim() !== module.name) onChange({ ...module, name: name.trim() });
          }}
        />
        {linked && <p className="mt-1 text-[12px] leading-5 text-muted">这个模块跟着角色选择。名字不能改，加减角色也请到角色选择里。</p>}
        {module.pick === "seq" && <SeqTurn module={module} onPick={(id) => onChange(jumpSeq(module, id))} />}
        <ItemList
          items={shown}
          sorting={sort.sorting}
          dragId={sort.dragId}
          holdId={sort.holdId}
          listRef={sort.listRef}
          onRowDown={sort.onRowDown}
          onRowMove={sort.onRowMove}
          onGripDown={sort.onGripDown}
          canAdd={!linked && !sort.sorting}
          canDelete={!linked}
          shownIds={shownIds}
          scheme={sort.sorting ? undefined : <SchemePicker module={module} onChange={onChange} />}
          onAdd={() => setItem("new")}
          onToggle={(it) => onChange({ ...module, items: module.items.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)) })}
          onEdit={setItem}
          onDelete={(it) =>
            useApp.getState().setUI({
              confirm: {
                title: "删除这一项",
                body: `删除「${it.name || "未命名"}」？`,
                danger: true,
                onOk: () => onChange({ ...module, items: module.items.filter((x) => x.id !== it.id) }),
              },
            })
          }
        />
      </Sheet>
      {item && (
        <ItemEditor
          item={item === "new" ? null : item}
          onClose={() => setItem(null)}
          onSave={(next) => {
            const items = item === "new" ? [...module.items, next] : module.items.map((x) => (x.id === next.id ? next : x));
            onChange({ ...module, items });
            setItem(null);
          }}
          addTargets={{ modules, groups, skipId: module.id }}
          onAddTo={addItemTo}
          onInsert={onInsert}
        />
      )}
      {savingScheme && (
        <SchemeSave
          onClose={() => setSavingScheme(false)}
          onSave={(schemeName) => {
            const list = module.schemes ?? [];
            const order = list.reduce((n, row) => Math.max(n, row.order), -1) + 1;
            const scheme: RandomScheme = {
              id: uid("rs_"),
              name: schemeName,
              order,
              enabled: Object.fromEntries(module.items.map((row) => [row.id, row.enabled])),
            };
            onChange({ ...module, schemes: [...list, scheme] });
            setSavingScheme(false);
            useApp.getState().toast("已保存");
          }}
        />
      )}
    </>
  );
}

function ModuleDraft({
  modules,
  groups,
  onClose,
  onSave,
  onInsert,
}: {
  modules: RandomModule[];
  groups: RandomGroup[];
  onClose: () => void;
  onSave: (m: RandomModule) => void;
  onInsert: (piece: string) => void;
}) {
  const [draft, setDraft] = useState<RandomModule>({
    id: uid("rm_"),
    name: "",
    pick: "random",
    items: [],
    nextId: null,
  });
  const [item, setItem] = useState<RandomItem | "new" | null>(null);
  const askClose = () => {
    useApp.getState().setUI({
      confirm: { title: "关闭", body: "关闭会丢失编辑内容，是否确认关闭？", onOk: onClose },
    });
  };
  return (
    <>
      <Sheet
        z={64}
        title="添加模块"
        onClose={askClose}
        onX={askClose}
        extra={
          <button
            type="button"
            className="text-[14px] text-primary"
            onClick={() => {
              const err = badModuleName(draft.name, modules);
              if (err) {
                useApp.getState().toast(err);
                return;
              }
              onSave({ ...draft, name: draft.name.trim() });
            }}
          >
            保存
          </button>
        }
      >
        <label className="mb-1 block text-[13px] text-muted">名称</label>
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <ItemList
          items={draft.items}
          canAdd
          canDelete
          onAdd={() => setItem("new")}
          onToggle={(it) => setDraft({ ...draft, items: draft.items.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)) })}
          onEdit={setItem}
          onDelete={(it) =>
            useApp.getState().setUI({
              confirm: {
                title: "删除这一项",
                body: `删除「${it.name || "未命名"}」？`,
                danger: true,
                onOk: () => setDraft({ ...draft, items: draft.items.filter((x) => x.id !== it.id) }),
              },
            })
          }
        />
      </Sheet>
      {item && (
        <ItemEditor
          item={item === "new" ? null : item}
          onClose={() => setItem(null)}
          onSave={(next) => {
            const items = item === "new" ? [...draft.items, next] : draft.items.map((x) => (x.id === next.id ? next : x));
            setDraft({ ...draft, items });
            setItem(null);
          }}
          addTargets={{ modules, groups }}
          onAddTo={addItemTo}
          onInsert={onInsert}
        />
      )}
    </>
  );
}

function ItemList({
  items,
  canAdd = true,
  canDelete = true,
  sorting = false,
  dragId = null,
  holdId = null,
  listRef,
  onRowDown,
  onRowMove,
  onGripDown,
  scheme,
  shownIds,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: {
  items: RandomItem[];
  canAdd?: boolean;
  canDelete?: boolean;
  sorting?: boolean;
  dragId?: string | null;
  holdId?: string | null;
  listRef?: Ref<HTMLDivElement>;
  onRowDown?: (e: PE<HTMLElement>, id: string) => void;
  onRowMove?: (e: PE<HTMLElement>) => void;
  onGripDown?: (e: PE<HTMLElement>, id: string) => void;
  scheme?: ReactNode;
  shownIds?: string[];
  onAdd: () => void;
  onToggle: (item: RandomItem) => void;
  onEdit: (item: RandomItem) => void;
  onDelete: (item: RandomItem) => void;
}) {
  return (
    <div className="mt-4" ref={listRef}>
      {canAdd && !scheme && (
        <button
          type="button"
          className="mb-3 flex h-11 w-full items-center justify-center gap-1 rounded-full border border-line text-[14px]"
          onClick={onAdd}
        >
          <Plus className="size-4" /> 新增
        </button>
      )}
      {(canAdd || scheme) && scheme && (
        <div className="mb-3 flex items-stretch gap-2">
          {scheme}
          {canAdd && (
            <button
              type="button"
              className="flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] border border-line px-4 text-[14px]"
              onClick={onAdd}
            >
              <Plus className="size-4" /> 新增
            </button>
          )}
        </div>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          data-sort-id={item.id}
          className={cn(
            "mb-2 flex items-center gap-2 rounded-[16px] border px-3 py-2 select-none hold-none",
            shownIds?.includes(item.id) ? "border-danger" : "border-line",
            dragId === item.id && "bg-ink/15",
            !sorting && holdId === item.id && "bg-ink/8",
          )}
          style={{ touchAction: sorting ? "pan-y" : "manipulation" }}
          onPointerDown={(e) => onRowDown?.(e, item.id)}
          onPointerMove={onRowMove}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!sorting && (
            <button
              type="button"
              data-row-action
              aria-label={item.enabled ? "取消选用" : "选用"}
              className={`size-4 shrink-0 rounded-full border ${item.enabled ? "border-primary bg-primary" : "border-line-strong"}`}
              onClick={() => onToggle(item)}
            />
          )}
          <div className="min-w-0 flex-1 truncate text-[14px]">{item.name || "未命名"}</div>
          {sorting ? (
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center text-muted"
              aria-label={`拖动${item.name || "未命名"}`}
              style={{ touchAction: "none" }}
              onPointerDown={(e) => onGripDown?.(e, item.id)}
            >
              <GripBars />
            </button>
          ) : (
            <>
              {canDelete && (
                <button type="button" data-row-action className="grid size-8 place-items-center text-danger" aria-label="删除" onClick={() => onDelete(item)}>
                  <Trash2 className="size-4" />
                </button>
              )}
              <button type="button" data-row-action className="grid size-8 place-items-center text-muted" aria-label="编辑" onClick={() => onEdit(item)}>
                <Pencil className="size-4" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemEditor({
  item,
  onClose,
  onSave,
  addTargets,
  onAddTo,
  onInsert,
}: {
  item: RandomItem | null;
  onClose: () => void;
  onSave: (item: RandomItem) => void;
  addTargets?: { modules: RandomModule[]; groups: RandomGroup[]; skipId?: string };
  onAddTo?: (moduleId: string, item: { name: string; content: string }) => void;
  onInsert?: (piece: string, how?: "comma" | "line") => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [adding, setAdding] = useState(false);
  const appearances = useApp((s) => s.appearances);
  const source = item?.sourceId ? appearances.find((a) => a.id === item.sourceId) : undefined;
  const contentLocked = Boolean(item?.sourceId);
  const dirty = name !== (item?.name ?? "") || (!contentLocked && content !== (item?.content ?? ""));
  const askClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    useApp.getState().setUI({
      confirm: { title: "关闭", body: "有未保存的更改，是否确认关闭？", onOk: onClose },
    });
  };
  const body = () => (contentLocked ? (source?.prompt ?? item?.content ?? "") : content).trim();
  return (
    <Sheet
      z={68}
      title={item ? "修改" : "新增"}
      onClose={askClose}
      onX={askClose}
      center={
        <button
          type="button"
          className="h-9 rounded-full bg-primary px-4 text-[15px] font-medium text-on-primary"
          onClick={() => {
            if (!name.trim() && !content.trim()) {
              useApp.getState().toast("先写名称或内容");
              return;
            }
            const nextName = name.trim();
            if (item?.sourceId && !nextName) {
              useApp.getState().toast("先写名称");
              return;
            }
            const custom = item?.sourceId ? (source ? nextName !== source.name : item.nameCustom === true) : false;
            onSave({
              id: item?.id ?? uid("ri_"),
              name: nextName,
              content: contentLocked ? (source?.prompt ?? item?.content ?? "") : content,
              enabled: item?.enabled ?? false,
              ...(item?.sourceId ? { sourceId: item.sourceId, ...(custom ? { nameCustom: true } : {}) } : {}),
            });
          }}
        >
          保存
        </button>
      }
    >
      <label className="mb-1 block text-[13px] text-muted">名称</label>
      <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      <label className="mb-1 mt-4 block text-[13px] text-muted">内容</label>
      <TextArea
        className="min-h-[calc(1.5rem+7*1.625em)]"
        value={contentLocked ? (source?.prompt ?? content) : content}
        readOnly={contentLocked}
        onChange={(e) => setContent(e.target.value)}
      />
      <p className="mt-1 text-[11px] leading-4 text-muted">
        写进角色栏：
        <CopyChip text="<角色1:标签>" />
      </p>
      <p className="text-[11px] leading-4 text-muted">
        接到栏首或栏尾：
        <CopyChip text="<正1前:标签>" />
        {"、<正前:标签>、<负后:标签>"}
      </p>
      {contentLocked && <p className="mt-1 text-[12px] leading-5 text-muted">内容跟着角色选择，这里改不了。改名字不会写回去。</p>}
      {(onInsert || (item && onAddTo)) && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {onInsert ? (
            <button
              type="button"
              className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-on-primary"
              onClick={() => {
                const text = body();
                if (!text) {
                  useApp.getState().toast("先写内容");
                  return;
                }
                onInsert(text, "line");
                useApp.getState().toast("已插入");
              }}
            >
              插入
            </button>
          ) : (
            <span />
          )}
          {item && onAddTo ? (
            <button type="button" className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-on-primary" onClick={() => setAdding(true)}>
              添加到
            </button>
          ) : null}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="添加到">
        <AddTargetTree
          modules={addTargets?.modules ?? []}
          groups={addTargets?.groups ?? []}
          skipId={addTargets?.skipId}
          onPick={(id) => {
            const nextName = name.trim();
            const text = contentLocked ? (source?.prompt ?? item?.content ?? "") : content;
            if (!nextName && !text.trim()) {
              useApp.getState().toast("先写名称或内容");
              return;
            }
            onAddTo?.(id, { name: nextName, content: text });
            setAdding(false);
          }}
        />
      </Modal>
    </Sheet>
  );
}

function groupText(groups: string[][]) {
  return groups.map((g) => g.join("&")).join(", ");
}

function groupRanges(groups: string[][]) {
  const ranges: { start: number; end: number }[] = [];
  let at = 0;
  groups.forEach((g, i) => {
    if (i > 0) at += 2;
    const start = at;
    at += g.join("&").length;
    ranges.push({ start, end: at });
  });
  return ranges;
}

function hitGroups(groups: string[][], start: number, end: number, dir: "back" | "fwd") {
  const ranges = groupRanges(groups);
  if (!ranges.length) return [] as number[];
  if (start !== end) {
    return ranges.map((_, i) => i).filter((i) => ranges[i].end > start && ranges[i].start < end);
  }
  const caret = start;
  if (dir === "back") {
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (caret > ranges[i].start && caret <= ranges[i].end) return [i];
      if (caret > ranges[i].end && (i === ranges.length - 1 || caret <= ranges[i + 1].start)) return [i];
    }
    return [];
  }
  for (let i = 0; i < ranges.length; i++) {
    if (caret >= ranges[i].start && caret < ranges[i].end) return [i];
    if (caret < ranges[i].start && (i === 0 || caret >= ranges[i - 1].end)) return [i];
  }
  return [];
}

function dropGroups(groups: string[][], indexes: number[]) {
  if (!indexes.length) return { next: groups, caret: 0 };
  const gone = new Set(indexes);
  const ranges = groupRanges(groups);
  const first = Math.min(...indexes);
  let prev = first - 1;
  while (prev >= 0 && gone.has(prev)) prev--;
  return {
    next: groups.filter((_, i) => !gone.has(i)),
    caret: prev >= 0 ? ranges[prev].end : 0,
  };
}

function QuickPick({ bank, onInsert }: { bank: RandomBank; onInsert: (piece: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const delAt = useRef(0);
  const toggle = (name: string) => setPicked((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  const confirm = () => {
    if (!picked.length) return;
    setGroups((cur) => [...cur, picked]);
    setPicked([]);
  };
  useEffect(() => {
    const el = boxRef.current;
    const n = caretRef.current;
    if (!el || n == null) return;
    caretRef.current = null;
    el.setSelectionRange(n, n);
  }, [groups]);
  const cut = (dir: "back" | "fwd") => {
    const now = Date.now();
    if (now - delAt.current < 40) return;
    delAt.current = now;
    const el = boxRef.current;
    if (!el || !groups.length) return;
    const indexes = hitGroups(groups, el.selectionStart, el.selectionEnd, dir);
    if (!indexes.length) return;
    const dropped = dropGroups(groups, indexes);
    caretRef.current = dropped.caret;
    setGroups(dropped.next);
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-muted">模块池</div>
        <button type="button" className="text-[14px] text-primary" onClick={confirm}>
          确定
        </button>
      </div>
      <PoolTree bank={bank} picked={picked} onToggle={toggle} />
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-muted">已选择</div>
        <button
          type="button"
          className="text-[14px] text-primary"
          onClick={() => {
            if (!groups.length) {
              useApp.getState().toast("还没有选择");
              return;
            }
            onInsert(groups.map((g) => moduleTag(g)).join(","));
            caretRef.current = 0;
            setGroups([]);
            useApp.getState().toast("输出成功");
          }}
        >
          输出
        </button>
      </div>
      <textarea
        ref={boxRef}
        value={groupText(groups)}
        placeholder="点确定后出现在这里。退格删掉一整组。"
        className="min-h-28 w-full resize-none rounded-[16px] border border-line bg-card px-3 py-3 text-[14px] outline-none placeholder:text-muted focus:border-primary/40"
        onChange={() => undefined}
        onPaste={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key !== "Backspace" && e.key !== "Delete") return;
          e.preventDefault();
          cut(e.key === "Backspace" ? "back" : "fwd");
        }}
        onBeforeInput={(e) => {
          const kind = (e.nativeEvent as InputEvent).inputType || "";
          if (kind === "deleteContentBackward" || kind === "deleteContentForward" || kind === "deleteByCut") {
            e.preventDefault();
            cut(kind === "deleteContentForward" ? "fwd" : "back");
            return;
          }
          e.preventDefault();
        }}
      />
    </div>
  );
}

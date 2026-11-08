import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Trash2 } from "lucide-react";
import { autoScrollNearEdge, cn, indexFromY, moveId, nearestScroller } from "@/lib/utils";

export type LibraryItem = { id: string; name: string };

const HOLD_MS = 400;

function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* */
  }
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

export function LibraryDrawer({
  items,
  onApply,
  onDelete,
  onReorder,
  onEdit,
  onAugment,
  label = "角色选择",
  className,
  valueLabel = "(无)",
  showNone = true,
  rowApplies = false,
  maxRows,
  emptyText = "还没有保存的项目",
  deleteAsk,
  hideDelete = false,
}: {
  items: LibraryItem[];
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onEdit?: (id: string) => void;
  onAugment?: (id: string) => void;
  label?: string;
  className?: string;
  valueLabel?: string;
  showNone?: boolean;
  rowApplies?: boolean;
  maxRows?: number;
  emptyText?: string;
  deleteAsk?: (name: string) => string;
  hideDelete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [liveIds, setLiveIds] = useState<string[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pressTimer = useRef(0);
  const press = useRef<{ id: string; y: number } | null>(null);
  const idsRef = useRef<string[]>([]);
  const dragIdRef = useRef<string | null>(null);
  const sortRef = useRef(false);
  const savedRef = useRef(false);
  const lastY = useRef(0);
  const rafRef = useRef(0);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const rowAppliesRef = useRef(rowApplies);
  rowAppliesRef.current = rowApplies;
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const moved = useRef(false);

  const display = (liveIds ?? items.map((c) => c.id))
    .map((id) => items.find((c) => c.id === id))
    .filter((c): c is LibraryItem => Boolean(c));

  const persist = () => {
    if (sortRef.current && idsRef.current.length && !savedRef.current) {
      savedRef.current = true;
      onReorderRef.current(idsRef.current);
    }
  };

  const close = () => {
    persist();
    setOpen(false);
    setSortMode(false);
    setPendingDelete(null);
    setDragId(null);
    setHoldId(null);
    setLiveIds(null);
    dragIdRef.current = null;
    sortRef.current = false;
  };

  const place = () => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(r.width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const top = r.bottom + 4;
    const maxH = Math.min(260, Math.max(120, window.innerHeight - top - 12));
    setPos({ top, left, width, maxH });
  };

  const openMenu = () => {
    savedRef.current = false;
    sortRef.current = false;
    idsRef.current = items.map((c) => c.id);
    setLiveIds(null);
    setSortMode(false);
    setPendingDelete(null);
    setDragId(null);
    place();
    setOpen(true);
  };

  useEffect(() => {
    sortRef.current = sortMode;
    if (sortMode) setPendingDelete(null);
  }, [sortMode]);

  useEffect(() => {
    if (!sortMode && !dragId) {
      idsRef.current = items.map((c) => c.id);
    }
  }, [items, sortMode, dragId]);

  useEffect(() => {
    if (!open) return;
    place();
    const onOutside = (e: PointerEvent) => {
      if (dragIdRef.current) return;
      const t = e.target as Node;
      if (box.current?.contains(t) || menu.current?.contains(t)) return;
      close();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onOutside);
    };
    // close is stable enough via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const applyY = (y: number) => {
      const id = dragIdRef.current;
      if (!id) return;
      const rows = list.current?.querySelectorAll<HTMLElement>("[data-card-id]");
      if (!rows?.length) return;
      const next = moveId(idsRef.current, id, indexFromY(rows, y));
      if (next.join("\0") === idsRef.current.join("\0")) return;
      idsRef.current = next;
      setLiveIds(next);
    };
    const lockScroller = (on: boolean) => {
      const el = nearestScroller(list.current);
      if (el) el.style.touchAction = on ? "none" : "";
    };
    const tick = () => {
      rafRef.current = 0;
      if (!dragIdRef.current) return;
      const scroller = nearestScroller(list.current);
      const dy = scroller ? autoScrollNearEdge(scroller, lastY.current) : 0;
      applyY(lastY.current);
      if (dy) rafRef.current = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragIdRef.current) return;
      e.preventDefault();
      lastY.current = e.clientY;
      const scroller = nearestScroller(list.current);
      const dy = scroller ? autoScrollNearEdge(scroller, e.clientY) : 0;
      applyY(e.clientY);
      if (dy && !rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    const onUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lockScroller(false);
      if (!dragIdRef.current) return;
      dragIdRef.current = null;
      setDragId(null);
      savedRef.current = true;
      onReorderRef.current(idsRef.current);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragIdRef.current) return;
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      window.clearTimeout(pressTimer.current);
      persist();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockScroller = (on: boolean) => {
    const el = nearestScroller(list.current);
    if (el) el.style.touchAction = on ? "none" : "";
  };

  const enterSort = () => {
    const ids = liveIds ?? items.map((c) => c.id);
    idsRef.current = ids;
    savedRef.current = false;
    sortRef.current = true;
    setLiveIds(ids);
    setSortMode(true);
    setHoldId(null);
    setPendingDelete(null);
    buzz();
  };

  const clearPress = () => {
    window.clearTimeout(pressTimer.current);
    press.current = null;
    setHoldId(null);
  };

  const onRowPointerDown = (e: PE<HTMLElement>, id: string) => {
    if (hideDelete || sortRef.current) return;
    moved.current = false;
    if (items.length < 2) return;
    if ((e.target as HTMLElement).closest("[data-row-action]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearPress();
    press.current = { id, y: e.clientY };
    setHoldId(id);
    const endPress = () => {
      window.removeEventListener("pointerup", endPress);
      window.removeEventListener("pointercancel", endPress);
      if (!sortRef.current) clearPress();
    };
    window.addEventListener("pointerup", endPress);
    window.addEventListener("pointercancel", endPress);
    pressTimer.current = window.setTimeout(() => {
      press.current = null;
      enterSort();
    }, HOLD_MS);
  };

  const onRowPointerMove = (e: PE<HTMLElement>) => {
    if (sortRef.current) return;
    const p = press.current;
    if (!p) return;
    if (Math.abs(e.clientY - p.y) + Math.abs(e.movementX) > 12) {
      moved.current = true;
      clearPress();
    }
  };

  const onRowPointerUp = (e: PE<HTMLElement>, id: string) => {
    if (sortRef.current || moved.current) return;
    if ((e.target as HTMLElement).closest("[data-row-action]")) return;
    if (rowAppliesRef.current) {
      onApplyRef.current(id);
      close();
      return;
    }
    if (!onEditRef.current) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && prev.id === id && now - prev.at < 450) {
      lastTap.current = null;
      window.clearTimeout(pressTimer.current);
      press.current = null;
      setHoldId(null);
      onEditRef.current(id);
      close();
      return;
    }
    lastTap.current = { id, at: now };
  };

  const onGripDown = (e: PE<HTMLElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = liveIds ?? items.map((c) => c.id);
    idsRef.current = ids;
    setLiveIds(ids);
    dragIdRef.current = id;
    setDragId(id);
    lastY.current = e.clientY;
    lockScroller(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  return (
    <div className={cn("relative min-w-0", className)} ref={box}>
      <div className="mb-0.5 text-left text-[11px] leading-none text-muted">{label}</div>
      <button
        ref={trigger}
        type="button"
        className="flex h-9 w-full items-center justify-between rounded-full border border-line bg-card px-3 text-[13px]"
        onClick={() => (open ? close() : openMenu())}
      >
        <span className="min-w-0 truncate">{valueLabel}</span>
        <ChevronDown className={cn("size-3.5 text-muted transition", open && "rotate-180")} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className="fixed z-[80] overflow-hidden rounded-[16px] border border-line bg-card shadow-[0_16px_40px_rgb(44_40_36/0.16)]"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              userSelect: "none",
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              ref={list}
              className="overflow-auto scroll-thin overscroll-contain"
              style={{ maxHeight: maxRows ? Math.min(pos.maxH, maxRows * 34) : pos.maxH, minHeight: maxRows ? 34 : undefined }}
            >
              {showNone && (
                <button
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-left text-[13px] text-muted"
                  onClick={close}
                >
                  (无)
                </button>
              )}
              {display.map((c) => (
                <div
                  key={c.id}
                  data-card-id={c.id}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 select-none hold-none",
                    dragId === c.id && "rounded-lg bg-ink/15 drag-dim",
                    !sortMode && holdId === c.id && "rounded-lg bg-ink/8",
                  )}
                  style={{ touchAction: sortMode ? "pan-y" : "manipulation" }}
                  onPointerDown={(e) => onRowPointerDown(e, c.id)}
                  onPointerMove={onRowPointerMove}
                  onPointerUp={(e) => {
                    onRowPointerUp(e, c.id);
                    clearPress();
                  }}
                  onPointerCancel={clearPress}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{c.name}</span>
                  {sortMode ? (
                    <button
                      type="button"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink/55"
                      aria-label={`拖动${c.name}`}
                      onPointerDown={(e) => onGripDown(e, c.id)}
                      style={{ touchAction: "none" }}
                    >
                      <GripBars />
                    </button>
                  ) : (
                    <>
                      {onAugment && (
                        <button
                          type="button"
                          data-row-action
                          className="h-6 shrink-0 rounded-full border border-primary px-2 text-[11px] leading-none text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAugment(c.id);
                            close();
                          }}
                        >
                          增选
                        </button>
                      )}
                      {!rowApplies && (
                        <button
                          type="button"
                          data-row-action
                          className="h-6 shrink-0 rounded-full bg-primary px-2 text-[11px] leading-none text-on-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApply(c.id);
                            close();
                          }}
                        >
                          应用
                        </button>
                      )}
                      {!hideDelete && (
                        <button
                          type="button"
                          data-row-action
                          className="grid size-6 shrink-0 place-items-center text-danger"
                          aria-label={`删除${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(c.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              {items.length === 0 && <div className="px-2.5 py-2 text-[12px] text-muted">{emptyText}</div>}
              {items.length > 0 && !sortMode && !hideDelete && (onEdit || items.length > 1) ? (
                <p className="px-3 pb-1 pt-0.5 text-[9px] leading-4 text-muted">
                  {onEdit && items.length > 1 ? "双击修改 · 长按排序" : onEdit ? "双击修改" : "长按进入排序"}
                </p>
              ) : null}
            </div>
            {pendingDelete && !sortMode ? (
              <div className="border-t border-line bg-card px-3 py-2">
                <p className="text-[13px]">
                  {deleteAsk
                    ? deleteAsk(items.find((c) => c.id === pendingDelete)?.name ?? "")
                    : `删除「${items.find((c) => c.id === pendingDelete)?.name ?? ""}」？`}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    data-row-action
                    className="h-8 flex-1 rounded-full bg-dim text-[13px]"
                    onClick={() => setPendingDelete(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    data-row-action
                    className="h-8 flex-1 rounded-full bg-danger text-[13px] text-white"
                    onClick={() => {
                      onDelete(pendingDelete);
                      setPendingDelete(null);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minus, Minimize2, Pencil, Plus, RefreshCw, Settings, Smile, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { getImage, imageUrl } from "@/lib/idb";
import { genPhaseLabel } from "@/lib/image-status";
import { modelLabel, samplerLabel } from "@/lib/nai";
import { extractGrokTail } from "@/lib/nai-tags";
import { compressRef, isImageFile } from "@/lib/ref-image";
import { saveBlob, useApp } from "@/lib/store";
import type { Chat, GenImage, LlmAccount, WechatAttach, WechatLine, WechatLog, WechatSession, WechatSticker } from "@/lib/types";
import { emptyWechatSession, ensureMultiSession, describeSticker, lineImages, paintWechat, queueStickerBrief, regenWechat, regenContinueFrom, sendWechat, continueWechat, cancelWechat, sessionHasLines, summarizeWechat, WECHAT_GROUP, wechatIsMulti, wechatTurnText, cancelWechatImage, wechatRoute } from "@/lib/wechat";
import { autoScrollNearEdge, downloadBlob, indexFromY, moveId, nearestScroller, uid } from "@/lib/utils";
import { ImagePick } from "./ImagePick";
import { ChatAvatar, useCooldown } from "./ui-kit";

const EMOJI = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😜",
  "🤔", "😅", "😭", "😡", "🥺", "😏", "😴", "🤗",
  "👍", "👎", "👏", "🙏", "👌", "✌️", "🤝", "💪",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔",
  "🎉", "✨", "🔥", "⭐", "🌙", "☀️", "🌈", "⚡",
];

export function WechatDock({ chat }: { chat: Chat }) {
  const session = useApp((s) => s.wechatSessions[chat.id] ?? null);
  const view = useApp((s) => (s.ui.wechatView?.chatId === chat.id ? s.ui.wechatView : null));
  if (view) {
    const msg = chat.messages.find((m) => m.id === view.msgId);
    if (msg?.wechatLog) {
      return (
        <WechatRead
          chat={chat}
          msgId={msg.id}
          log={msg.wechatLog}
          onClose={() => useApp.getState().setUI({ wechatView: null })}
        />
      );
    }
  }
  if (session && !session.minimized) return <WechatLive chat={chat} session={session} />;
  return null;
}

export function openWechat(chat: Chat) {
  const cur = useApp.getState().wechatSessions[chat.id];
  useApp.getState().setUI({ wechatView: null });
  if (cur) {
    const next = wechatIsMulti(chat) ? ensureMultiSession(chat, { ...cur, minimized: false }) : { ...cur, minimized: false };
    useApp.getState().setWechatSession(chat.id, next);
    return;
  }
  const fresh = emptyWechatSession(chat.characters[0]?.id || "");
  useApp.getState().setWechatSession(chat.id, wechatIsMulti(chat) ? ensureMultiSession(chat, fresh) : fresh);
}

function WechatLive({ chat, session }: { chat: Chat; session: WechatSession }) {
  const stickers = useApp((s) => s.wechatStickers);
  const cooldownUntil = useApp((s) => s.settings.cooldownUntil);
  const left = useCooldown(cooldownUntil);
  const portrait = chat.imageParams.height >= chat.imageParams.width;
  const [emoji, setEmoji] = useState(false);
  const [tab, setTab] = useState<"emoji" | "heart">("emoji");
  const [phase, setPhase] = useState<"idle" | "type" | "sum">("idle");
  const [ask, setAsk] = useState<null | "close" | "fail">(null);
  const [openInner, setOpenInner] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const char = chat.characters.find((c) => c.id === session.charId) || chat.characters[0];
  const multi = wechatIsMulti(chat);
  const active = multi ? session.activeRoom || chat.characters[0]?.id || WECHAT_GROUP : "";
  const room = multi ? session.rooms?.[active] : undefined;
  const lines = room ? room.lines : session.lines;
  const draft = room ? room.draft : session.draft;
  const pending = room ? room.pending : session.pending;
  const activeChar = multi && active !== WECHAT_GROUP ? chat.characters.find((c) => c.id === active) : char;
  const name = multi ? (active === WECHAT_GROUP ? "群聊" : activeChar?.name.trim() || "她") : char?.name.trim() || chat.name || "她";
  const [full, setFull] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [book, setBook] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [editFrom, setEditFrom] = useState<string | null>(null);
  const [editBackup, setEditBackup] = useState<{ room: string; draft: string; pending: WechatAttach[] } | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, phase, pending.length, active]);

  const patch = (p: Partial<WechatSession>) => {
    const cur = useApp.getState().wechatSessions[chat.id];
    if (!cur) return;
    useApp.getState().setWechatSession(chat.id, { ...cur, ...p });
  };

  const patchView = (p: { draft?: string; pending?: WechatAttach[] }) => {
    if (!multi) {
      patch(p);
      return;
    }
    const cur = useApp.getState().wechatSessions[chat.id];
    if (!cur?.rooms || !active) return;
    const rooms = { ...cur.rooms, [active]: { ...cur.rooms[active], ...p } };
    useApp.getState().setWechatSession(chat.id, { ...cur, rooms });
  };

  const addPending = (items: WechatAttach[]) => {
    const roomLeft = 9 - pending.length;
    if (roomLeft <= 0) {
      useApp.getState().toast("最多 9 张");
      return;
    }
    if (items.length > roomLeft) useApp.getState().toast("最多 9 张");
    patchView({ pending: [...pending, ...items.slice(0, roomLeft)] });
  };

  const send = () => {
    if (phase === "sum") return;
    if (!draft.trim() && !pending.length) return;
    setPhase("type");
    setEmoji(false);
    const from = editFrom && lines.some((l) => l.id === editFrom) ? editFrom : undefined;
    setEditFrom(null);
    setEditBackup(null);
    setPicked(null);
    void sendWechat(chat, () => setPhase("idle"), from);
  };

  const cancelEdit = () => {
    if (editBackup) {
      const back = editBackup;
      if (!multi || back.room === active) patchView({ draft: back.draft, pending: back.pending });
      else {
        const cur = useApp.getState().wechatSessions[chat.id];
        const room = cur?.rooms?.[back.room];
        if (cur && room) {
          useApp.getState().setWechatSession(chat.id, {
            ...cur,
            rooms: { ...cur.rooms, [back.room]: { ...room, draft: back.draft, pending: back.pending } },
          });
        }
      }
    }
    setEditFrom(null);
    setEditBackup(null);
  };

  const close = () => {
    const cur = useApp.getState().wechatSessions[chat.id];
    if (!cur || !sessionHasLines(cur)) {
      useApp.getState().setWechatSession(chat.id, null);
      return;
    }
    setAsk("close");
  };

  const discard = () => {
    setAsk(null);
    useApp.getState().setWechatSession(chat.id, null);
  };

  const commit = (summary: string) => {
    const cur = useApp.getState().wechatSessions[chat.id];
    if (!cur) return;
    const log: WechatLog = cur.rooms
      ? {
          charName: "微信",
          lines: [],
          summary,
          rooms: cur.rooms,
          activeRoom: cur.activeRoom,
          roomNames: Object.fromEntries([
            ...chat.characters.map((c) => [c.id, c.name.trim() || "角色"]),
            [WECHAT_GROUP, "群聊"],
          ]),
        }
      : {
          charName: name,
          lines: cur.lines,
          summary,
        };
    useApp.getState().patchChat(chat.id, (ch) => ({
      ...ch,
      messages: [
        ...ch.messages,
        {
          id: uid("m_"),
          role: "user" as const,
          content: wechatTurnText(summary),
          images: [],
          createdAt: Date.now(),
          wechatLog: log,
        },
      ],
    }));
    useApp.getState().setWechatSession(chat.id, null);
    setAsk(null);
    setPhase("idle");
  };

  const save = async () => {
    const cur = useApp.getState().wechatSessions[chat.id];
    if (!cur) return;
    setAsk(null);
    setPhase("sum");
    try {
      const summary = await summarizeWechat(chat, cur);
      commit(summary);
    } catch (e) {
      setPhase("idle");
      setAsk("fail");
      useApp.getState().toast(e instanceof Error ? e.message : "总结失败");
    }
  };

  return (
    <Shell
      title={phase === "type" ? "正在输入中..." : name}
      onClose={close}
      full={full}
      onFull={() => setFull((v) => !v)}
      onMinimize={() => {
        setFull(false);
        patch({ minimized: true });
      }}
      onGear={() => setApiOpen(true)}
      scrollRef={scroller}
      overlay={
        ask ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 px-8">
            <div className="relative w-full rounded-2xl bg-white p-4 text-black">
              {ask === "close" ? (
                <button type="button" className="absolute right-3 top-3" aria-label="取消" onClick={() => setAsk(null)}>
                  <X className="size-5" />
                </button>
              ) : null}
              <div className="mb-4 pr-6 text-[15px]">{ask === "close" ? "是否保存当前微信内容到聊天" : "总结没写成"}</div>
              <div className="flex gap-2">
                {ask === "close" ? (
                  <>
                    <button type="button" className="flex-1 rounded-lg border border-neutral-300 py-2" onClick={discard}>
                      不保存
                    </button>
                    <button type="button" className="flex-1 rounded-lg bg-[#95EC69] py-2" onClick={() => void save()}>
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="flex-1 rounded-lg border border-neutral-300 py-2 text-[13px]" onClick={() => commit("")}>
                      仅保存微信聊天
                    </button>
                    <button type="button" className="flex-1 rounded-lg bg-[#95EC69] py-2" onClick={() => void save()}>
                      重试
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null
      }
      footer={
        <>
          {pending.length ? (
            <div className="mb-2 flex gap-2 overflow-x-auto">
              {pending.map((item, i) => (
                <PendingThumb
                  key={`${item.blobId}-${i}`}
                  blobId={item.blobId}
                  mark={item.kind === "sticker" ? "表情" : ""}
                  onRemove={() => patchView({ pending: pending.filter((_, at) => at !== i) })}
                />
              ))}
            </div>
          ) : null}
          <div className="mb-2 flex items-center gap-1.5 text-[13px] text-black">
            <div className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-1.5">
              <button
                type="button"
                className={portrait ? "font-medium text-black" : "text-neutral-400"}
                onClick={() => {
                  if (!portrait) {
                    useApp.getState().patchParams(chat.id, {
                      width: chat.imageParams.height,
                      height: chat.imageParams.width,
                    });
                  }
                }}
              >
                竖图
              </button>
              <span className="text-neutral-300">|</span>
              <button
                type="button"
                className={!portrait ? "font-medium text-black" : "text-neutral-400"}
                onClick={() => {
                  if (portrait) {
                    useApp.getState().patchParams(chat.id, {
                      width: chat.imageParams.height,
                      height: chat.imageParams.width,
                    });
                  }
                }}
              >
                横图
              </button>
            </div>
            <button
              type="button"
              className={`mx-auto inline-flex h-[22px] items-center rounded-md border px-2 ${session.armed ? "border-red-500 text-red-500" : "border-neutral-300 text-neutral-500"}`}
              onClick={() => patch({ armed: !session.armed })}
            >
              {left > 0 ? `${left}s` : "可生图"}
            </button>
            <button
              type="button"
              className={`inline-flex h-[22px] items-center rounded-md border border-neutral-300 px-1.5 ${chat.adultBoost ? "font-medium text-black" : "text-neutral-400"}`}
              onClick={() => useApp.getState().patchChat(chat.id, { adultBoost: !chat.adultBoost })}
            >
              成人提示词
            </button>
          </div>
          {multi ? (
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {chat.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] ${c.id === active ? "border-red-500 text-red-500" : "border-neutral-300 text-neutral-500"}`}
                  onClick={() => patch({ activeRoom: c.id })}
                >
                  {c.name.trim() || "角色"}
                </button>
              ))}
              <button
                type="button"
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] ${active === WECHAT_GROUP ? "border-red-500 text-red-500" : "border-neutral-300 text-neutral-500"}`}
                onClick={() => patch({ activeRoom: WECHAT_GROUP })}
              >
                群聊
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-1.5">
            {emoji ? (
              <button type="button" className="grid size-9 shrink-0 place-items-center text-neutral-500" onClick={() => setEmoji(false)} aria-label="收起表情">
                <ChevronLeft className="size-5" />
              </button>
            ) : null}
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              className="max-h-24 min-h-9 flex-1 resize-none rounded-md bg-white px-3 py-2 text-[15px] text-black outline-none"
              onChange={(e) => patchView({ draft: e.target.value })}
            />
            <button
              type="button"
              className={`grid size-9 shrink-0 place-items-center ${emoji ? "text-red-500" : "text-neutral-600"}`}
              aria-label="表情"
              onClick={() => setEmoji((v) => !v)}
            >
              <Smile className="size-6" />
            </button>
            <ImagePick
              multiple
              onFile={() => undefined}
              onFiles={(files) => void addFiles(files, addPending)}
              onBlobs={(ids) => void addBlobs(ids, "photo", addPending)}
              render={(open) => (
                <button type="button" className="grid size-9 shrink-0 place-items-center text-neutral-600" aria-label="添加" onClick={open}>
                  <Plus className="size-6" />
                </button>
              )}
            />
            <button
              type="button"
              className="grid size-9 shrink-0 place-items-center rounded-md bg-[#95EC69] text-black disabled:opacity-40"
              aria-label={phase === "type" ? "停止" : "发送"}
              disabled={phase === "sum" || (phase !== "type" && !draft.trim() && !pending.length)}
              onClick={() => {
                if (phase === "type") {
                  cancelWechat(chat.id);
                  return;
                }
                send();
              }}
            >
              {phase === "type" ? <span className="size-2.5 rounded-[2px] bg-neutral-600" /> : <ArrowUp className="size-5" />}
            </button>
          </div>
          {editFrom ? (
            <div className="flex justify-center pt-1">
              <button type="button" className="text-[12px] text-neutral-500" onClick={cancelEdit}>
                取消编辑
              </button>
            </div>
          ) : null}
          {emoji ? (
            <EmojiPanel
              tab={tab}
              setTab={setTab}
              stickers={stickers}
              onEmoji={(ch) => {
                patchView({ draft: draft + ch });
                inputRef.current?.focus();
              }}
              onSticker={(blobId) => addPending([{ blobId, kind: "sticker" }])}
              onDeleteSticker={(blobId) => {
                useApp.getState().setWechatStickers(useApp.getState().wechatStickers.filter((s) => s.blobId !== blobId));
              }}
              onAddSticker={(blobId) => {
                useApp.getState().setWechatStickers([...useApp.getState().wechatStickers, { blobId, brief: "" }]);
                try {
                  queueStickerBrief(blobId, chat.grokModelId, wechatRoute(chat));
                } catch (e) {
                  useApp.getState().toast(e instanceof Error ? e.message : "请重选模型");
                }
              }}
              onOpenBook={() => setBook(true)}
            />
          ) : null}
        </>
      }
    >
      {book
        ? createPortal(
            <StickerBook chat={chat} grokModelId={chat.grokModelId} onClose={() => setBook(false)} />,
            document.body,
          )
        : null}
      {apiOpen ? <WechatApiDialog chat={chat} onClose={() => setApiOpen(false)} /> : null}
      <Thread
        chat={chat}
        name={name}
        lines={lines}
        names={multi && active === WECHAT_GROUP}
        speakerId={multi && active !== WECHAT_GROUP ? active : undefined}
        openInner={openInner}
        toggleInner={(id) => setOpenInner((m) => ({ ...m, [id]: !m[id] }))}
        picked={picked}
        onPick={(id) => setPicked((cur) => (cur === id ? null : id))}
        onRegen={(id) => {
          cancelEdit();
          setPicked(null);
          setPhase("type");
          void regenWechat(chat, id, () => setPhase("idle"));
        }}
        onRegenNode={(id) => {
          cancelEdit();
          setPicked(null);
          setPhase("type");
          void regenContinueFrom(chat, id, () => setPhase("idle"));
        }}
        onEdit={(line) => {
          setEditBackup((prev) => prev ?? { room: active, draft, pending: pending.map((item) => ({ ...item })) });
          patchView({ draft: line.text, pending: line.attachments.map((item) => ({ ...item })) });
          setEditFrom(line.id);
          setPicked(null);
        }}
      />
      {phase !== "sum" && ([...lines].reverse().find((line) => !line.continued)?.role === "assistant" || phase === "type") ? (
        <div className="flex justify-center py-2">
          <button
            type="button"
            className="rounded-full border border-neutral-300 bg-white px-5 py-1 text-[14px]"
            onClick={() => {
              cancelEdit();
              setPhase("type");
              void continueWechat(chat, () => setPhase("idle"));
            }}
          >
            继续
          </button>
        </div>
      ) : null}
      {phase === "sum" ? <div className="py-2 text-center text-[12px] text-neutral-500">正在总结</div> : null}
    </Shell>
  );
}

function WechatRead({ chat, msgId, log, onClose }: { chat: Chat; msgId: string; log: WechatLog; onClose: () => void }) {
  const [openInner, setOpenInner] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState(false);
  const [summing, setSumming] = useState(false);
  const rooms = log.rooms;
  const tabs = rooms ? readRoomTabs(chat, log) : [];
  const [room, setRoom] = useState(() => initialRoom(chat, log));
  const lines = rooms ? rooms[room]?.lines ?? [] : log.lines;
  const group = Boolean(rooms && room === WECHAT_GROUP);
  const title = !rooms
    ? log.charName || "微信"
    : group
      ? "群聊"
      : chat.characters.find((c) => c.id === room)?.name.trim() || log.roomNames?.[room] || "微信";
  const redoSummary = async () => {
    if (summing || log.voided) return;
    const session = logToSession(chat, log);
    if (!sessionHasLines(session)) {
      useApp.getState().toast("没有聊天内容");
      return;
    }
    setSumming(true);
    try {
      const summary = await summarizeWechat(chat, session);
      useApp.getState().patchChat(chat.id, (ch) => ({
        ...ch,
        messages: ch.messages.map((m) =>
          m.id === msgId && m.wechatLog ? { ...m, content: wechatTurnText(summary), wechatLog: { ...m.wechatLog, summary } } : m,
        ),
      }));
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : "总结失败");
    } finally {
      setSumming(false);
    }
  };
  return (
    <Shell
      title={title}
      onClose={onClose}
      full={full}
      onFull={() => setFull((v) => !v)}
      footer={
        tabs.length ? (
          <div className="flex gap-1.5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] ${tab.id === room ? "border-red-500 text-red-500" : "border-neutral-300 text-neutral-500"}`}
                onClick={() => setRoom(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {lines.length ? (
        <Thread
          chat={chat}
          name={title}
          lines={lines}
          names={group}
          speakerId={rooms && !group ? room : undefined}
          roomNames={log.roomNames}
          openInner={openInner}
          toggleInner={(id) => setOpenInner((m) => ({ ...m, [id]: !m[id] }))}
          readOnly
        />
      ) : rooms ? (
        <div className="py-8 text-center text-[13px] text-neutral-400">这里还没有聊天</div>
      ) : null}
      {log.summary.trim() ? (
        <div className="mt-4 rounded-lg bg-white px-3 py-2 text-[13px] leading-relaxed text-black">
          <div className="mb-1 flex items-center">
            <div className="text-[12px] text-neutral-400">总结</div>
            {!log.voided ? (
              <button
                type="button"
                className="ml-auto text-[12px] text-neutral-500 disabled:opacity-50"
                disabled={summing}
                onClick={() => void redoSummary()}
              >
                {summing ? "总结中" : "重置"}
              </button>
            ) : null}
          </div>
          {log.summary}
        </div>
      ) : (
        <div className="mt-4 text-center text-[12px] text-neutral-400">这段还没有总结</div>
      )}
    </Shell>
  );
}

function logToSession(chat: Chat, log: WechatLog): WechatSession {
  const named = log.charName.trim();
  const char = chat.characters.find((c) => c.name.trim() && c.name.trim() === named);
  return {
    charId: char?.id ?? chat.characters[0]?.id ?? "",
    lines: log.lines ?? [],
    earlier: "",
    folded: 0,
    draft: "",
    pending: [],
    armed: false,
    minimized: false,
    ...(log.rooms ? { rooms: log.rooms, activeRoom: log.activeRoom } : {}),
  };
}

function initialRoom(chat: Chat, log: WechatLog) {
  const rooms = log.rooms;
  if (!rooms) return "";
  if (log.activeRoom && rooms[log.activeRoom]) return log.activeRoom;
  const first = chat.characters.find((c) => rooms[c.id]);
  if (first) return first.id;
  return Object.keys(rooms)[0] || "";
}

function readRoomTabs(chat: Chat, log: WechatLog) {
  const rooms = log.rooms;
  if (!rooms) return [];
  const tabs: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const c of chat.characters) {
    if (!rooms[c.id]) continue;
    seen.add(c.id);
    tabs.push({ id: c.id, label: c.name.trim() || log.roomNames?.[c.id] || "角色" });
  }
  for (const id of Object.keys(rooms)) {
    if (id === WECHAT_GROUP || seen.has(id)) continue;
    tabs.push({ id, label: log.roomNames?.[id] || "角色" });
  }
  if (rooms[WECHAT_GROUP]) tabs.push({ id: WECHAT_GROUP, label: "群聊" });
  return tabs;
}

const EMPTY_ACCOUNTS: LlmAccount[] = [];

function WechatApiDialog({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const accounts = useApp((s) => s.settings.llmAccounts) ?? EMPTY_ACCOUNTS;
  const pick = chat.wechatAi;
  const account = accounts.find((a) => a.id === pick?.accountId);
  const [open, setOpen] = useState<null | "account" | "model">(null);
  const models = account?.starred ?? [];
  const chooseAccount = (id: string | null) => {
    if (!id) useApp.getState().patchChat(chat.id, { wechatAi: undefined });
    else {
      const next = accounts.find((a) => a.id === id);
      const keep = pick?.model && next?.starred?.includes(pick.model) ? pick.model : "";
      useApp.getState().patchChat(chat.id, { wechatAi: { accountId: id, model: keep } });
    }
    setOpen(null);
  };
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-6 pt-[22vh]">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭" onClick={onClose} />
      <div className="relative h-[210px] w-full max-w-sm overflow-visible rounded-[24px] bg-[#F7F7F7] text-black shadow-2xl">
        <div className="flex items-center px-4 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 text-[18px] font-semibold">微信 API 设置</h2>
          <button type="button" className="grid size-8 place-items-center" aria-label="关闭" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="px-4">
          <ApiDrawer title="账号列表" label={account?.name || "与主聊天一致"} open={open === "account"} onToggle={() => setOpen(open === "account" ? null : "account")}>
            <DrawerRow on={!pick?.accountId} onClick={() => chooseAccount(null)}>与主聊天一致</DrawerRow>
            {accounts.map((a) => (
              <DrawerRow key={a.id} on={a.id === pick?.accountId} onClick={() => chooseAccount(a.id)}>
                {a.name || "未命名"}
              </DrawerRow>
            ))}
            {accounts.length === 0 ? <div className="px-4 py-3 text-[13px] text-neutral-500">还没有保存的账号</div> : null}
          </ApiDrawer>
          <ApiDrawer
            title="模型列表"
            label={!account ? "先选账号" : pick?.model || "请选择"}
            open={open === "model"}
            dim={!account}
            onToggle={() => {
              if (!account) {
                useApp.getState().toast("先选一个账号");
                return;
              }
              setOpen(open === "model" ? null : "model");
            }}
          >
            {models.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-neutral-500">先去主设置收藏</div>
            ) : (
              models.map((m) => (
                <DrawerRow
                  key={m}
                  on={m === pick?.model}
                  onClick={() => {
                    useApp.getState().patchChat(chat.id, { wechatAi: { accountId: account!.id, model: m } });
                    setOpen(null);
                  }}
                >
                  {m}
                </DrawerRow>
              ))
            )}
          </ApiDrawer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ApiDrawer({
  title,
  label,
  open,
  dim,
  onToggle,
  children,
}: {
  title: string;
  label: string;
  open: boolean;
  dim?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative mb-3">
      <button type="button" className="flex h-11 w-full items-center rounded-full bg-white px-4 text-left" onClick={onToggle}>
        <span className="w-20 shrink-0 text-[14px]">{title}</span>
        <span className={`min-w-0 flex-1 truncate text-right text-[13px] ${dim ? "text-neutral-400" : ""}`}>{label}</span>
        <ChevronDown className={`ml-2 size-4 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="absolute left-0 right-0 top-12 z-20 max-h-44 overflow-y-auto rounded-2xl bg-white py-1 shadow-lg">{children}</div> : null}
    </div>
  );
}

function DrawerRow({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`block h-11 w-full truncate px-4 text-left text-[14px] ${on ? "text-primary" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Shell({
  title,
  onClose,
  children,
  footer,
  overlay,
  scrollRef,
  full,
  onFull,
  onMinimize,
  onGear,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  full?: boolean;
  onFull?: () => void;
  onMinimize?: () => void;
  onGear?: () => void;
}) {
  const node = (
    <div className={full ? "fixed inset-0 z-[80] flex bg-[#EDEDED]" : "absolute inset-0 z-30 flex justify-center bg-black/40 px-4 py-8"}>
      <div className={full ? "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#EDEDED] text-black" : "relative flex h-full min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-[#EDEDED] text-black shadow-2xl"}>
        <div className="relative flex shrink-0 items-center px-4 py-3">
          <button type="button" className="absolute left-4" aria-label={full ? "还原" : "全屏"} onClick={onFull}>
            {full ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </button>
          {onMinimize ? (
            <button type="button" className="absolute left-11" aria-label="收起" onClick={onMinimize}>
              <Minus className="size-5" />
            </button>
          ) : null}
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
            <span />
            <span className="truncate text-center text-[16px] font-medium">{title}</span>
            <span className="flex items-center justify-start pl-1">
              {onGear ? (
                <button type="button" className="grid size-4 place-items-center" aria-label="微信 API 设置" onClick={onGear}>
                  <Settings className="size-4" />
                </button>
              ) : null}
            </span>
          </div>
          <button type="button" className="absolute right-4" aria-label="关闭" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {children}
        </div>
        {footer ? <div className="shrink-0 border-t border-black/5 bg-[#F7F7F7] px-3 py-2">{footer}</div> : null}
        {overlay}
      </div>
    </div>
  );
  if (full) return createPortal(node, document.body);
  return node;
}

function Thread({
  chat,
  name,
  lines,
  names,
  speakerId,
  roomNames,
  openInner,
  toggleInner,
  picked,
  onPick,
  onRegen,
  onRegenNode,
  onEdit,
  readOnly,
}: {
  chat: Chat;
  name: string;
  lines: WechatLine[];
  names?: boolean;
  /** 私聊房间的角色。群聊和单人不用。 */
  speakerId?: string;
  roomNames?: Record<string, string>;
  openInner: Record<string, boolean>;
  toggleInner: (id: string) => void;
  picked?: string | null;
  onPick?: (id: string) => void;
  onRegen?: (id: string) => void;
  onRegenNode?: (id: string) => void;
  onEdit?: (line: WechatLine) => void;
  readOnly?: boolean;
}) {
  const nodes = continueNodeIds(lines);
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line) =>
        line.continued ? null : line.role === "user" ? (
          <div key={line.id} className="flex flex-col items-end gap-1" onClick={() => onPick?.(line.id)}>
            {line.text.trim() ? <UserBubble text={line.text} /> : null}
            {line.attachments.map((a, i) => (
              <Shot key={`${a.blobId}-${i}`} blobId={a.blobId} />
            ))}
            {!readOnly && picked === line.id ? (
              <div className="flex gap-2 text-neutral-600" onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label="重新生成" onClick={() => onRegen?.(line.id)}>
                  <RefreshCw className="size-4" />
                </button>
                <button type="button" aria-label="编辑" onClick={() => onEdit?.(line)}>
                  <Pencil className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div key={line.id} className="flex items-start gap-2">
            {names && !line.speakerId ? (
              <div className="w-8 shrink-0" />
            ) : (
              <ChatAvatar
                chat={faceOf(chat, line.speakerId || speakerId)}
                name={speakerLabel(chat, line.speakerId || speakerId, name, roomNames)}
                size={32}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start">
              {names && line.speakerId ? (
                <div className="mb-1 max-w-[75%] text-[12px] leading-4 text-[#888]">
                  {speakerLabel(chat, line.speakerId, name, roomNames)}
                </div>
              ) : null}
              <div className="flex flex-col items-start gap-1">
                {line.text.trim() ? <HerBubble text={line.text} /> : null}
                {line.attachments.map((a, i) => (
                  <Shot key={`${a.blobId}-${i}`} blobId={a.blobId} />
                ))}
                {lineImages(line).length ? <WechatShot chat={chat} lineId={line.id} images={lineImages(line)} readOnly={readOnly} /> : null}
                {line.inner ? (
                  <div className="flex items-center gap-1 text-[12px] leading-none text-neutral-500">
                    <button type="button" className="flex items-center gap-0.5" onClick={() => toggleInner(line.id)}>
                      {openInner[line.id] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      <span>{nodes.has(line.id) ? "内心(节点)" : "内心"}</span>
                    </button>
                    {nodes.has(line.id) && openInner[line.id] && onRegenNode ? (
                      <button type="button" aria-label="重新生成" className="grid size-3 place-items-center" onClick={() => onRegenNode(line.id)}>
                        <RefreshCw className="size-3" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {line.inner && openInner[line.id] ? (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-md bg-white/80 px-2 py-1 text-[12px] leading-relaxed text-neutral-700">
                    {line.inner}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function continueNodeIds(lines: WechatLine[]) {
  const ids = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].continued) continue;
    if (!lines.slice(i + 1).some((line) => line.role === "assistant")) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].continued) break;
      if (lines[j].role === "assistant" && lines[j].inner) {
        ids.add(lines[j].id);
        break;
      }
    }
  }
  return ids;
}

function speakerLabel(chat: Chat, speakerId: string | undefined, fallback: string, roomNames?: Record<string, string>) {
  if (!speakerId) return fallback;
  const named = chat.characters.find((c) => c.id === speakerId)?.name.trim();
  return named || roomNames?.[speakerId] || fallback || "她";
}

function faceOf(chat: Chat, speakerId?: string): Chat {
  if (!speakerId) return chat;
  const blob = chat.characters.find((c) => c.id === speakerId)?.wechatAvatarBlobId;
  if (!blob) return chat;
  return { ...chat, customAvatarBlobId: blob };
}

function UserBubble({ text }: { text: string }) {
  return <div className="max-w-[75%] rounded-[6px] bg-[#95EC69] px-3 py-2 text-[15px] leading-snug text-black">{text}</div>;
}

function HerBubble({ text }: { text: string }) {
  return <div className="max-w-[75%] rounded-[6px] bg-white px-3 py-2 text-[15px] leading-snug text-black">{text}</div>;
}

function Shot({ blobId }: { blobId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void imageUrl(blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [blobId]);
  if (!url) return <div className="h-24 w-24 rounded-[4px] bg-white" />;
  return <img src={url} alt="" className="max-h-40 max-w-[70%] rounded-[4px] object-contain" />;
}

function WechatShot({ chat, lineId, images, readOnly }: { chat: Chat; lineId: string; images: GenImage[]; readOnly?: boolean }) {
  const done = images.filter((g) => g.status === "done" && g.blobId);
  const pending = images.find((g) => g.status !== "done" && g.status !== "error");
  const [idx, setIdx] = useState(() => Math.max(0, done.length - 1));
  const [url, setUrl] = useState<string | null>(null);
  const [kick, setKick] = useState<GenImage["source"] | null>(null);
  const [saved, setSaved] = useState(false);
  const [flashErr, setFlashErr] = useState<string | null>(null);
  const prevDone = useRef(done.length);
  const seenFail = useRef("");
  const current = done[idx] ?? done[done.length - 1];
  const latest = images.at(-1);
  const failed = latest?.status === "error" ? latest : undefined;
  const busy = kick ?? pending?.source ?? null;
  const phase = genPhaseLabel(pending?.status) || (kick === "rewrite" || kick === "auto" ? "写提示词中" : kick ? "上传中" : "");
  const locked = Boolean(pending) || Boolean(kick);

  useEffect(() => {
    if (!pending) setKick(null);
  }, [pending]);

  useEffect(() => {
    if (done.length > prevDone.current) setIdx(done.length - 1);
    else if (idx >= done.length && done.length > 0) setIdx(done.length - 1);
    prevDone.current = done.length;
  }, [done.length, idx]);

  useEffect(() => {
    let gone = false;
    if (current?.blobId) {
      void imageUrl(current.blobId).then((u) => {
        if (!gone) setUrl(u);
      });
    } else setUrl(null);
    return () => {
      gone = true;
    };
  }, [current?.blobId]);

  useEffect(() => {
    if (pending || !failed || !current?.blobId) {
      if (!failed) setFlashErr(null);
      return;
    }
    if (seenFail.current === failed.id) return;
    seenFail.current = failed.id;
    setFlashErr(genPhaseLabel("error", failed.error));
    const t = window.setTimeout(() => setFlashErr(null), 2000);
    return () => window.clearTimeout(t);
  }, [pending, failed, current?.blobId]);

  const run = (mode: "same" | "rewrite") => {
    setKick(mode);
    void paintWechat(chat, lineId, mode).finally(() => setKick(null));
  };

  const openCustom = () => {
    const src = pending && (pending.prompt || pending.charTails) ? pending : current ?? pending;
    if (!src) return;
    useApp.getState().setUI({
      customPrompt: {
        chatId: chat.id,
        msgId: lineId,
        wechatLineId: lineId,
        imgId: src.id,
        text: extractGrokTail(src.prompt, chat.imageParams) || src.prompt || "",
        charTails: { ...(src.charTails || {}) },
      },
    });
  };

  return (
    <div className="w-full">
      {current ? (
        <div className="mb-1 flex flex-wrap gap-x-1.5 text-[10px] text-neutral-500">
          <span>{modelLabel(current.model)}</span>
          <span>
            {current.width}×{current.height}
          </span>
          <span>{current.steps}步</span>
          <span>{samplerLabel(current.sampler)}</span>
        </div>
      ) : null}
      <div className="relative max-w-[240px] overflow-hidden rounded-[14px] bg-neutral-200">
        {current && url ? (
          <div className="relative">
            <img src={url} alt="" className="w-full" />
            {done.length > 1 ? (
              <>
                <button type="button" className="absolute inset-y-0 left-0 w-1/2" aria-label="上一张" onClick={() => setIdx((i) => (i - 1 + done.length) % done.length)} />
                <button type="button" className="absolute inset-y-0 right-0 w-1/2" aria-label="下一张" onClick={() => setIdx((i) => (i + 1) % done.length)} />
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid place-items-center px-2 text-[12px] text-neutral-500" style={{ aspectRatio: `${chat.imageParams.width} / ${chat.imageParams.height}` }}>
            {pending || kick ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                {phase || "准备中"}
                {!readOnly ? (
                  <button type="button" className="text-red-500" onClick={() => cancelWechatImage(chat.id, lineId)}>
                    取消
                  </button>
                ) : null}
              </span>
            ) : failed ? (
              <span className="text-center text-red-500">{genPhaseLabel("error", failed.error)}</span>
            ) : (
              "还没有图"
            )}
          </div>
        )}
      </div>
      {flashErr ? <div className="mt-1 truncate text-center text-[10px] leading-4 text-red-500">{flashErr}</div> : null}
      {!readOnly ? (
        <div className="mt-1.5 grid grid-cols-4 text-center text-[10px] leading-none text-neutral-500">
          <ShotBtn
            icon={<RefreshCw className="size-3.5" />}
            label={busy === "same" && phase ? phase : "重新生成"}
            busy={busy === "same"}
            disabled={locked || !current}
            onClick={() => {
              if (busy === "same") {
                cancelWechatImage(chat.id, lineId);
                return;
              }
              if (locked || !current) return;
              run("same");
            }}
          />
          <ShotBtn
            icon={<Sparkles className="size-3.5" />}
            label={(busy === "rewrite" || busy === "auto") && phase ? phase : "换提示词生成"}
            busy={busy === "rewrite" || busy === "auto"}
            disabled={locked}
            onClick={() => {
              if (busy === "rewrite" || busy === "auto") {
                cancelWechatImage(chat.id, lineId);
                return;
              }
              if (locked) return;
              run("rewrite");
            }}
          />
          <ShotBtn
            icon={saved ? <Check className="size-3.5 text-good" /> : <Download className="size-3.5" />}
            label="下载"
            disabled={!current?.blobId}
            onClick={() => {
              if (!current?.blobId) return;
              void imageUrl(current.blobId).then(async (u) => {
                if (!u) return;
                const blob = await fetch(u).then((r) => r.blob());
                downloadBlob(blob, String(current.seed));
                setSaved(true);
                window.setTimeout(() => setSaved(false), 1000);
              });
            }}
          />
          <ShotBtn
            icon={<Wand2 className="size-3.5" />}
            label={busy === "custom" && phase ? phase : "自定义修改"}
            busy={busy === "custom"}
            disabled={!current && !pending}
            onClick={openCustom}
          />
        </div>
      ) : null}
    </div>
  );
}

function ShotBtn({
  icon,
  label,
  onClick,
  busy,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy ? false : disabled}
      className={busy ? "flex min-w-0 flex-col items-center gap-1 px-0.5 py-1 text-primary" : "flex min-w-0 flex-col items-center gap-1 px-0.5 py-1 disabled:opacity-40"}
    >
      {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function PendingThumb({ blobId, mark, onRemove }: { blobId: string; mark?: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void imageUrl(blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [blobId]);
  return (
    <div className="relative shrink-0">
      {url ? <img src={url} alt="" className="h-16 w-14 rounded-md object-cover" /> : <div className="h-16 w-14 rounded-md bg-white" />}
      {mark ? <span className="absolute bottom-0 left-0 bg-black/50 px-1 text-[10px] text-white">{mark}</span> : null}
      <button type="button" className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-white text-black" onClick={onRemove} aria-label="去掉">
        <X className="size-3" />
      </button>
    </div>
  );
}

function EmojiPanel({
  tab,
  setTab,
  stickers,
  onEmoji,
  onSticker,
  onDeleteSticker,
  onAddSticker,
  onOpenBook,
}: {
  tab: "emoji" | "heart";
  setTab: (t: "emoji" | "heart") => void;
  stickers: WechatSticker[];
  onEmoji: (ch: string) => void;
  onSticker: (blobId: string) => void;
  onDeleteSticker: (blobId: string) => void;
  onAddSticker: (blobId: string) => void;
  onOpenBook: () => void;
}) {
  return (
    <div className="mt-2 border-t border-black/5 pt-2">
      <div className="mb-2 flex gap-4 text-[14px]">
        <button type="button" className={tab === "emoji" ? "text-red-500" : "text-neutral-500"} onClick={() => setTab("emoji")}>
          Emoji
        </button>
        <button type="button" className={tab === "heart" ? "text-red-500" : "text-neutral-500"} onClick={() => setTab("heart")}>
          ♥
        </button>
      </div>
      {tab === "emoji" ? (
        <div className="grid max-h-36 grid-cols-8 gap-1 overflow-y-auto">
          {EMOJI.map((ch) => (
            <button key={ch} type="button" className="py-1 text-[22px]" onClick={() => onEmoji(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid max-h-44 grid-cols-5 gap-1.5 overflow-y-auto">
          <ImagePick
            onFile={(file) => {
              void compressRef(file, 512, 0.85).then(async (blob) => onAddSticker(await saveBlob(blob)));
            }}
            render={(open) => (
              <button type="button" className="grid aspect-square place-items-center rounded-md border border-dashed border-neutral-300 text-neutral-500" onClick={open} aria-label="上传表情包">
                <Plus className="size-5" />
              </button>
            )}
          />
          {stickers.map((s) => (
            <StickerTile key={s.blobId} blobId={s.blobId} onPick={() => onSticker(s.blobId)} onDelete={() => onDeleteSticker(s.blobId)} />
          ))}
          <button type="button" className="grid aspect-square place-items-center rounded-md border border-dashed border-neutral-300 text-neutral-500" onClick={onOpenBook} aria-label="表情包设置">
            <Pencil className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function StickerTile({ blobId, onPick, onDelete }: { blobId: string; onPick: () => void; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const skip = useRef(false);
  useEffect(() => {
    let dead = false;
    void imageUrl(blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [blobId]);
  return (
    <button
      type="button"
      className="aspect-square overflow-hidden rounded-md bg-white"
      onClick={() => {
        if (skip.current) {
          skip.current = false;
          return;
        }
        onPick();
      }}
      onPointerDown={() => {
        skip.current = false;
        timer.current = window.setTimeout(() => {
          skip.current = true;
          onDelete();
        }, 500);
      }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerLeave={() => window.clearTimeout(timer.current)}
    >
      {url ? <img src={url} alt="" className="size-full object-contain" /> : null}
    </button>
  );
}

function sameStickers(a: WechatSticker[], b: WechatSticker[]) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.blobId === b[i]?.blobId && s.brief === b[i]?.brief);
}

function GripBars() {
  return (
    <span className="flex flex-col items-center justify-center gap-[3px]" aria-hidden>
      <span className="h-[2px] w-4 rounded-full bg-current" />
      <span className="h-[2px] w-4 rounded-full bg-current" />
      <span className="h-[2px] w-4 rounded-full bg-current" />
    </span>
  );
}

function StickerBook({ chat, grokModelId, onClose }: { chat?: Chat; grokModelId?: string; onClose: () => void }) {
  const saved = useApp((s) => s.wechatStickers);
  const [rows, setRows] = useState<WechatSticker[]>(() => saved.map((s) => ({ ...s })));
  const [sortMode, setSortMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [leave, setLeave] = useState(false);
  const [dropId, setDropId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const dragRef = useRef<string | null>(null);
  const lastY = useRef(0);
  const rafRef = useRef(0);
  const touched = useRef(new Set<string>());
  const hold = useRef(0);
  rowsRef.current = rows;

  useEffect(() => {
    setRows((cur) => {
      let changed = false;
      const next = cur.map((row) => {
        if (touched.current.has(row.blobId)) return row;
        const live = saved.find((s) => s.blobId === row.blobId);
        if (!live || live.brief === row.brief) return row;
        changed = true;
        return { ...row, brief: live.brief };
      });
      return changed ? next : cur;
    });
  }, [saved]);

  useEffect(() => {
    const applyY = (y: number) => {
      const id = dragRef.current;
      if (!id) return;
      const nodes = listRef.current?.querySelectorAll<HTMLElement>("[data-sticker-id]");
      if (!nodes?.length) return;
      const order = rowsRef.current.map((s) => s.blobId);
      const nextIds = moveId(order, id, indexFromY(nodes, y));
      if (nextIds.join("\0") === order.join("\0")) return;
      const byId = new Map(rowsRef.current.map((s) => [s.blobId, s]));
      const next = nextIds.map((blobId) => byId.get(blobId)).filter((s): s is WechatSticker => !!s);
      rowsRef.current = next;
      setRows(next);
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
      if (!dragRef.current) return;
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
  }, []);

  const save = () => {
    useApp.getState().setWechatStickers(rowsRef.current.map((s) => ({ ...s })));
    onClose();
  };

  const requestClose = () => {
    if (!sameStickers(rowsRef.current, useApp.getState().wechatStickers)) setLeave(true);
    else onClose();
  };

  const regen = (blobId: string) => {
    if (busyId) return;
    setBusyId(blobId);
    touched.current.add(blobId);
    let route: Record<string, unknown> | null = null;
    if (chat) {
      try {
        route = wechatRoute(chat);
      } catch {
        setBusyId((id) => (id === blobId ? null : id));
        return;
      }
    }
    void describeSticker(blobId, grokModelId, route)
      .then((brief) => {
        if (!brief) return;
        setRows((cur) => cur.map((s) => (s.blobId === blobId ? { ...s, brief } : s)));
      })
      .catch((e: unknown) => {
        useApp.getState().toast(e instanceof Error ? e.message : "简述没写成");
      })
      .finally(() => setBusyId((id) => (id === blobId ? null : id)));
  };

  const onGripDown = (e: PE<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = id;
    setDragId(id);
    lastY.current = e.clientY;
    const scroller = nearestScroller(listRef.current);
    if (scroller) scroller.style.touchAction = "none";
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-5 pt-[12vh]">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={requestClose} />
      <div className="relative flex max-h-[calc(100dvh-12vh-24px)] w-full max-w-sm flex-col overflow-hidden rounded-[24px] bg-white text-black shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[18px] font-semibold">表情包设置</h2>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-md border border-neutral-300 px-3 py-1 text-[14px]" onClick={save}>
              保存
            </button>
            <button type="button" className="grid size-9 place-items-center" aria-label="关闭" onClick={requestClose}>
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {rows.length === 0 ? <p className="py-6 text-center text-[14px] text-neutral-400">还没有表情包</p> : null}
          <div className="flex flex-col gap-4">
            {rows.map((row) => (
              <StickerBriefRow
                key={row.blobId}
                row={row}
                sortMode={sortMode}
                dragging={dragId === row.blobId}
                busy={busyId === row.blobId}
                onChange={(brief) => {
                  touched.current.add(row.blobId);
                  setRows((cur) => cur.map((s) => (s.blobId === row.blobId ? { ...s, brief } : s)));
                }}
                onRegen={() => regen(row.blobId)}
                onDelete={() => setDropId(row.blobId)}
                onHold={() => setSortMode(true)}
                onGripDown={(e) => onGripDown(e, row.blobId)}
                holdRef={hold}
              />
            ))}
          </div>
        </div>
        {leave ? (
          <Ask
            text="是否保存修改？"
            no="否"
            yes="是"
            onNo={onClose}
            onYes={save}
          />
        ) : null}
        {dropId ? (
          <Ask
            text="是否删除这张表情包？"
            no="否"
            yes="是"
            danger
            onNo={() => setDropId(null)}
            onYes={() => {
              touched.current.add(dropId);
              setRows((cur) => cur.filter((s) => s.blobId !== dropId));
              setDropId(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Ask({
  text,
  no,
  yes,
  danger,
  onNo,
  onYes,
}: {
  text: string;
  no: string;
  yes: string;
  danger?: boolean;
  onNo: () => void;
  onYes: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-8">
      <div className="w-full rounded-2xl bg-white p-4">
        <p className="text-[15px]">{text}</p>
        <div className="mt-4 flex justify-end gap-4">
          <button type="button" className="text-[14px] text-neutral-500" onClick={onNo}>
            {no}
          </button>
          <button type="button" className={danger ? "text-[14px] font-medium text-red-500" : "text-[14px] font-medium"} onClick={onYes}>
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}

function StickerBriefRow({
  row,
  sortMode,
  dragging,
  busy,
  onChange,
  onRegen,
  onDelete,
  onHold,
  onGripDown,
  holdRef,
}: {
  row: WechatSticker;
  sortMode: boolean;
  dragging: boolean;
  busy: boolean;
  onChange: (brief: string) => void;
  onRegen: () => void;
  onDelete: () => void;
  onHold: () => void;
  onGripDown: (e: PE<HTMLButtonElement>) => void;
  holdRef: RefObject<number>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const start = useRef({ x: 0, y: 0 });
  useEffect(() => {
    let dead = false;
    void imageUrl(row.blobId).then((u) => {
      if (!dead) setUrl(u);
    });
    return () => {
      dead = true;
    };
  }, [row.blobId]);

  const clearHold = () => window.clearTimeout(holdRef.current);

  return (
    <div data-sticker-id={row.blobId} className={`flex items-start gap-3 ${dragging ? "opacity-60" : ""}`}>
      <button
        type="button"
        className="size-16 shrink-0 overflow-hidden rounded-md bg-neutral-100 select-none hold-none"
        aria-label="长按排序"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (sortMode) return;
          start.current = { x: e.clientX, y: e.clientY };
          clearHold();
          holdRef.current = window.setTimeout(onHold, 420);
        }}
        onPointerMove={(e) => {
          if (Math.abs(e.clientX - start.current.x) + Math.abs(e.clientY - start.current.y) > 12) clearHold();
        }}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
      >
        {url ? <img src={url} alt="" draggable={false} className="size-full object-contain" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-end">
          <button type="button" className="grid size-7 place-items-center text-neutral-500 disabled:opacity-40" aria-label="重新生成" disabled={busy} onClick={onRegen}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
          <button type="button" className="grid size-7 place-items-center text-neutral-500" aria-label="删除" onClick={onDelete}>
            <Trash2 className="size-4" />
          </button>
        </div>
        <textarea
          value={row.brief}
          placeholder="还没有简述"
          className="min-h-16 w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[14px] leading-snug text-black outline-none [field-sizing:content]"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {sortMode ? (
        <button
          type="button"
          className="mt-3 grid size-9 shrink-0 place-items-center text-neutral-500"
          aria-label="拖动排序"
          style={{ touchAction: "none" }}
          onPointerDown={onGripDown}
        >
          <GripBars />
        </button>
      ) : null}
    </div>
  );
}

async function addFiles(files: File[], add: (items: WechatAttach[]) => void) {
  const items: WechatAttach[] = [];
  for (const file of files) {
    if (!isImageFile(file)) continue;
    const blob = await compressRef(file, 1024, 0.85);
    items.push({ blobId: await saveBlob(blob), kind: "photo" });
  }
  if (items.length) add(items);
}

async function addBlobs(ids: string[], kind: WechatAttach["kind"], add: (items: WechatAttach[]) => void) {
  const items: WechatAttach[] = [];
  for (const id of ids) {
    const blob = await getImage(id);
    if (!blob) continue;
    items.push({ blobId: await saveBlob(blob), kind });
  }
  if (!items.length && ids.length) {
    useApp.getState().toast("这张图已经不在了");
    return;
  }
  add(items);
}

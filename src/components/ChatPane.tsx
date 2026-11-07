import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { getImage, imageUrl } from "@/lib/idb";
import { compressRef } from "@/lib/ref-image";
import { modelLabel, samplerLabel } from "@/lib/nai";
import { extractGrokTail } from "@/lib/nai-tags";
import { joinPromptParts } from "@/lib/constants";
import { ImagePick } from "./ImagePick";
import { openWechat } from "./WechatPane";
import { cancelWechatImage, paintWechat, lineImages } from "@/lib/wechat";
import { saveBlob, useApp } from "@/lib/store";
import { downloadBlob, cn } from "@/lib/utils";
import { foldWindow, genPhaseLabel, stripStatus } from "@/lib/engine";
import { presentScene, readScene, writeScene, type AffinityBits, type SceneCard, type StatusLine } from "@/lib/scene-bar";
import { isWorkshopChat, replyLooksLikeCard, workshopTitle } from "@/lib/workshop";
import { memoryCaughtUp } from "@/lib/chat-memory";
import { splitDialogue, stripSpeakerPrefix } from "@/lib/rp-text";
import { fontStack, readLook, sayWeight } from "@/lib/look";
import { SceneBackdrop } from "./LookSheet";
import { parseReplyMarkup, type ReplyFold } from "@/lib/reply-markup";
import type { Chat, ChatMessage, GenImage, ImageGenSource, MultiMode, PromptInsertMode, UserShot } from "@/lib/types";
import { CHAT_SHOT_MAX, messageShots } from "@/lib/user-markup";
import { attachImage, abortChat, branchFrom, cancelImage, cancelMemory, editMessage, regenMessage, replyPending, retryMemory, sendUser } from "./chat-actions";
import { ChatModelSelect } from "./ModelSelect";
import { ChatAvatar, ExpandSelect, Modal, TextArea, useCooldown, ZoomImg } from "./ui-kit";

const noShots: UserShot[] = [];

export function ChatPane({ chat }: { chat: Chat }) {
  const cooldownUntil = useApp((s) => s.settings.cooldownUntil);
  const left = useCooldown(cooldownUntil);
  const chatImage = useApp((s) => s.settings.chatImage !== false);
  const memoryHint = useApp((s) => s.ui.memoryHint);
  const editUser = useApp((s) => (s.ui.editUserMsg?.chatId === chat.id ? s.ui.editUserMsg : null));
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const draft = useApp((s) => s.composerDrafts[chat.id] ?? "");
  const shots = useApp((s) => s.composerShots[chat.id] ?? noShots);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = chat.scrollTop || 0;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
  }, [chat.id]);

  useEffect(() => {
    if (editUser) requestAnimationFrame(() => inputRef.current?.focus());
  }, [editUser?.msgId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    useApp.getState().patchChat(chat.id, { scrollTop: el.scrollTop });
  };

  const startUserEdit = (msg: ChatMessage) => {
    const backup = editUser ? editUser.backup : draft;
    const shotBackup = editUser ? editUser.shotBackup : shots.length ? shots.map((s) => ({ ...s })) : null;
    useApp.getState().setUI({ editUserMsg: { chatId: chat.id, msgId: msg.id, backup, shotBackup } });
    useApp.getState().setComposerDraft(chat.id, msg.content);
    useApp.getState().setComposerShot(chat.id, messageShots(msg));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cancelUserEdit = () => {
    if (!editUser) return;
    useApp.getState().setComposerDraft(chat.id, editUser.backup);
    useApp.getState().setComposerShot(chat.id, editUser.shotBackup);
    useApp.getState().setUI({ editUserMsg: null });
  };

  const send = () => {
    const t = draft;
    if (editUser) {
      const pending = shots.length ? shots : null;
      if (!t.trim() && !pending) {
        useApp.getState().toast("写点字，或留一张图");
        return;
      }
      const { msgId, backup, shotBackup } = editUser;
      useApp.getState().setUI({ editUserMsg: null });
      useApp.getState().setComposerDraft(chat.id, backup);
      useApp.getState().setComposerShot(chat.id, shotBackup);
      void editMessage(chat.id, msgId, t, pending);
      return;
    }
    useApp.getState().setComposerDraft(chat.id, "");
    const pending = shots.length ? shots : undefined;
    useApp.getState().setComposerShot(chat.id, null);
    void sendUser(chat.id, t, pending);
  };

  const portrait = chat.imageParams.height >= chat.imageParams.width;
  const { W, I } = foldWindow();
  const memOk = memoryCaughtUp(chat.messages.length, chat.memoryUntil || 0, W, I);
  const memMine = memoryHint?.chatId === chat.id;
  const memGenerating = memMine && memoryHint?.state === "generating";
  const memOkFlash = memMine && memoryHint?.state === "ok";
  const memFail = !memOk && !memGenerating && !memOkFlash;
  const failReason = memMine && memoryHint?.state === "fail" ? memoryHint.error : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex shrink-0 items-center justify-center gap-1 px-2 py-1">
        {chat.isMulti && (
          <div className="absolute left-2">
            <ExpandSelect<PromptInsertMode>
              value={chat.promptMode}
              options={[
                { id: "insert", label: "插入版" },
                { id: "legacy", label: "原版" },
              ]}
              onChange={(id) => useApp.getState().patchChat(chat.id, { promptMode: id })}
              menu="start"
            />
          </div>
        )}
        <ChatModelSelect />
        {chat.isMulti && (
          <div className="absolute right-2">
            <ExpandSelect<MultiMode>
              value={chat.multiMode}
              options={[
                { id: "together", label: "多人同聊模式" },
                { id: "group", label: "群聊模式" },
              ]}
              onChange={(id) => useApp.getState().patchChat(chat.id, { multiMode: id })}
              menu="end"
            />
          </div>
        )}
      </div>

      <div className="relative z-[1] min-h-0 flex-1">
        <ChatScene chat={chat} />
        <div ref={scroller} onScroll={onScroll} className="relative z-[1] h-full overflow-y-auto px-4 pb-4 scroll-thin">
        {chat.messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl bg-card px-4 py-4 text-[13px] leading-7 text-primary">
            <p>聊天：在输入框里写完点发送即可。</p>
            <p>生图参数：只作用于当前角色的配图，模型、提示词、分辨率、步数都在那里改。</p>
            <p>纯生图：只出图，不聊天，参数和聊天完全独立。</p>
            <p>顶栏可切换当前用的模型。润色人设、写提示词、聊天回复都用同一个。</p>
            <p className="text-muted">
              对 {chat.name || "她"} 说点什么。(动作) 是已经发生的事实，《》是给 AI 的指令，角色听不见。
            </p>
          </div>
        )}
        {chat.messages.map((m) => (
          <Bubble
            key={m.id}
            chat={chat}
            msg={m}
            showImageTray={chatImage && !isWorkshopChat(chat) && m.role !== "user"}
            onUseOption={(t) => {
              useApp.getState().setComposerDraft(chat.id, t);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onEditUser={m.role === "user" ? () => startUserEdit(m) : undefined}
          />
        ))}
        </div>
      </div>

      <div className="shrink-0 bg-bg px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-1">
        {!isWorkshopChat(chat) && <WechatChip chatId={chat.id} />}
        {!isWorkshopChat(chat) && (
        <div className="mb-1.5 flex h-6 items-center gap-1.5 px-0.5 text-[13px] leading-none">
          <div className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-line bg-card px-1.5">
            <button
              className={cnToggle(portrait)}
              onClick={() => {
                if (!portrait)
                  useApp.getState().patchParams(chat.id, {
                    width: chat.imageParams.height,
                    height: chat.imageParams.width,
                  });
              }}
            >
              竖图
            </button>
            <span className="text-faint">|</span>
            <button
              className={cnToggle(!portrait)}
              onClick={() => {
                if (portrait)
                  useApp.getState().patchParams(chat.id, {
                    width: chat.imageParams.height,
                    height: chat.imageParams.width,
                  });
              }}
            >
              横图
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            {chatImage ? (
              left > 0 ? (
                <span className="font-medium text-danger">{left}s</span>
              ) : (
                <span className="text-good">可生图</span>
              )
            ) : (
              <span className="text-muted">生图已关</span>
            )}
          </div>
          <button
            className={
              chat.adultBoost
                ? "inline-flex h-[22px] items-center rounded-md border border-line px-1.5 font-medium text-ink"
                : "inline-flex h-[22px] items-center rounded-md border border-line px-1.5 text-muted"
            }
            onClick={() => useApp.getState().patchChat(chat.id, { adultBoost: !chat.adultBoost })}
          >
            成人提示词
          </button>
        </div>
        )}
        {memGenerating || memOkFlash || memFail ? (
          <div className="flex items-center gap-2 px-[52px] pb-1 text-[12px]">
            <span className={memFail ? "min-w-0 flex-1 text-danger" : memOkFlash ? "min-w-0 flex-1 text-good" : "min-w-0 flex-1 text-faint"}>
              {memGenerating
                ? "生成记忆中"
                : memOkFlash
                  ? "记忆已生成"
                  : failReason
                    ? `记忆生成失败（${failReason}）`
                    : "记忆生成失败"}
            </span>
            {memGenerating ? (
              <button type="button" className="shrink-0 text-muted" onClick={() => cancelMemory(chat.id)}>
                取消
              </button>
            ) : memFail ? (
              <button type="button" className="shrink-0 text-muted" onClick={() => retryMemory(chat.id)}>
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {shots.length ? (
          <div className="mb-2 ml-11 flex gap-2 overflow-x-auto pb-1">
            {shots.map((shot, i) => (
              <div key={`${shot.blobId}-${i}`} className="flex shrink-0 flex-col items-center gap-1">
                <ComposerThumb
                  blobId={shot.blobId}
                  onRemove={() => {
                    const next = shots.filter((_, at) => at !== i);
                    useApp.getState().setComposerShot(chat.id, next.length ? next : null);
                  }}
                />
                <button
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-[12px] ${shot.i2i ? "border-primary bg-primary text-on-primary" : "border-line text-muted"}`}
                  onClick={() => {
                    const on = !shot.i2i;
                    useApp.getState().setComposerShot(
                      chat.id,
                      shots.map((s, at) => ({ ...s, i2i: on && at === i })),
                    );
                  }}
                >
                  以图生图
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <button
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted"
            onClick={() => {
              const el = scroller.current;
              if (!el) return;
              if (atBottom) el.scrollTo({ top: 0, behavior: "smooth" });
              else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label={atBottom ? "回到顶部" : "回到底部"}
          >
            {atBottom ? <ChevronDown className="size-5 rotate-180" /> : <ArrowDown className="size-5" />}
          </button>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => useApp.getState().setComposerDraft(chat.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (replyPending(chat.id)) abortChat(chat.id);
                else send();
              }
            }}
            rows={1}
            placeholder=""
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-full border border-line bg-card px-4 py-3 text-[14px] outline-none"
          />
          <ImagePick
            multiple
            onFile={() => undefined}
            onFiles={(files) => void addChatShots(chat.id, files, null)}
            onBlobs={(ids) => void addChatShots(chat.id, null, ids)}
            onWechat={() => openWechat(chat)}
            render={(open) => (
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink"
                aria-label="添加图片"
                onClick={open}
              >
                <Plus className="size-5" />
              </button>
            )}
          />
          <button
            onClick={() => {
              if (replyPending(chat.id)) {
                abortChat(chat.id);
                return;
              }
              send();
            }}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary"
            aria-label={replyPending(chat.id) ? "停止" : editUser ? "保存" : "发送"}
          >
            {replyPending(chat.id) ? <span className="size-2.5 rounded-[2px] bg-on-primary" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
        {editUser ? (
          <div className="flex justify-center pt-1">
            <button type="button" className="text-[12px] text-muted" onClick={cancelUserEdit}>
              取消编辑
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerThumb({ blobId, onRemove }: { blobId: string; onRemove: () => void }) {
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
    <div className="relative">
      {url ? (
        <ZoomImg src={url} className="h-24 w-20 rounded-[14px] object-cover" />
      ) : (
        <div className="h-24 w-20 rounded-[14px] bg-dim" />
      )}
      <button
        type="button"
        className="absolute -right-1 -top-1 z-10 grid size-6 place-items-center rounded-full bg-card text-ink"
        aria-label="去掉图片"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

async function addChatShots(chatId: string, files: File[] | null, blobIds: string[] | null) {
  const room = CHAT_SHOT_MAX - (useApp.getState().composerShots[chatId]?.length ?? 0);
  if (room <= 0) {
    useApp.getState().toast("最多 9 张");
    return;
  }
  const wanted = files ? files.length : (blobIds?.length ?? 0);
  if (wanted > room) useApp.getState().toast("最多 9 张");
  const added: UserShot[] = [];
  if (files) {
    for (const file of files.slice(0, room)) {
      const blob = await compressRef(file, 1024, 0.85);
      added.push({ blobId: await saveBlob(blob), i2i: false });
    }
  } else {
    for (const id of (blobIds ?? []).slice(0, room)) {
      const blob = await getImage(id);
      if (!blob) continue;
      added.push({ blobId: await saveBlob(blob), i2i: false });
    }
    if (!added.length) {
      useApp.getState().toast("这张图已经不在了");
      return;
    }
  }
  const latest = useApp.getState().composerShots[chatId] ?? [];
  useApp.getState().setComposerShot(chatId, [...latest, ...added].slice(0, CHAT_SHOT_MAX));
}

function UserShot({ blobId, i2i }: { blobId: string; i2i?: boolean }) {
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
    <div className="flex flex-col items-end">
      {url ? (
        <ZoomImg src={url} className="h-28 max-w-full rounded-[14px] object-cover" />
      ) : (
        <div className="h-28 w-24 rounded-[14px] bg-dim" />
      )}
      {i2i ? <div className="mt-1 text-[11px] text-muted">以图生图</div> : null}
    </div>
  );
}

function jumpParams(section: string) {
  useApp.getState().setUI({ paramsJump: section });
  useApp.getState().setTab("params");
}

function cnToggle(on: boolean) {
  return on ? "px-1 font-medium text-ink" : "px-1 text-muted";
}

function WechatChip({ chatId }: { chatId: string }) {
  const on = useApp((s) => s.wechatSessions[chatId]?.minimized === true);
  if (!on) return null;
  return (
    <button
      type="button"
      className="mx-auto mb-2 block rounded-full border border-line bg-card px-4 py-1.5 text-[13px] text-ink"
      onClick={() => {
        const cur = useApp.getState().wechatSessions[chatId];
        if (!cur) return;
        useApp.getState().setWechatSession(chatId, { ...cur, minimized: false });
      }}
    >
      微信聊天中...
    </button>
  );
}

const SCENE_BOX = "rounded-[16px] border border-line bg-surface/60 px-3.5 py-3 text-[13px] leading-6 text-ink";

function deltaMark(delta: number) {
  if (delta > 0) return `📈+${delta}`;
  if (delta < 0) return `📉${delta}`;
  return "0";
}

function AffinityFace({ a, lookSay }: { a: AffinityBits; lookSay: string }) {
  return (
    <div>
      <div className="text-[15px] leading-snug">
        <span className="font-bold">💞好感度:</span>
        <span className="font-bold" style={{ color: "#d23a3a" }}>
          {a.value}
        </span>
        <span>
          [{deltaMark(a.delta)}Ⅰ{a.stage}]
        </span>
      </div>
      <div className="mt-1" style={{ color: lookSay, fontWeight: 700, fontStyle: "italic" }}>
        「{a.quote}」
      </div>
    </div>
  );
}

function StatusLines({ lines }: { lines: StatusLine[] }) {
  return (
    <div className="mt-2 whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div key={i}>
          <span className="font-bold">{line.title}:</span>
          {line.value}
        </div>
      ))}
    </div>
  );
}

function SceneFace({
  card,
  lookSay,
  statusOn,
  loveOn,
}: {
  card: SceneCard;
  lookSay: string;
  statusOn: boolean;
  loveOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const showLove = loveOn && card.affinity;
  const showStatus = statusOn && card.lines.length > 0;
  if (!showLove && !showStatus) return null;
  return (
    <div className={SCENE_BOX}>
      {showLove && card.affinity ? <AffinityFace a={card.affinity} lookSay={lookSay} /> : null}
      {showStatus ? (
        <>
          <button type="button" className="flex items-center gap-1 text-[15px] font-bold leading-snug" onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn("size-3.5 shrink-0 transition", open ? "" : "-rotate-90")} />
            「{card.name || "角色"}」当前的状态
          </button>
          {open ? <StatusLines lines={card.lines} /> : null}
        </>
      ) : null}
    </div>
  );
}

function SceneEditor({
  cards,
  lookSay,
  statusOn,
  loveOn,
  onChange,
}: {
  cards: SceneCard[];
  lookSay: string;
  statusOn: boolean;
  loveOn: boolean;
  onChange: (cards: SceneCard[]) => void;
}) {
  const patch = (i: number, next: SceneCard) => onChange(cards.map((c, n) => (n === i ? next : c)));
  const shown = cards
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => (loveOn && card.affinity) || (statusOn && card.lines.length > 0));
  if (!shown.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {shown.map(({ card, i }) => (
        <div key={i} className={SCENE_BOX}>
          {loveOn && card.affinity ? (
            <AffinityEdit
              a={card.affinity}
              lookSay={lookSay}
              onChange={(a) => patch(i, { ...card, affinity: a })}
            />
          ) : null}
          {statusOn && card.lines.length > 0 ? (
            <div className={loveOn && card.affinity ? "mt-2" : ""}>
              <div className="text-[15px] font-bold leading-snug">「{card.name || "角色"}」当前的状态</div>
              {card.lines.map((line, li) => (
                <label key={li} className="mt-1 flex items-start gap-1">
                  <span className="shrink-0 font-bold">{line.title}:</span>
                  <input
                    value={line.value}
                    onChange={(e) => {
                      const lines = card.lines.map((row, n) => (n === li ? { ...row, value: e.target.value } : row));
                      patch(i, { ...card, lines });
                    }}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AffinityEdit({
  a,
  lookSay,
  onChange,
}: {
  a: AffinityBits;
  lookSay: string;
  onChange: (a: AffinityBits) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 text-[15px] leading-snug">
        <span className="font-bold">💞好感度:</span>
        <input
          value={String(a.value)}
          onChange={(e) => onChange({ ...a, value: Number(e.target.value.replace(/[^\d-]/g, "")) || 0 })}
          className="w-12 bg-transparent font-bold outline-none"
          style={{ color: "#d23a3a" }}
        />
        <span>[</span>
        <input
          value={String(a.delta)}
          onChange={(e) => onChange({ ...a, delta: Number(e.target.value.replace(/[^\d-]/g, "")) || 0 })}
          className="w-10 bg-transparent outline-none"
        />
        <span>Ⅰ</span>
        <input
          value={a.stage}
          onChange={(e) => onChange({ ...a, stage: e.target.value })}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
        <span>]</span>
      </div>
      <textarea
        value={a.quote}
        onChange={(e) => onChange({ ...a, quote: e.target.value })}
        rows={2}
        className="mt-1 w-full resize-y bg-transparent outline-none"
        style={{ color: lookSay, fontWeight: 700, fontStyle: "italic" }}
      />
    </div>
  );
}

function Bubble({
  chat,
  msg,
  showImageTray,
  onUseOption,
  onEditUser,
}: {
  chat: Chat;
  msg: ChatMessage;
  showImageTray?: boolean;
  onUseOption?: (text: string) => void;
  onEditUser?: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(msg.content);
  const [draftCards, setDraftCards] = useState<SceneCard[]>([]);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const generating = msg.role !== "user" && !msg.content;
  const names = [msg.characterName, chat.name, ...chat.characters.map((c) => c.name), "角色"];
  const look = readLook(useApp((s) => s.settings.look));
  const person = msg.characterName || chat.characters.find((c) => c.id === msg.characterId)?.name || chat.characters[0]?.name || chat.name || "角色";
  const statusOn = chat.statusBarOn === true;
  const loveOn = chat.affectionOn === true;
  const scene =
    msg.role === "user"
      ? { body: msg.content, cards: [] as SceneCard[] }
      : presentScene(msg.content, { status: statusOn, affection: loveOn }, person);
  const cards = msg.role === "narrator" ? [] : scene.cards;
  const editingUser = useApp((s) => s.ui.editUserMsg?.msgId === msg.id);

  const startAssistEdit = () => {
    const full = readScene(msg.content, person);
    setText(full.body);
    setDraftCards(full.cards);
    setEdit(true);
    requestAnimationFrame(() => editRef.current?.focus());
  };
  const saveAssistEdit = () => {
    const nameLine = chat.isMulti && chat.multiMode === "together";
    void editMessage(chat.id, msg.id, writeScene(text, draftCards, nameLine));
    if (loveOn) {
      const next = { ...(chat.affections ?? {}) };
      for (const card of draftCards) {
        if (!card.affinity) continue;
        const who =
          (msg.characterId && chat.characters.find((c) => c.id === msg.characterId)) ||
          chat.characters.find((c) => c.name && c.name === card.name) ||
          (chat.characters.length === 1 ? chat.characters[0] : undefined);
        if (who) next[who.id] = card.affinity.value;
      }
      useApp.getState().patchChat(chat.id, { affections: next });
    }
    setEdit(false);
  };

  if (msg.role === "user") {
    if (msg.wechatLog) {
      return (
        <div className="mb-4 flex flex-col items-end">
          <button
            type="button"
            className="rounded-[12px] border border-line bg-card px-4 py-3 text-[14px] text-ink"
            onClick={() => useApp.getState().setUI({ wechatView: { chatId: chat.id, msgId: msg.id } })}
          >
            {msg.wechatLog.voided ? "失效的聊天记录" : "已保存的微信内容"}
          </button>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Mini onClick={() => void branchFrom(chat.id, msg.id)} icon={<GitBranch className="size-3" />} label="开分支" />
          </div>
        </div>
      );
    }
    return (
      <div className="mb-4 flex flex-col items-end">
        {messageShots(msg).length ? (
          <div className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {messageShots(msg).map((s, i) => (
              <UserShot key={`${s.blobId}-${i}`} blobId={s.blobId} i2i={s.i2i} />
            ))}
          </div>
        ) : null}
        {msg.content.trim() ? (
          <div
            className={cn(
              "w-fit min-h-[2.75rem] min-w-[5.5rem] max-w-[85%] rounded-[18px] border px-4 py-2.5",
              editingUser ? "border-primary bg-card" : "border-line bg-card",
            )}
          >
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{msg.content}</div>
          </div>
        ) : null}
        <div className="mt-1.5 flex justify-end gap-1.5">
          <Mini onClick={() => onEditUser?.()} icon={<Pencil className="size-3" />} label="编辑" />
          <Mini onClick={() => void branchFrom(chat.id, msg.id)} icon={<GitBranch className="size-3" />} label="开分支" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <button
        className="mb-2 flex items-center gap-2"
        onClick={() => {
          if (isWorkshopChat(chat)) useApp.getState().setUI({ workshopEditId: chat.id });
          else useApp.getState().beginEdit(chat.id);
        }}
      >
        <ChatAvatar chat={chat} name={msg.characterName || chat.name} size={36} />
        <div className="text-[16px] font-semibold">{workshopTitle({ kind: chat.kind, name: msg.characterName || chat.name })}</div>
      </button>
      <div className="pl-[44px]">
        {generating ? (
          <div className="font-sans text-[14px] text-muted">
            回复中
            <span className="inline-flex gap-0.5 pl-1">
              <i className="animate-pulse">·</i>
              <i className="animate-pulse">·</i>
              <i className="animate-pulse">·</i>
            </span>
          </div>
        ) : edit ? (
          <textarea
            ref={editRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="serif-body min-h-[120px] w-full resize-y bg-transparent text-[16px] leading-relaxed text-narrate outline-none"
          />
        ) : (
          <ReplyView text={scene.body} names={names} onUseOption={onUseOption} chat={chat} />
        )}
        {edit && (
          <SceneEditor
            cards={draftCards}
            lookSay={look.say}
            statusOn={statusOn}
            loveOn={loveOn}
            onChange={setDraftCards}
          />
        )}
        {edit ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-full border border-line bg-card px-3 text-[12px] text-muted"
              onClick={() => setEdit(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-[12px] text-on-primary"
              onClick={saveAssistEdit}
            >
              保存
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Mini onClick={() => void regenMessage(chat.id, msg.id)} icon={<RefreshCw className="size-3" />} label="重新生成" />
            <Mini onClick={() => void branchFrom(chat.id, msg.id)} icon={<GitBranch className="size-3" />} label="开分支" />
            {!generating && (
              <Mini onClick={startAssistEdit} icon={<Pencil className="size-3" />} label="编辑" />
            )}
            {chat.kind === "card" && !generating && (
              <Mini
                onClick={() => {
                  void navigator.clipboard.writeText(msg.content);
                  useApp.getState().toast("已复制");
                }}
                icon={<Copy className="size-3" />}
                label="复制"
              />
            )}
          </div>
        )}
        {chat.kind === "card" && !edit && !generating && replyLooksLikeCard(msg.content) && (
          <button
            type="button"
            className="mt-2 inline-flex h-7 items-center rounded-full border border-line bg-card px-3 text-[12px]"
            onClick={() => useApp.getState().setUI({ workshopCardText: msg.content })}
          >
            保存为角色卡
          </button>
        )}
        {cards.length > 0 && !edit && (
          <div className="mt-3 space-y-2">
            {cards.map((card, i) => (
              <SceneFace key={i} card={card} lookSay={look.say} statusOn={statusOn} loveOn={loveOn} />
            ))}
          </div>
        )}
        {(msg.images.length > 0 || (showImageTray && !generating)) && (
          <ImageBlock chat={chat} msg={msg} allowEmpty={Boolean(showImageTray && !generating)} />
        )}
      </div>
    </div>
  );
}

function ReplyView({
  text,
  names,
  onUseOption,
  chat,
}: {
  text: string;
  names: (string | undefined)[];
  onUseOption?: (text: string) => void;
  chat: Chat;
}) {
  const parsed = parseReplyMarkup(text);
  const think = parsed.folds.filter((f) => f.kind === "think");
  const notes = parsed.folds.filter((f) => f.kind === "note");
  return (
    <>
      {think.map((f, i) => (
        <ReplyFoldRow key={`think-${i}-${f.title}`} fold={f} />
      ))}
      {parsed.body ? <RpBody text={parsed.body} names={names} chat={chat} /> : null}
      {notes.map((f, i) => (
        <ReplyFoldRow key={`note-${i}-${f.title}`} fold={f} />
      ))}
      {parsed.options.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {parsed.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onUseOption?.(opt)}
              className="block w-full rounded-[16px] border border-line bg-card px-3 py-2 text-left text-[13px] leading-snug text-ink"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ReplyFoldRow({ fold }: { fold: ReplyFold }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={fold.kind === "think" ? "mb-2" : "mt-2"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-muted"
      >
        <ChevronDown className={cn("size-3.5 shrink-0 transition", open ? "" : "-rotate-90")} />
        {fold.title}
      </button>
      {open && fold.body ? (
        <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-narrate">{fold.body}</div>
      ) : null}
    </div>
  );
}

function ChatScene({ chat }: { chat: Chat }) {
  const look = readLook(useApp((s) => s.settings.look));
  const own = Boolean(chat.bgImageId);
  return <SceneBackdrop blobId={own ? chat.bgImageId : look.bgImageId} fade={own ? (chat.bgFade ?? 40) : look.bgFade} paper={look.paper} />;
}

function RpBody({ text, names, chat }: { text: string; names: (string | undefined)[]; chat: Chat }) {
  const look = readLook(useApp((s) => s.settings.look));
  const plateOn = typeof chat.textPlate === "boolean" ? chat.textPlate : look.textPlate;
  const plate = plateOn && Boolean(chat.bgImageId || look.bgImageId);
  const stripped = stripSpeakerPrefix(text, names);
  const { body, status } = stripStatus(stripped);
  const parts = splitDialogue(body);
  return (
    <>
      <div
        className={cn("serif-body whitespace-pre-wrap", plate && "rounded-[16px] px-3 py-2")}
        style={{
          fontFamily: fontStack(look.font),
          fontSize: look.size,
          fontWeight: look.weight,
          color: look.narrate,
          background: plate ? `color-mix(in srgb, ${look.paper} 86%, transparent)` : undefined,
        }}
      >
        {parts.map((p, i) => (
          <span key={i} style={p.kind === "say" ? { fontStyle: "italic", fontWeight: sayWeight(look.weight), color: look.say } : undefined}>
            {p.text}
          </span>
        ))}
      </div>
      {status ? (
        <div className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-6 text-ink">{status}</div>
      ) : null}
    </>
  );
}

function Mini({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-6 items-center gap-0.5 rounded-full border border-line bg-card px-2 text-[11px] leading-none text-muted"
    >
      {icon}
      {label}
    </button>
  );
}

function ImageBlock({ chat, msg, allowEmpty }: { chat: Chat; msg: ChatMessage; allowEmpty?: boolean }) {
  const chatImage = useApp((s) => s.settings.chatImage !== false);
  const done = msg.images.filter((g) => g.status === "done" && g.blobId);
  const pendingImg = msg.images.find((g) => g.status !== "done" && g.status !== "error");
  const pending = Boolean(pendingImg);
  const followLatest = useRef(true);
  const prevDone = useRef(done.length);
  const [idx, setIdx] = useState(() => Math.max(0, done.length - 1));
  const [url, setUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [kick, setKick] = useState<ImageGenSource | null>(null);
  const [flashErr, setFlashErr] = useState<string | null>(null);
  const seenFail = useRef("");
  const current: GenImage | undefined = done[idx] ?? done[done.length - 1];
  const busy = kick ?? pendingImg?.source ?? null;
  const locked = pending || Boolean(kick) || !chatImage;

  useEffect(() => {
    if (!pending) setKick(null);
  }, [pending]);

  useEffect(() => {
    if (done.length > prevDone.current) {
      setIdx(done.length - 1);
      followLatest.current = true;
    } else if (idx >= done.length && done.length > 0) {
      setIdx(done.length - 1);
    }
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

  const go = (dir: -1 | 1) => {
    const n = done.length;
    if (n < 2) return;
    setIdx((i) => {
      const next = (i + dir + n) % n;
      followLatest.current = next === n - 1;
      return next;
    });
  };

  const latest = msg.images.at(-1);
  const lastError = latest?.status === "error" ? latest : undefined;
  const phaseLabel =
    genPhaseLabel(pendingImg?.status) ||
    (kick === "rewrite" || kick === "auto" ? "写提示词中" : kick ? "上传中" : "");

  useEffect(() => {
    if (pending || !lastError || !current?.blobId) {
      if (!lastError) setFlashErr(null);
      return;
    }
    if (seenFail.current === lastError.id) return;
    seenFail.current = lastError.id;
    setFlashErr(genPhaseLabel("error", lastError.error));
    const t = window.setTimeout(() => setFlashErr(null), 2000);
    return () => window.clearTimeout(t);
  }, [pending, lastError, current?.blobId]);

  if (msg.images.length === 0 && !allowEmpty) return null;
  const showFrame = msg.images.length > 0 || pending;

  return (
    <div className="mt-3">
      {current && (
        <div className="mb-1 flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-[11px] text-muted">
          <button onClick={() => jumpParams("model")}>{modelLabel(current.model)}</button>
          <button onClick={() => jumpParams("size")}>
            {current.width}×{current.height}
          </button>
          <button onClick={() => jumpParams("steps")}>{current.steps}步</button>
          <button onClick={() => jumpParams("sampler")}>{samplerLabel(current.sampler)}</button>
          <button
            onClick={() => {
              useApp.getState().patchParams(chat.id, { seed: current.seed });
              jumpParams("seed");
            }}
          >
            {String(current.seed).slice(0, 8)}
          </button>
          {chat.isMulti && (
            <button className="text-danger" onClick={() => jumpParams("chars")}>
              多
            </button>
          )}
        </div>
      )}
      {showFrame ? (
      <div className="relative overflow-hidden rounded-[18px] bg-dim">
        {current && url ? (
          <div className="relative">
            <img src={url} alt="" className="w-full" />
            {done.length > 1 && (
              <>
                <button className="absolute inset-y-0 left-0 w-1/2" onClick={() => go(-1)} aria-label="上一张" />
                <button className="absolute inset-y-0 right-0 w-1/2" onClick={() => go(1)} aria-label="下一张" />
              </>
            )}
          </div>
        ) : (
          <div
            className="grid place-items-center px-4 text-[13px] text-muted"
            style={{ aspectRatio: `${chat.imageParams.width} / ${chat.imageParams.height}` }}
          >
            {pending ? (
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> {phaseLabel || "准备中"}
                </span>
                <button type="button" className="text-primary" onClick={() => cancelImage(chat.id, msg.id)}>
                  取消
                </button>
              </span>
            ) : lastError ? (
              <span className="text-center text-danger">{genPhaseLabel("error", lastError.error)}</span>
            ) : (
              <span className="text-center text-muted">还没有配图</span>
            )}
          </div>
        )}
      </div>
      ) : null}
      {flashErr ? (
        <div className="mt-1 truncate text-center text-[11px] leading-4 text-danger">{flashErr}</div>
      ) : null}
      <div className="mt-2 grid grid-cols-4 text-[12px] text-muted">
        <IcoBtn
          icon={<RefreshCw className="size-4" />}
          label={busy === "same" && phaseLabel ? phaseLabel : "重新生成"}
          busy={busy === "same"}
          disabled={locked || !current}
          onClick={() => {
            if (busy === "same") {
              cancelImage(chat.id, msg.id);
              return;
            }
            if (locked || !current) return;
            setKick("same");
            void attachImage(chat.id, msg.id, "same");
          }}
        />
        <IcoBtn
          icon={<Sparkles className="size-4" />}
          label={(busy === "rewrite" || busy === "auto") && phaseLabel ? phaseLabel : "换提示词生成"}
          busy={busy === "rewrite" || busy === "auto"}
          disabled={locked}
          onClick={() => {
            if (busy === "rewrite" || busy === "auto") {
              cancelImage(chat.id, msg.id);
              return;
            }
            if (locked) return;
            setKick("rewrite");
            void attachImage(chat.id, msg.id, "rewrite");
          }}
        />
        <IcoBtn
          icon={saved ? <Check className="size-4 text-good" /> : <Download className="size-4" />}
          label="下载"
          disabled={!current?.blobId}
          onClick={async () => {
            if (!current?.blobId) return;
            const u = await imageUrl(current.blobId);
            if (!u) return;
            const blob = await fetch(u).then((r) => r.blob());
            downloadBlob(blob, String(current.seed));
            setSaved(true);
            setTimeout(() => setSaved(false), 1000);
          }}
        />
        <IcoBtn
          icon={<Wand2 className="size-4" />}
          label={busy === "custom" && phaseLabel ? phaseLabel : "自定义修改"}
          busy={busy === "custom"}
          disabled={!chatImage}
          onClick={() => {
            const src = pendingImg && (pendingImg.prompt || pendingImg.charTails) ? pendingImg : current ?? pendingImg;
            if (!src) return;
            useApp.getState().setUI({
              customPrompt: {
                chatId: chat.id,
                msgId: msg.id,
                imgId: src.id,
                text: extractGrokTail(src.prompt, chat.imageParams) || src.prompt || "",
                charTails: { ...(src.charTails || {}) },
              },
            });
          }}
        />
      </div>
    </div>
  );
}

function IcoBtn({
  icon,
  label,
  onClick,
  busy,
  disabled,
}: {
  icon: React.ReactNode;
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
      aria-busy={busy || undefined}
      aria-label={label}
      className={
        busy
          ? "flex w-full min-w-0 flex-col items-center gap-1 px-1 py-1 text-center text-primary"
          : "flex w-full min-w-0 flex-col items-center gap-1 px-1 py-1 text-center disabled:opacity-40"
      }
    >
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function applyChatImageToPure(chat: Chat, text: string, charTails: Record<string, string>, live: GenImage | undefined, insert: boolean) {
  const next = structuredClone(chat.imageParams);
  next.promptMid = joinPromptParts(next.promptMid, text);
  if (live) {
    next.model = live.model;
    next.width = live.width;
    next.height = live.height;
    next.steps = live.steps;
    next.sampler = live.sampler;
    next.negative = live.negative;
    if (live.status === "done") next.seed = live.seed;
  }
  const state = useApp.getState();
  next.characters = next.characters.map((c) => ({
    ...c,
    name: "",
    prompt: insert ? joinPromptParts(c.prompt, charTails[c.id] ?? "") : c.prompt,
  }));
  state.setPureParams({
    ...next,
    img2imgBlobId: next.img2imgBlobId || "",
    img2imgStrength: next.img2imgStrength ?? 0.7,
    img2imgNoise: next.img2imgNoise ?? 0,
  });
  state.toast("应用成功");
}

export function CustomPromptModal() {
  const data = useApp((s) => s.ui.customPrompt);
  const setUI = useApp((s) => s.setUI);
  const chat = useApp((s) => (data ? s.chats.find((c) => c.id === data.chatId) : undefined));
  const wechatLine = useApp((s) =>
    data?.wechatLineId ? s.wechatSessions[data.chatId]?.lines.find((l) => l.id === data.wechatLineId) : undefined,
  );
  const msg = chat?.messages.find((m) => m.id === data?.msgId);
  const pool = wechatLine ? lineImages(wechatLine) : msg?.images;
  const live = pool?.find((g) => g.id === data?.imgId);
  const generating = pool?.some((g) => g.status !== "done" && g.status !== "error") ?? false;
  const [text, setText] = useState(data?.text ?? "");
  const [charTails, setCharTails] = useState<Record<string, string>>(data?.charTails ?? {});
  const edited = useRef(false);
  useEffect(() => {
    edited.current = false;
    setText(data?.text ?? "");
    setCharTails(data?.charTails ?? {});
  }, [data?.text, data?.imgId]);
  const liveKey = live ? `${live.id}\n${live.prompt}\n${JSON.stringify(live.charTails || {})}` : "";
  useEffect(() => {
    if (!chat || !live || edited.current) return;
    if (!live.prompt && !live.charTails) return;
    setText(extractGrokTail(live.prompt, chat.imageParams) || live.prompt || "");
    setCharTails({ ...(live.charTails || {}) });
  }, [liveKey]);
  if (!data || !chat) return null;
  const insert = chat.isMulti && chat.promptMode === "insert";
  const chars = chat.imageParams.characters;
  return (
    <Modal open onClose={() => setUI({ customPrompt: null })} title="自定义修改提示词">
      <button
        type="button"
        className="-mt-1 mb-3 inline-flex h-7 items-center rounded-full border border-line bg-card px-3 text-[13px] font-medium leading-none text-primary"
        onClick={() => applyChatImageToPure(chat, text, charTails, live, insert)}
      >
        应用到纯生图
      </button>
      {insert ? (
        <>
          <p className="mb-3 text-[12px] leading-5 text-muted">
            总提示追加到「正面提示词 · 中」后面，各角色追加到对应角色正面提示词后面。不会写入 ENABLED。
          </p>
          <div className="mb-1 text-[13px] font-medium">总提示（正面提示词 · 中）</div>
          <TextArea className="min-h-[96px]" value={text} onChange={(e) => { edited.current = true; setText(e.target.value); }} />
          {chars.map((ch, i) => {
            const role = chat.characters.find((c) => c.id === ch.id);
            const name = (role?.name || ch.name || "").trim();
            return (
            <div key={ch.id} className="mt-3">
              <div className="mb-1 text-[13px] font-medium">
                角色{i + 1}
                {name ? `:${name}` : ""} 正面提示词
              </div>
              <TextArea
                className="min-h-[88px]"
                value={charTails[ch.id] ?? ""}
                onChange={(e) => {
                  edited.current = true;
                  setCharTails((prev) => ({ ...prev, [ch.id]: e.target.value }));
                }}
              />
            </div>
            );
          })}
        </>
      ) : (
        <TextArea className="min-h-[160px]" value={text} onChange={(e) => { edited.current = true; setText(e.target.value); }} />
      )}
      <div className="mt-4 flex gap-2">
        <button
          className="h-12 flex-1 rounded-full border border-line bg-card text-[15px] font-medium"
          onClick={() => setUI({ customPrompt: null })}
        >
          取消
        </button>
        <button
          type="button"
          disabled={generating}
          className="h-12 flex-[1.2] rounded-full bg-primary text-[15px] font-medium text-on-primary disabled:opacity-40"
          onClick={() => {
            if (generating) return;
            if (data.wechatLineId) void paintWechat(chat, data.wechatLineId, "custom", text, insert ? charTails : undefined);
            else void attachImage(data.chatId, data.msgId, "custom", text, insert ? charTails : undefined);
            setUI({ customPrompt: null });
          }}
        >
          按这个生成
        </button>
      </div>
      {generating ? (
        <button
          type="button"
          className="mt-3 w-full text-center text-[13px] text-danger"
          onClick={() => {
            if (data.wechatLineId) cancelWechatImage(data.chatId, data.wechatLineId);
            else cancelImage(data.chatId, data.msgId);
            setUI({ customPrompt: null });
          }}
        >
          取消这次生图
        </button>
      ) : null}
    </Modal>
  );
}

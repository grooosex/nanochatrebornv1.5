import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Pencil, RotateCcw, X } from "lucide-react";
import { useApp } from "@/lib/store";
import {
  SYS,
  bindSysBaselines,
  customText,
  keepSysVersions,
  pairNote,
  pairOn,
  saveSysText,
  stampSysHashes,
  syncSysTexts,
  resetSys,
  sysDrifted,
  sysTextEdited,
  togglePair,
  toggleSysOff,
  turnedOff,
} from "@/lib/sys-prompt";
import {
  CHAT_IMAGE_ORDER,
  CHAT_OPENING_LINE,
  IMAGE_BG_RULES,
  IMAGE_MULTI_RULES,
  IMAGE_SHOT_RULES,
  IMAGE_SYSTEM,
  LOVE_RULE_TEXT,
  POLISH_SYSTEM,
  FIELD_SYSTEM,
  PERSONA_VOICE_RULES,
  MEMORY_SYSTEM,
  MEMORY_CLOSER,
  TASK_CLOSER,
  RP_STRUCTURE,
  RP_SYSTEM,
  STATUS_RULE_TEXT,
  WX_IMAGE_HERE,
  WX_IMAGE_ORDER,
  groupHintRaw,
  groupHintStable,
  imageLengthRules,
  imageLengthStable,
} from "@/lib/prompts";
import { activePreset, activeWechatPreset, presetTexts, sealPreset } from "@/lib/st-preset";
import { wxBaseline, wxCloser } from "@/lib/wechat";
import type { StPromptItem } from "@/lib/types";
import { Modal, PrimaryBtn, GhostBtn, Switch, TextArea } from "./ui-kit";

const CHAT_IMAGE_IDS = [
  SYS.chatImgWriter,
  SYS.chatImgShot,
  SYS.chatImgBg,
  SYS.chatImgMulti,
  SYS.chatImgLen,
  SYS.chatImgOrder,
];

const WX_IMAGE_IDS = [
  SYS.wxImgWriter,
  SYS.wxImgShot,
  SYS.wxImgBg,
  SYS.wxImgMulti,
  SYS.wxImgHere,
  SYS.wxImgLen,
  SYS.wxImgOrder,
];

const DRIFT_LABEL: Record<string, string> = {
  [SYS.chatWrite]: "聊天写法",
  [SYS.chatStruct]: "结构规则",
  [SYS.chatGroup]: "群聊怎么分段",
  [SYS.chatOpen]: "开场第一句",
  [SYS.chatStatus]: "状态栏怎么写",
  [SYS.chatLove]: "好感度怎么写",
  [SYS.chatImgWriter]: "生图写手（含词库和正反例）",
  [SYS.chatImgShot]: "这一镜认哪段",
  [SYS.chatImgBg]: "背景",
  [SYS.chatImgMulti]: "多人互动",
  [SYS.chatImgLen]: "篇幅",
  [SYS.chatImgOrder]: "正文和生图标记的先后",
  [SYS.wxReply]: "一个人怎么回",
  [SYS.wxGroup]: "群里怎么回",
  [SYS.wxPrivate]: "私聊里带上的群记录",
  [SYS.wxFold]: "更早的微信怎么压短",
  [SYS.wxSum]: "总结规则",
  [SYS.wxImgWriter]: "生图写手",
  [SYS.wxImgShot]: "这一镜认哪段",
  [SYS.wxImgBg]: "背景",
  [SYS.wxImgMulti]: "多人互动",
  [SYS.wxImgHere]: "以刚写的内心为准",
  [SYS.wxImgLen]: "篇幅",
  [SYS.wxImgOrder]: "微信和生图标记的先后",
  [SYS.polishAll]: "整卡润色",
  [SYS.polishField]: "单栏怎么改",
  [SYS.polishVoice]: "五声部",
  [SYS.memoryBody]: "怎么总结",
};

const UNDER = "underline decoration-[#c43c3c] decoration-2 underline-offset-[3px]";
const UPDATE = "shrink-0 text-[11px] font-medium leading-none text-[#c43c3c]";

function sysBaselines() {
  return {
    [SYS.chatWrite]: RP_SYSTEM,
    [SYS.chatStruct]: RP_STRUCTURE,
    [SYS.chatGroup]: groupHintStable(),
    [SYS.chatOpen]: CHAT_OPENING_LINE,
    [SYS.chatStatus]: STATUS_RULE_TEXT,
    [SYS.chatLove]: LOVE_RULE_TEXT,
    [SYS.chatImgWriter]: IMAGE_SYSTEM,
    [SYS.chatImgShot]: IMAGE_SHOT_RULES,
    [SYS.chatImgBg]: IMAGE_BG_RULES,
    [SYS.chatImgMulti]: IMAGE_MULTI_RULES,
    [SYS.chatImgLen]: imageLengthStable(),
    [SYS.chatImgOrder]: CHAT_IMAGE_ORDER,
    [SYS.wxReply]: wxBaseline("reply"),
    [SYS.wxGroup]: wxBaseline("group"),
    [SYS.wxPrivate]: wxBaseline("private"),
    [SYS.wxFold]: wxBaseline("fold"),
    [SYS.wxSum]: wxBaseline("sum"),
    [SYS.wxImgWriter]: IMAGE_SYSTEM,
    [SYS.wxImgShot]: IMAGE_SHOT_RULES,
    [SYS.wxImgBg]: IMAGE_BG_RULES,
    [SYS.wxImgMulti]: IMAGE_MULTI_RULES,
    [SYS.wxImgHere]: WX_IMAGE_HERE,
    [SYS.wxImgLen]: imageLengthStable(),
    [SYS.wxImgOrder]: WX_IMAGE_ORDER,
    [SYS.polishAll]: POLISH_SYSTEM,
    [SYS.polishField]: FIELD_SYSTEM,
    [SYS.polishVoice]: PERSONA_VOICE_RULES,
    [SYS.memoryBody]: MEMORY_SYSTEM,
  };
}

function driftRows() {
  return Object.entries(DRIFT_LABEL)
    .filter(([id]) => sysDrifted(id) && useApp.getState().settings.sysPrompt?.[id]?.kept !== true)
    .map(([id, label]) => ({ id, label }));
}

function TitleText({ id, title, className }: { id?: string; title: string; className?: string }) {
  const edited = id ? sysTextEdited(id) : false;
  const drifted = id ? sysDrifted(id) : false;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className={`truncate ${className ?? ""} ${edited ? UNDER : ""}`}>{title}</span>
      {drifted ? <span className={UPDATE}>有更新</span> : null}
    </span>
  );
}

type Edit = { id: string; title: string; text: string; baseline: string; readOnly?: boolean };

export function SysPromptSheet({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const chat = useApp((s) => s.chats.find((c) => c.id === s.currentId));
  const [edit, setEdit] = useState<Edit | null>(null);
  const [drift, setDrift] = useState<{ id: string; label: string }[]>([]);
  const preset = activePreset(settings);
  const hasStyle = Boolean(preset && presetTexts(preset, settings.stPresetMode === "old" ? "old" : "new").systemPrompt.trim());
  bindSysBaselines(sysBaselines);
  useEffect(() => {
    bindSysBaselines(sysBaselines);
    stampSysHashes();
    setDrift(driftRows());
  }, []);

  const openEdit = (id: string, title: string, baseline: string, readOnly = false) => {
    setEdit({ id, title, baseline, readOnly, text: readOnly ? baseline : (customText(id) ?? baseline) });
  };

  const save = () => {
    if (!edit || edit.readOnly) return;
    saveSysText(edit.id, edit.text, edit.baseline);
    setEdit(null);
    useApp.getState().toast("已保存");
  };

  const restore = () => {
    if (!edit || edit.readOnly) return;
    resetSys([edit.id]);
    setEdit({ ...edit, text: edit.baseline });
    useApp.getState().toast("已还原");
  };

  const openLive = (id: string, title: string, raw: string, empty: string) => {
    openEdit(id, title, raw || empty, !raw);
  };

  return (
    <div className="relative z-10 flex min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-bg shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
        <h2 className="text-[20px] font-semibold">系统预设设置</h2>
        <button type="button" className="ml-auto" onClick={onClose} aria-label="关闭">
          <X className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 scroll-hide">
      <p className="mb-3 text-[12px] leading-relaxed text-muted">没改过的块和原来逐字一样。改过的只发你写的。标题不会发给模型。</p>
      <Section
        title="主聊天"
        ids={[SYS.chatWrite, SYS.chatStruct, SYS.chatGroup, SYS.chatOpen, SYS.chatStatus, SYS.chatLove, SYS.chatImgWriter, SYS.chatImgShot, SYS.chatImgBg, SYS.chatImgMulti, SYS.chatImgLen, SYS.chatImgOrder]}
      >
        <PairRow id={SYS.chatWrite} title="聊天写法" hasStyle={hasStyle} onEdit={() => openEdit(SYS.chatWrite, "聊天写法", RP_SYSTEM)} />
        <PairRow id={SYS.chatStruct} title="结构规则" hasStyle={hasStyle} onEdit={() => openEdit(SYS.chatStruct, "结构规则", RP_STRUCTURE)} />
        <p className="mb-2 text-[12px] text-muted">{pairNote(hasStyle)}</p>
        <GrayRow title="这一轮的人设、开场、长期记忆" text="具体文字随当前聊天填入，这里不能改。要求总览、人设、说话方式、外貌、开场、长期记忆还是照旧发。" onOpen={openEdit} />
        <EditRow
          id={SYS.chatGroup}
          title="群聊怎么分段"
          onEdit={() =>
            openLive(
              SYS.chatGroup,
              "群聊怎么分段",
              chat ? groupHintRaw(chat) : "",
              "只有群聊才会发这段。先打开一个群聊再改。",
            )
          }
        />
        <EditRow id={SYS.chatOpen} title="开场第一句" onEdit={() => openEdit(SYS.chatOpen, "开场第一句", CHAT_OPENING_LINE)} />
        <PresetFold title="预设插入位置 1" place="before" which="chat" />
        <Fold title="生图" accent resetIds={CHAT_IMAGE_IDS}>
          <EditRow id={SYS.chatImgWriter} title="生图写手（含词库和正反例）" accent onEdit={() => openEdit(SYS.chatImgWriter, "生图写手", IMAGE_SYSTEM)} />
          <EditRow id={SYS.chatImgShot} title="这一镜认哪段" accent onEdit={() => openEdit(SYS.chatImgShot, "这一镜认哪段", IMAGE_SHOT_RULES)} />
          <EditRow id={SYS.chatImgBg} title="背景" accent onEdit={() => openEdit(SYS.chatImgBg, "背景", IMAGE_BG_RULES)} />
          <EditRow id={SYS.chatImgMulti} title="多人互动" accent onEdit={() => openEdit(SYS.chatImgMulti, "多人互动", IMAGE_MULTI_RULES)} />
          <GrayRow title="上一镜地点" accent text="随上一张图填。对白看不出人在哪时才用。不能在这里改。" onOpen={openEdit} />
          <GrayRow title="成人加强" accent text="跟这个聊天的成人开关走。开和关两句都是原来的，不能在这里改。" onOpen={openEdit} />
          <EditRow
            id={SYS.chatImgLen}
            title="篇幅"
            accent
            onEdit={() =>
              openLive(
                SYS.chatImgLen,
                "篇幅",
                chat ? imageLengthRules(chat.imageParams.model, chat.adultBoost) : "",
                "按当前聊天的模型和成人开关生成。先打开一个聊天再改。",
              )
            }
          />
          <GrayRow title="人设里勾了生图的补丁" accent text="随人设里勾了「生图用」的句子填，不能在这里改。" onOpen={openEdit} />
          <EditRow id={SYS.chatImgOrder} title="正文和生图标记的先后" accent onEdit={() => openEdit(SYS.chatImgOrder, "正文和生图标记的先后", CHAT_IMAGE_ORDER)} />
          <GrayRow title="输出格式" accent text="按单人、多人、插入模式生成。不能在这里改。" onOpen={openEdit} />
        </Fold>
        <p className="mb-1 mt-3 text-[12px] text-muted">下面在聊天记录之后。</p>
        <PresetFold title="预设插入位置 2" place="after" which="chat" />
        <EditRow id={SYS.chatStatus} title="状态栏怎么写" onEdit={() => openEdit(SYS.chatStatus, "状态栏怎么写", STATUS_RULE_TEXT)} />
        <GrayRow title="状态栏模板" text="模板随人设里的状态栏填，接在规则后面。不能在这里改。" onOpen={openEdit} />
        <EditRow id={SYS.chatLove} title="好感度怎么写" onEdit={() => openEdit(SYS.chatLove, "好感度怎么写", LOVE_RULE_TEXT)} />
        <GrayRow title="当前分数" text="没改规则时，分数夹在原来的两段中间。改过之后，分数接在你写的后面，不会被抹掉。" onOpen={openEdit} />
      </Section>
      <Section
        title="微信"
        ids={[SYS.wxReply, SYS.wxGroup, SYS.wxPrivate, SYS.wxFold, SYS.wxSum, SYS.wxImgWriter, SYS.wxImgShot, SYS.wxImgBg, SYS.wxImgMulti, SYS.wxImgHere, SYS.wxImgLen, SYS.wxImgOrder]}
      >
        <EditRow id={SYS.wxReply} title="一个人怎么回" onEdit={() => openEdit(SYS.wxReply, "一个人怎么回", wxBaseline("reply"))} />
        <GrayRow title="只能返回 JSON" text={wxCloser("reply") || "结尾那句不能改，改了微信会拆不开。"} onOpen={openEdit} />
        <EditRow id={SYS.wxGroup} title="群里怎么回" onEdit={() => openEdit(SYS.wxGroup, "群里怎么回", wxBaseline("group"))} />
        <GrayRow title="群的 JSON" text={wxCloser("group") || "结尾那句不能改。"} onOpen={openEdit} />
        <EditRow id={SYS.wxPrivate} title="私聊里带上的群记录" onEdit={() => openEdit(SYS.wxPrivate, "私聊里带上的群记录", wxBaseline("private"))} />
        <EditRow id={SYS.wxFold} title="更早的微信怎么压短" onEdit={() => openEdit(SYS.wxFold, "更早的微信怎么压短", wxBaseline("fold"))} />
        <p className="mb-2 text-[12px] leading-relaxed text-muted">这是单独一趟，不是这条回复里的。</p>
        <Fold title="生图" accent resetIds={WX_IMAGE_IDS}>
          <EditRow id={SYS.wxImgWriter} title="生图写手" accent onEdit={() => openEdit(SYS.wxImgWriter, "生图写手", IMAGE_SYSTEM)} />
          <EditRow id={SYS.wxImgShot} title="这一镜认哪段" accent onEdit={() => openEdit(SYS.wxImgShot, "这一镜认哪段", IMAGE_SHOT_RULES)} />
          <EditRow id={SYS.wxImgBg} title="背景" accent onEdit={() => openEdit(SYS.wxImgBg, "背景", IMAGE_BG_RULES)} />
          <EditRow id={SYS.wxImgMulti} title="多人互动" accent onEdit={() => openEdit(SYS.wxImgMulti, "多人互动", IMAGE_MULTI_RULES)} />
          <EditRow id={SYS.wxImgHere} title="以刚写的内心为准" accent onEdit={() => openEdit(SYS.wxImgHere, "以刚写的内心为准", WX_IMAGE_HERE)} />
          <GrayRow title="上一镜地点" accent text="随上一张图填。看不出人在哪时才用。不能在这里改。" onOpen={openEdit} />
          <GrayRow title="成人加强" accent text="跟这个聊天的成人开关走。开和关两句都是原来的，不能在这里改。" onOpen={openEdit} />
          <EditRow
            id={SYS.wxImgLen}
            title="篇幅"
            accent
            onEdit={() =>
              openLive(
                SYS.wxImgLen,
                "篇幅",
                chat ? imageLengthRules(chat.imageParams.model, chat.adultBoost) : "",
                "按当前聊天的模型和成人开关生成。先打开一个聊天再改。",
              )
            }
          />
          <GrayRow title="人设里勾了生图的补丁" accent text="随人设里勾了「生图用」的句子填，不能在这里改。" onOpen={openEdit} />
          <EditRow id={SYS.wxImgOrder} title="微信和生图标记的先后" accent onEdit={() => openEdit(SYS.wxImgOrder, "微信和生图标记的先后", WX_IMAGE_ORDER)} />
          <GrayRow title="输出格式" accent text="按单人、群、插入模式生成。不能在这里改。" onOpen={openEdit} />
        </Fold>
        <PresetFold title="预设插入位置 1" place="before" which="wechat" />
        <p className="mb-1 mt-3 text-[12px] text-muted">下面在聊天记录之后。</p>
        <PresetFold title="预设插入位置 2" place="after" which="wechat" />
        <Fold title="写回主聊天的总结">
          <EditRow id={SYS.wxSum} title="总结规则" onEdit={() => openEdit(SYS.wxSum, "总结规则", wxBaseline("sum"))} />
          <p className="text-[12px] leading-relaxed text-muted">这是单独一趟，不是微信回复里的。</p>
        </Fold>
      </Section>
      <Section title="人设润色" ids={[SYS.polishAll, SYS.polishField, SYS.polishVoice]}>
        <EditRow id={SYS.polishAll} title="整卡润色" onEdit={() => openEdit(SYS.polishAll, "整卡润色", POLISH_SYSTEM)} />
        <EditRow id={SYS.polishField} title="单栏怎么改" onEdit={() => openEdit(SYS.polishField, "单栏怎么改", FIELD_SYSTEM)} />
        <EditRow id={SYS.polishVoice} title="五声部" onEdit={() => openEdit(SYS.polishVoice, "五声部", PERSONA_VOICE_RULES)} />
        <PresetFold title="预设插入位置" place="all" which="chat" />
        <GrayRow title="收尾" text={TASK_CLOSER} onOpen={openEdit} />
      </Section>
      <Section title="长期记忆" ids={[SYS.memoryBody]}>
        <EditRow id={SYS.memoryBody} title="怎么总结" onEdit={() => openEdit(SYS.memoryBody, "怎么总结", MEMORY_SYSTEM)} />
        <PresetFold title="预设插入位置" place="all" which="chat" />
        <GrayRow title="收尾" text={MEMORY_CLOSER} onOpen={openEdit} />
        <p className="text-[12px] leading-relaxed text-muted">要压进去的对白是聊天记录，不在这里改。用的是主聊天那份预设。</p>
      </Section>
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.title || "内容"}
        wide
        titleAside={
          edit && !edit.readOnly ? (
            <button type="button" className="grid size-9 place-items-center text-muted" aria-label="还原" onClick={restore}>
              <RotateCcw className="size-4" />
            </button>
          ) : null
        }
      >
        <TextArea
          className="min-h-[200px]"
          value={edit?.text ?? ""}
          readOnly={edit?.readOnly}
          onChange={(e) => setEdit((cur) => (cur ? { ...cur, text: e.target.value } : cur))}
        />
        {edit?.readOnly ? <p className="mt-2 text-[12px] text-muted">只能看，不会改发出去的字。</p> : <PrimaryBtn className="mt-4" onClick={save}>保存</PrimaryBtn>}
      </Modal>
      <Modal open={drift.length > 0} onClose={() => setDrift([])} title="系统提示词有更新">
        <p className="text-[13px] leading-relaxed text-muted">这些你改过，但原文已经变了。先不处理的话，还是用你写的字。</p>
        <ul className="my-3 flex flex-col gap-1 text-[13px]">
          {drift.map((row) => (
            <li key={row.id}>{row.label}</li>
          ))}
        </ul>
        <PrimaryBtn
          onClick={() => {
            syncSysTexts(drift.map((row) => row.id));
            setDrift([]);
            useApp.getState().toast("已同步到最新");
          }}
        >
          同步到最新
        </PrimaryBtn>
        <GhostBtn
          className="mt-2"
          onClick={() => {
            keepSysVersions(drift.map((row) => row.id));
            setDrift([]);
          }}
        >
          保留我的版本
        </GhostBtn>
      </Modal>
      </div>
    </div>
  );
}

function Section({ title, ids, children }: { title: string; ids: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const edited = ids.some((id) => sysTextEdited(id));
  const drifted = ids.some((id) => sysDrifted(id));
  return (
    <div className="mb-3 border-b border-line pb-2">
      <div className="flex items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "" : "-rotate-90"}`} />
          <span className={`min-w-0 truncate text-[16px] font-semibold ${edited ? UNDER : ""}`}>{title}</span>
          {drifted ? <span className={UPDATE}>有更新</span> : null}
        </button>
        <button
          type="button"
          className="grid size-8 place-items-center text-muted"
          aria-label={`还原${title}`}
          onClick={() => {
            resetSys(ids);
            useApp.getState().toast("已还原");
          }}
        >
          <RotateCcw className="size-4" />
        </button>
      </div>
      {open ? <div className="pb-2">{children}</div> : null}
    </div>
  );
}

function Fold({
  title,
  children,
  accent,
  resetIds,
}: {
  title: string;
  children: ReactNode;
  accent?: boolean;
  resetIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const edited = resetIds?.some((id) => sysTextEdited(id)) ?? false;
  const drifted = resetIds?.some((id) => sysDrifted(id)) ?? false;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={`size-4 shrink-0 transition ${accent ? "text-primary" : "text-muted"} ${open ? "" : "-rotate-90"}`} />
          <span className={`min-w-0 truncate text-[14px] font-medium ${accent ? "text-primary" : ""} ${edited ? UNDER : ""}`}>{title}</span>
          {drifted ? <span className={UPDATE}>有更新</span> : null}
        </button>
        {resetIds ? (
          <button
            type="button"
            className="grid size-8 place-items-center text-muted"
            aria-label={`还原${title}`}
            onClick={() => {
              resetSys(resetIds);
              useApp.getState().toast("已还原");
            }}
          >
            <RotateCcw className="size-4" />
          </button>
        ) : null}
      </div>
      {open ? <div className="pl-2">{children}</div> : null}
    </div>
  );
}

function PairRow({ id, title, hasStyle, onEdit }: { id: string; title: string; hasStyle: boolean; onEdit: () => void }) {
  const on = pairOn(hasStyle, id);
  return (
    <div className="flex items-center gap-2 border-b border-line/70 py-2.5">
      <TitleText id={id} title={title} className={`text-[13px] ${on ? "font-semibold" : ""}`} />
      <button type="button" className="grid size-8 place-items-center text-muted" aria-label={`编辑${title}`} onClick={onEdit}>
        <Pencil className="size-3.5" />
      </button>
      <Switch on={on} label={title} onChange={() => togglePair(hasStyle, id)} />
    </div>
  );
}

function EditRow({ id, title, accent, onEdit }: { id: string; title: string; accent?: boolean; onEdit: () => void }) {
  const on = !turnedOff(id);
  return (
    <div className="flex items-center gap-2 border-b border-line/70 py-2.5">
      <TitleText id={id} title={title} className={`text-[13px] ${accent ? "text-primary" : ""} ${on ? "font-semibold" : ""}`} />
      <button type="button" className="grid size-8 place-items-center text-muted" aria-label={`编辑${title}`} onClick={onEdit}>
        <Pencil className="size-3.5" />
      </button>
      <Switch on={on} label={title} onChange={() => toggleSysOff(id)} />
    </div>
  );
}

function GrayRow({ title, text, accent, onOpen }: { title: string; text: string; accent?: boolean; onOpen: (id: string, title: string, baseline: string, readOnly?: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-line/70 py-2.5">
      <span className={`min-w-0 flex-1 truncate text-[13px] ${accent ? "text-primary" : "text-faint"}`}>{title}</span>
      <button type="button" className="grid size-8 place-items-center text-faint" aria-label={`查看${title}`} onClick={() => onOpen(title, title, text, true)}>
        <Pencil className="size-3.5" />
      </button>
      <Switch on disabled label={title} onChange={() => undefined} />
    </div>
  );
}

function PresetFold({ title, place, which }: { title: string; place: "before" | "after" | "all"; which: "chat" | "wechat" }) {
  const settings = useApp((s) => s.settings);
  const preset = which === "wechat" ? activeWechatPreset(settings) : activePreset(settings);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: string; name: string; text: string; readOnly: boolean } | null>(null);
  const old = settings.stPresetMode === "old";
  const texts = preset ? presetTexts(preset, old ? "old" : "new") : { systemPrompt: "", postHistory: "" };
  const items = (preset?.items ?? []).filter((item) => (place === "all" ? true : place === "after" ? item.place === "after" : item.place !== "after"));
  const legacy = place === "after" ? texts.postHistory : place === "before" ? texts.systemPrompt : [texts.systemPrompt, texts.postHistory].filter(Boolean).join("\n\n");

  const setItem = (item: StPromptItem, enabled: boolean) => {
    if (!preset || !item.usable || old) return;
    const id = preset.id;
    useApp.getState().setSettings({
      stPresets: (useApp.getState().settings.stPresets ?? []).map((row) =>
        row.id === id && row.items ? sealPreset({ ...row, items: row.items.map((it) => (it.id === item.id ? { ...it, enabled } : it)) }) : row,
      ),
    });
  };

  const save = () => {
    if (!edit || edit.readOnly || !preset) return;
    const id = preset.id;
    const itemId = edit.id;
    const text = edit.text;
    useApp.getState().setSettings({
      stPresets: (useApp.getState().settings.stPresets ?? []).map((row) =>
        row.id === id && row.items ? sealPreset({ ...row, items: row.items.map((it) => (it.id === itemId ? { ...it, content: text } : it)) }) : row,
      ),
    });
    setEdit(null);
    useApp.getState().toast("已保存");
  };

  return (
    <div className="mb-1">
      <button type="button" className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "" : "-rotate-90"}`} />
        <span className="text-[14px] font-medium">{title}</span>
      </button>
      {open ? (
        <div className="pl-2">
          {!preset ? <p className="py-2 text-[12px] text-muted">还没选上。主聊天要开「对话」，微信要开「微信」。</p> : null}
          {preset && (old || !preset.items?.length) ? (
            <>
              <p className="py-1 text-[12px] text-muted">{old ? "旧版是导入时封存的整段，这里不能改条目。" : "这是以前导入的整段。"}</p>
              <TextArea className="min-h-[80px]" value={legacy} readOnly />
            </>
          ) : null}
          {preset && !old && preset.items?.length
            ? items.map((item) => {
                const live = item.usable;
                return (
                  <div key={item.id} className="flex items-center gap-2 border-b border-line/70 py-2">
                    <span className={`min-w-0 flex-1 truncate text-[13px] ${live ? "" : "text-faint"}`}>{item.name}</span>
                    <button
                      type="button"
                      className="grid size-8 place-items-center text-muted"
                      onClick={() => setEdit({ id: item.id, name: item.name, text: item.content, readOnly: !live })}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <Switch on={Boolean(live && item.enabled)} disabled={!live} label={item.name} onChange={(v) => setItem(item, v)} />
                  </div>
                );
              })
            : null}
          <p className="py-1 text-[12px] text-muted">和预设设置是同一份。切新版旧版会马上变。上面的循环图标不会动预设。</p>
        </div>
      ) : null}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.name || "预设"} wide>
        <TextArea className="min-h-[160px]" value={edit?.text ?? ""} readOnly={edit?.readOnly} onChange={(e) => setEdit((cur) => (cur ? { ...cur, text: e.target.value } : cur))} />
        {edit?.readOnly ? <p className="mt-2 text-[12px] text-muted">这一条绘语用不上，只给查看。</p> : <PrimaryBtn className="mt-4" onClick={save}>保存</PrimaryBtn>}
      </Modal>
    </div>
  );
}

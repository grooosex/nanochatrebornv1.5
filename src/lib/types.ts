import type { LookSettings, LookTheme } from "./look";
import type { RandomBank, RandomSnap } from "./random-prompt";

export type TabId = "chat" | "params" | "pure";

export type GrokModelId =
  | "grok-4.7-high"
  | "grok-4.7-medium"
  | "grok-4.7-low"
  | "grok-4.6-high"
  | "grok-4.6-medium"
  | "grok-4.6-low"
  | "grok-4.5-high"
  | "grok-4.5-medium"
  | "grok-4.5-low";

export type NaiModelId =
  | "nai-diffusion-5-full"
  | "nai-diffusion-5-curated"
  | "nai-diffusion-4-5-full"
  | "nai-diffusion-4-5-curated"
  | "nai-diffusion-4-full"
  | "nai-diffusion-4-curated"
  | "nai-diffusion-3"
  | "nai-diffusion-furry-3"
  | "nai-diffusion-4-5-furry"
  | "nai-diffusion-4-furry";

export type SamplerId =
  | "k_euler_ancestral"
  | "k_euler"
  | "k_dpmpp_2s_ancestral"
  | "k_dpmpp_2m"
  | "k_dpmpp_sde"
  | "k_dpmpp_2m_sde"
  | "ddim_v3";

export type NoiseSchedule = "native" | "karras" | "exponential" | "polyexponential";

export type UcPreset = "heavy" | "light" | "human" | "custom";

export type MultiMode = "together" | "group";
export type PromptInsertMode = "insert" | "legacy";

export interface ExtraField {
  id: string;
  body: string;
  applyImage?: boolean;
  emphasize?: boolean;
}

export interface Character {
  id: string;
  name: string;
  persona: string;
  speech: string;
  appearance: string;
  lookBlobId?: string;
  extras: ExtraField[];
  personaVoices?: boolean;
  imageEnabled: boolean;
  prompt: string;
  uc: string;
  x: number;
  y: number;
  wechatAvatarBlobId?: string;
}

export interface ImageParams {
  promptFront: string;
  promptMid: string;
  promptBack: string;
  merged: boolean;
  sensitive: boolean;
  uncensored: boolean;
  fullBody: boolean;
  tagSuggest: boolean;
  negative: string;
  ucPreset: UcPreset;
  model: NaiModelId;
  width: number;
  height: number;
  sampler: SamplerId;
  noiseSchedule: NoiseSchedule;
  steps: number;
  scale: number;
  cfgRescale: number;
  seed: number | null;
  seedLocked: boolean;
  stepsLocked: boolean;
  scaleLocked: boolean;
  cfgRescaleLocked: boolean;
  varietyPlus: boolean;
  decrisper: boolean;
  useCoords: boolean;
  characters: CharacterPrompt[];
  img2imgBlobId?: string;
  img2imgStrength?: number;
  img2imgNoise?: number;
}

export interface CharacterPrompt {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  uc: string;
  x: number;
  y: number;
}

export type ImageGenSource = "auto" | "same" | "rewrite" | "custom";

export interface GenImage {
  id: string;
  blobId?: string;
  prompt: string;
  charTails?: Record<string, string>;
  negative: string;
  seed: number;
  model: NaiModelId;
  width: number;
  height: number;
  steps: number;
  sampler: SamplerId;
  status: "writing" | "uploading" | "generating" | "receiving" | "done" | "error";
  error?: string;
  source?: ImageGenSource;
  createdAt: number;
}

export interface UserShot {
  blobId: string;
  i2i: boolean;
}

export interface WechatSticker {
  blobId: string;
  brief: string;
}

export interface WechatAttach {
  blobId: string;
  kind: "photo" | "sticker";
}

export interface WechatLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments: WechatAttach[];
  inner?: string;
  images?: GenImage[];
  /** 多人微信里这条是谁发的。单人没有。 */
  speakerId?: string;
  /** 点了继续。不显示气泡，只用来把这一轮和上一轮分开。 */
  continued?: boolean;
  /** @deprecated 旧的单图框 */
  gen?: { status: "pending" | "done" | "error"; blobId?: string; error?: string };
}

export interface WechatRoom {
  lines: WechatLine[];
  earlier: string;
  folded: number;
  draft: string;
  pending: WechatAttach[];
}

export interface WechatAi {
  accountId: string;
  model: string;
}

export interface WechatSession {
  charId: string;
  lines: WechatLine[];
  earlier: string;
  folded: number;
  draft: string;
  pending: WechatAttach[];
  armed: boolean;
  minimized: boolean;
  /** 多人当前房间。角色 id，或 group。单人没有。 */
  activeRoom?: string;
  rooms?: Record<string, WechatRoom>;
}

export interface WechatLog {
  charName: string;
  lines: WechatLine[];
  summary: string;
  voided?: boolean;
  activeRoom?: string;
  rooms?: Record<string, WechatRoom>;
  roomNames?: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "narrator";
  characterId?: string;
  characterName?: string;
  content: string;
  images: GenImage[];
  createdAt: number;
  userImages?: UserShot[];
  userImageBlobId?: string;
  userImageI2i?: boolean;
  wechatLog?: WechatLog;
}

export interface MemorySnap {
  covered: number;
  text: string;
  foldAt: number;
}

export interface Chat {
  id: string;
  folderId: string | null;
  name: string;
  remark: string;
  starred: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  isDraft?: boolean;
  grokModelId: GrokModelId;
  isMulti: boolean;
  multiMode: MultiMode;
  promptMode: PromptInsertMode;
  adultBoost: boolean;
  canGen: boolean;
  statusBarOn: boolean;
  statusBar: string;
  /** 关掉时不进提示词，也不在聊天里显示。 */
  affectionOn?: boolean;
  /** 每人当前好感度。关掉开关也不清。 */
  affections?: Record<string, number>;
  overview: string;
  opening: string;
  extras: ExtraField[];
  memory: string;
  memoryUntil: number;
  memoryFoldAt: number;
  memorySnaps: MemorySnap[];
  characters: Character[];
  imageParams: ImageParams;
  messages: ChatMessage[];
  avatarBlobId?: string;
  customAvatarBlobId?: string;
  scrollTop: number;
  /** 微信单独用的账号和模型。没有就是跟主聊天一样。 */
  wechatAi?: WechatAi;
  /** @deprecated lifted into Settings.imageModelId */
  imageModelId?: string | null;
  /** @deprecated lifted into Settings.imageModelPin */
  imageModelPin?: string | null;
  /** 这一个聊天自己的背景图。有它就盖过总设置，铺在人设、正文、生图参数。 */
  bgImageId?: string;
  bgFade?: number;
  /** 这个聊天正文要不要纯色底。没设过就跟总设置。 */
  textPlate?: boolean;
  /** 普通聊天没有这个字段。绘语工坊里的两种助手。 */
  kind?: "assistant" | "card";
  /** 助手自己的要求。只进这一个助手的提示词。 */
  brief?: string;
}

export interface Folder {
  id: string;
  name: string;
  starred: boolean;
  collapsed: boolean;
  order: number;
  createdAt: number;
  /** 绘语工坊里的文件夹。外面的列表看不到。 */
  place?: "workshop";
}

export interface CharacterCard {
  id: string;
  name: string;
  isMulti: boolean;
  overview: string;
  opening: string;
  extras: ExtraField[];
  statusBarOn: boolean;
  statusBar: string;
  characters: Character[];
  grokModelId: GrokModelId;
  /** 整张卡一张。老卡没有这张图，空着就表示没存。 */
  customAvatarBlobId?: string;
  createdAt: number;
  order: number;
}

export interface AppearancePreset {
  id: string;
  name: string;
  prompt: string;
  order: number;
  createdAt: number;
}

export interface FavGroup {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  order: number;
  starred?: boolean;
  createdAt: number;
}

export interface FavoriteItem {
  id: string;
  name: string;
  params: ImageParams;
  blobId?: string;
  createdAt: number;
  order?: number;
  groupId?: string | null;
  starred?: boolean;
  /** 收藏当时那张图的随机进度。删了历史也还在。 */
  randomSnap?: RandomSnap;
}

export interface HistoryItem {
  id: string;
  blobId?: string;
  prompt: string;
  negative: string;
  seed: number;
  model: NaiModelId;
  width: number;
  height: number;
  steps: number;
  sampler: SamplerId;
  params: ImageParams;
  createdAt: number;
  status: GenImage["status"];
  error?: string;
  /** 这张图用过的随机模块。老记录没有。 */
  randomSnap?: RandomSnap;
}

export type ChatSource = "grok" | "api";

export interface LlmParams {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxTokens: number;
  contextTurns: number;
  temperatureLocked?: boolean;
  topPLocked?: boolean;
  frequencyPenaltyLocked?: boolean;
  presencePenaltyLocked?: boolean;
  maxTokensLocked?: boolean;
  contextTurnsLocked?: boolean;
}

export interface LlmAccount {
  id: string;
  name: string;
  base: string;
  key: string;
  starred?: string[];
  model?: string;
}

export interface StPresetParams {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
}

export interface StPromptItem {
  id: string;
  name: string;
  content: string;
  /** 导入时的原文。只给还原按钮用，不会发给模型。 */
  original?: string;
  /** 导入时的开关。只给还原按钮用，不会发给模型。 */
  originalEnabled?: boolean;
  enabled: boolean;
  /** before：聊天记录前面。after：聊天记录后面。 */
  place: "before" | "after";
  /** 空位、工具调用这类绘语用不上的，只展示。 */
  usable: boolean;
}

export interface StPreset {
  id: string;
  name: string;
  systemPrompt: string;
  postHistory: string;
  /** 按旧版算法在导入时封存的两段。新版里改条目不会改这里。 */
  legacySystemPrompt?: string;
  legacyPostHistory?: string;
  params: StPresetParams;
  items?: StPromptItem[];
}

export interface SysPromptPatch {
  /** 改过的正文。没有就用原来的。 */
  text?: string;
  /** 聊天写法 / 结构规则：有值就不再跟着预设。 */
  force?: boolean;
  /** 其它块：true 才不发。 */
  off?: boolean;
  /** 保存时原文的指纹。用来判断后来有没有更新。 */
  base?: string;
  /** 用户选了保留我的版本。不再弹更新。 */
  kept?: boolean;
}

export interface Settings {
  grokModelId: GrokModelId;
  chatSource: ChatSource;
  llmBase: string;
  llmKey: string;
  llmConnected: boolean;
  llmModel: string;
  llmModels: string[];
  llmStarred: string[];
  llmAccounts: LlmAccount[];
  /** 同时登录的账号。少于两个就是原来的单连接。 */
  llmActiveIds?: string[];
  llmParams: LlmParams;
  /** Last successfully connected API account; used to reset 配图 AI on account switch. */
  llmIdentity?: string;
  stPresets: StPreset[];
  stActiveId: string | null;
  stParamSnapshot: LlmParams | null;
  /** 单独写生图提示词时用的预设。不改温度。未选则和以前一样。 */
  stImageActiveId: string | null;
  /** 写微信回复时用的预设。不改温度，也不改微信的 JSON 格式。未选则和以前一样。 */
  stWechatActiveId: string | null;
  /** 三处共用的那一份。开关决定用在哪。 */
  stPresetId?: string | null;
  stUseChat?: boolean;
  stUseImage?: boolean;
  stUseWechat?: boolean;
  /** 新版按开关发送。旧版用导入时封存的整段。 */
  stPresetMode?: "new" | "old";
  naiKey: string;
  naiBase: string;
  naiConnected: boolean;
  /** 当前生图走中转站还是官网。两边密钥都留着，只有一边算已连接。 */
  naiImageSource?: "proxy" | "official";
  naiOfficialKey?: string;
  naiOfficialConnected?: boolean;
  cooldownUntil: number;
  chatImage: boolean;
  /** 点亮（默认）多人总提示可以有 1boy。熄灭只扣模型刚写的总提示。 */
  allowMulti1boy?: boolean;
  /** 以后新建的写卡助手用这张头像。 */
  workshopCardAvatar?: string;
  /** 以后新建的绘语助理用这张头像。 */
  workshopAssistAvatar?: string;
  /** 旧状态栏已换成新模板。只在第一次打开时用，之后不再扫。 */
  statusBarMigrated?: boolean;
  /** null/unset = 与聊天一致. Global, not per-chat. */
  imageModelId?: string | null;
  /** Last explicit API pick for 配图 AI; kept at the end of the list on Grok. */
  imageModelPin?: string | null;
  theme: "light" | "dark";
  /** 纯生图收藏是否用缩略图。关掉收藏再打开仍保持。 */
  favThumbs?: boolean;
  /** 纯生图角色栏锁定。收藏/历史应用参数时不覆盖角色。 */
  pureCharLocked?: boolean;
  /** 纯生图的正面提示词中。锁着时填入和套用不改中段，手打仍可以。 */
  purePromptMidLocked?: boolean;
  /** 聊天生图的正面提示词中。和纯生图分开记。 */
  chatPromptMidLocked?: boolean;
  /** 一次绘图连着画几张。滑块，1–10。确定和无穷都没亮时用它。 */
  multiDrawCount?: number;
  /** 无视张数，一直画到再点绘图。和确定互斥。 */
  multiDrawInfinite?: boolean;
  /** 确定亮起时用的张数。至少 1，不封顶。 */
  multiDrawExact?: number;
  /** 亮起时不听滑块，听输入框。和无穷互斥。 */
  multiDrawExactOn?: boolean;
  /** 出图回来立刻发下一张，不等冷却。失败仍要等一分钟。 */
  multiDrawFast?: boolean;
  /** 生图提示词里的随机模块。关着时符号当普通字。 */
  random?: RandomBank;
  /** 生图提示词的分组虚线和权重颜色。关着只留字。 */
  promptPreview?: boolean;
  /** 旧开关。没有 promptPreview 时，两个都开才算显示预览。 */
  promptGroup?: boolean;
  /** 旧开关。没有 promptPreview 时，两个都开才算显示预览。 */
  promptColor?: boolean;
  /** 点一个词，看词库里的中文。 */
  promptGloss?: boolean;
  /** 有译文的那一组再画虚线。点词译文关着时点不了。 */
  promptGlossLine?: boolean;
  /** 词库没有的词，点到时问翻译接口。 */
  promptNet?: boolean;
  /** 聊天正文的字和整张纸的颜色。不进模型。 */
  look?: LookSettings;
  lookThemes?: LookTheme[];
  /** 系统提示词里改过的块。没改过的不记，发出去的和原来一样。 */
  sysPrompt?: Record<string, SysPromptPatch>;
}

export interface AppDataDump {
  version: 1;
  settings: Settings;
  folders: Folder[];
  chats: Chat[];
  cards: CharacterCard[];
  appearances: AppearancePreset[];
  favorites: FavoriteItem[];
  favGroups?: FavGroup[];
  history: HistoryItem[];
  hasImages: boolean;
  wechatSessions?: Record<string, WechatSession>;
  wechatStickers?: WechatSticker[];
  /** 纯生图当前这套参数。三种存档都带，没有图片。 */
  pureParams?: ImageParams;
  /** 上次打开的聊天。 */
  currentId?: string | null;
  /** 还没发出去的输入框文字。 */
  composerDrafts?: Record<string, string>;
  /** 还没发出去的附图。无配图存档里会清空。 */
  composerShots?: Record<string, UserShot[]>;
}

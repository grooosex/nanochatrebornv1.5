const ZH_FIX: Record<string, string> = {
  solo: "单人",
  "1girl": "1个女孩",
  "1boy": "1个男孩",
  "2girls": "2个女孩",
  "multiple girls": "多个女孩",
  breasts: "胸部",
  "looking at viewer": "看向观众",
  "commentary request": "求评论",
  commentary: "评论",
  highres: "高分辨率",
  absurdres: "超高分辨率",
  "open mouth": "张嘴",
  "closed mouth": "闭嘴",
  "large breasts": "巨乳",
  "small breasts": "贫乳",
  "medium breasts": "中等胸部",
  navel: "肚脐",
  panties: "内裤",
  pussy: "小穴",
  penis: "阴茎",
  ass: "臀部",
  nude: "裸体",
  hetero: "男女",
  sex: "性交",
  sitting: "坐着",
  standing: "站立",
  lying: "躺着",
  "cowboy shot": "七分身",
  "upper body": "上半身",
  "full body": "全身",
  "from behind": "从后方",
  "from side": "侧面",
  "from above": "俯视",
  "from below": "仰视",
  "looking back": "回眸",
  "spread legs": "张开腿",
  "animal ears": "兽耳",
  "cat ears": "猫耳",
  tail: "尾巴",
  blush: "脸红",
  smile: "微笑",
  nipples: "乳头",
  uncensored: "无码",
  censored: "有码",
  cum: "精液",
  vaginal: "阴道插入",
  anal: "肛交",
  fellatio: "口交",
  paizuri: "乳交",
  missionary: "传教士",
  doggystyle: "后入",
  "cowgirl position": "骑乘",
  ahegao: "阿黑颜",
  bondage: "捆绑",
  tentacles: "触手",
  "heart-shaped pupils": "爱心瞳",
  "tongue out": "吐舌",
  sweat: "出汗",
  "steaming body": "热气",
  "pussy juice": "爱液",
  "female ejaculation": "潮吹",
  "object insertion": "物体插入",
  "anal object insertion": "肛门物体插入",
  "anus peek": "肛门窥视",
  "after anal": "肛交之后",
  "anal beads": "肛珠",
  "anal tail": "肛尾",
  "anal fingering": "肛门指交",
  anus: "肛门",
  holding: "手持",
  fang: "虎牙",
  "simple background": "简单背景",
  "white background": "白背景",
  original: "原创",
  translated: "已翻译",
  "bad id": "错误ID",
  "bad pixiv id": "错误pixiv ID",
};

export type Tag = { e: string; c: string; n: number };

let tags: Tag[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let glossMap: Map<string, string> | null = null;

function glossKey(raw: string) {
  return raw.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function rebuildGloss() {
  glossMap = new Map();
  for (const tag of tags) {
    const zh = tag.c.trim();
    if (!zh || zh.toLowerCase() === tag.e.toLowerCase()) continue;
    glossMap.set(glossKey(tag.e), zh);
  }
}

export function tagGloss(body: string) {
  if (!glossMap) rebuildGloss();
  const key = glossKey(body);
  if (!key) return null;
  return glossMap?.get(key) ?? null;
}

export function loadTags() {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = fetch("/data/tags.json")
    .then((r) => r.json())
    .then((rows: Tag[]) => {
      tags = rows.map((t) => ({ ...t, c: ZH_FIX[t.e] || t.c }));
      rebuildGloss();
      loaded = true;
    })
    .catch(() => {
      tags = Object.entries(ZH_FIX).map(([e, c], i) => ({ e, c, n: 1_000_000 - i }));
      rebuildGloss();
      loaded = true;
    });
  return loading;
}

function lastToken(text: string, caret: number) {
  const left = text.slice(0, caret);
  const m = left.match(/([^,\n]*)$/);
  return (m?.[1] ?? "").trim();
}

export function suggestTags(text: string, caret: number, limit = 40) {
  const q = lastToken(text, caret).toLowerCase();
  if (!q) return { q, total: 0, items: [] as Tag[] };
  const hits: Tag[] = [];
  for (const t of tags) {
    const en = t.e.toLowerCase();
    const zh = t.c;
    if (en.startsWith(q) || en.includes(q) || zh.includes(q)) hits.push(t);
  }
  hits.sort((a, b) => {
    const as = a.e.toLowerCase().startsWith(q) ? 1 : 0;
    const bs = b.e.toLowerCase().startsWith(q) ? 1 : 0;
    if (as !== bs) return bs - as;
    return b.n - a.n;
  });
  return { q, total: hits.length, items: hits.slice(0, limit) };
}

export function insertTag(text: string, caret: number, tag: string) {
  const left = text.slice(0, caret);
  const right = text.slice(caret);
  const m = left.match(/^(.*?)([^,\n]*)$/s);
  const prefix = m?.[1] ?? left;
  const lead = prefix && !prefix.endsWith("\n") && !/,\s*$/.test(prefix) ? (prefix.endsWith(",") ? " " : ", ") : "";
  const next = `${prefix}${lead}${tag}, `;
  return { text: next + right.replace(/^\s*,?\s*/, ""), caret: next.length };
}

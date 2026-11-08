export type WeightKind = "up" | "down" | "neg" | "none";

export type PromptSeg =
  | { kind: "text"; text: string; weight: WeightKind; body: string }
  | { kind: "gap"; text: string }
  | { kind: "ran"; text: string; names: string[] }
  | { kind: "slot"; text: string; names: string[] };

const NUM = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/;
const RAN = /^<ran_id="([^"]+)"((?:&"[^"]+")*)>/;

export function ranNames(tag: string): string[] {
  const m = tag.match(RAN);
  if (!m) return [];
  return [m[1], ...[...m[2].matchAll(/"([^"]+)"/g)].map((hit) => hit[1])];
}

export function weightOf(group: string): WeightKind {
  const s = group.trim();
  const num = s.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?=::)/);
  if (num) {
    const n = Number(num[0]);
    if (!Number.isFinite(n) || n === 1) return "none";
    if (n < 0) return "neg";
    if (n > 1) return "up";
    if (n > 0) return "down";
    return "none";
  }
  if (s.startsWith("{")) return "up";
  if (s.startsWith("[")) return "down";
  return "none";
}

export function glossBody(group: string): string {
  let s = group.trim();
  s = s.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/, "");
  s = s.replace(/::$/, "");
  s = s.replace(/^[{[]\s*/, "").replace(/\s*[}\]]$/, "");
  return s.trim();
}

export function isMostlyChinese(text: string) {
  const zh = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const en = text.match(/[A-Za-z]/g)?.length ?? 0;
  return zh > 0 && zh >= en;
}

export function replaceWeightBody(group: string, next: string) {
  const lead = group.match(/^\s*/)?.[0] ?? "";
  const tail = group.match(/\s*$/)?.[0] ?? "";
  const core = group.trim();
  const closed = core.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)::)([\s\S]*?)(::)$/);
  if (closed) return `${lead}${closed[1]}${next}${closed[3]}${tail}`;
  const open = core.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)::)([\s\S]+)$/);
  if (open) return `${lead}${open[1]}${next}${tail}`;
  const brace = core.match(/^([{[])([\s\S]*)([}\]])$/);
  if (brace) return `${lead}${brace[1]}${next}${brace[3]}${tail}`;
  return `${lead}${next}${tail}`;
}

export function promptSegments(shown: string, live: (names: string[]) => boolean): PromptSeg[] {
  const out: PromptSeg[] = [];
  let i = 0;
  while (i < shown.length) {
    const ran = shown.slice(i).match(RAN);
    if (ran?.index === 0) {
      const names = ranNames(ran[0]);
      if (live(names)) {
        out.push({ kind: "ran", text: ran[0], names });
        i += ran[0].length;
        if (shown.startsWith("\u2003\u2003", i)) {
          out.push({ kind: "slot", text: "\u2003\u2003", names });
          i += 2;
        }
        continue;
      }
    }
    let j = i;
    let depth = 0;
    const weight = shown.slice(i).match(NUM);
    if (weight) {
      out.push({ kind: "gap", text: weight[0] });
      i += weight[0].length;
      continue;
    }
    if (shown.startsWith("::", i)) {
      out.push({ kind: "gap", text: "::" });
      i += 2;
      continue;
    }
    while (j < shown.length) {
      const ahead = shown.slice(j).match(RAN);
      if (ahead?.index === 0 && live(ranNames(ahead[0]))) break;
      const ch = shown[j]!;
      if (ch === "{" || ch === "[") depth += 1;
      else if ((ch === "}" || ch === "]") && depth > 0) depth -= 1;
      if (depth === 0 && (shown.slice(j).match(NUM) || shown.startsWith("::", j))) break;
      if ((ch === "," || ch === "，" || ch === "\n") && depth === 0) break;
      j += 1;
    }
    if (j > i) {
      const text = shown.slice(i, j);
      out.push({ kind: "text", text, weight: weightOf(text), body: glossBody(text) });
    }
    if (j < shown.length && (shown[j] === "," || shown[j] === "，" || shown[j] === "\n") && !(shown.slice(j).match(RAN)?.index === 0)) {
      out.push({ kind: "gap", text: shown[j]! });
      j += 1;
    }
    if (j === i) {
      out.push({ kind: "gap", text: shown[i]! });
      j += 1;
    }
    i = j;
  }
  return out;
}

export function groupAt(segs: PromptSeg[], caret: number): { index: number; seg: Extract<PromptSeg, { kind: "text" }> } | null {
  let at = 0;
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i]!;
    const end = at + seg.text.length;
    if (seg.kind === "text" && seg.body.trim() && caret >= at && caret <= end) return { index: i, seg };
    at = end;
  }
  return null;
}

import assert from "node:assert/strict";
import test from "node:test";
import type { ImageParams } from "./types.ts";
import { applyPromptSlots } from "./prompt-slots.ts";
import {
  applyScheme,
  emptyBank,
  expandParams,
  mergeDrawProgress,
  restoreRandomSnap,
  refreshSnapEnabled,
  snapHasRandomItems,
  type RandomBank,
  type RandomModule,
  type RandomScheme,
  type RandomSnap,
} from "./random-prompt.ts";
import { bindSysApp, bindSysBaselines, keepSysVersions, saveSysText, sourceHash, stampSysHashes, sysDrifted } from "./sys-prompt.ts";
import type { SysPromptPatch } from "./types.ts";

function params(partial: Partial<ImageParams> = {}): ImageParams {
  return {
    promptFront: "",
    promptMid: "",
    promptBack: "",
    merged: false,
    sensitive: false,
    uncensored: false,
    fullBody: false,
    tagSuggest: false,
    negative: "",
    ucPreset: "heavy",
    model: "nai-diffusion-4-5-full",
    width: 832,
    height: 1216,
    sampler: "k_euler_ancestral",
    noiseSchedule: "karras",
    steps: 28,
    scale: 5,
    cfgRescale: 0,
    seed: null,
    seedLocked: false,
    stepsLocked: false,
    scaleLocked: false,
    cfgRescaleLocked: false,
    varietyPlus: false,
    decrisper: false,
    useCoords: false,
    characters: [],
    ...partial,
  };
}

function mod(partial: Partial<RandomModule> & Pick<RandomModule, "id" | "name">): RandomModule {
  return { pick: "random", items: [], nextId: null, ...partial };
}

test("field tags split, bare 正 stays, character slot and pure gap", () => {
  const slotted = applyPromptSlots(
    params({
      merged: false,
      characters: [{ id: "c1", name: "甲", enabled: true, prompt: "base", uc: "", x: 0.2, y: 0.3 }],
    }),
    {
      promptFront: "甲, <正1前:头> <正前:留着> <角色2:乙> <角色7:超>",
      promptMid: "<正2后:尾>",
      promptBack: "",
      negative: "<负前:坏>",
    },
    true,
  );
  assert.equal(slotted.params.promptFront.includes("<正前:留着>"), true);
  assert.equal(slotted.params.promptFront.startsWith("头"), true);
  assert.equal(slotted.params.promptMid.endsWith("尾"), true);
  assert.equal(slotted.params.negative.startsWith("坏"), true);
  assert.equal(slotted.params.characters[1]?.prompt, "乙");
  assert.equal(slotted.params.characters[1]?.enabled, true);
  assert.equal(slotted.params.characters[1]?.x, 0.5);
  assert.equal(slotted.charMissing.includes(7), true);
  assert.equal(slotted.params.promptFront.includes("超"), true);
});

test("nested ran expands before character slots, self nest stays raw", () => {
  const inner = mod({
    id: "in",
    name: "里",
    items: [{ id: "i1", name: "a", content: "笑脸", enabled: true }],
  });
  const outer = mod({
    id: "out",
    name: "外",
    items: [{ id: "o1", name: "b", content: '<角色1:<ran_id="里">>', enabled: true }],
  });
  const loop = mod({
    id: "loop",
    name: "环",
    items: [{ id: "l1", name: "c", content: '<ran_id="环">', enabled: true }],
  });
  const bank: RandomBank = { ...emptyBank(), enabled: true, modules: [inner, outer, loop] };
  const got = expandParams(params({ promptMid: '<ran_id="外"> <ran_id="环">' }), bank, () => 0, { fillMissing: true });
  assert.equal(got.params.characters[0]?.prompt, "笑脸");
  assert.equal(got.params.promptMid.includes("<ran_id="), true);
  assert.equal(got.usedItemIds.includes("o1"), true);
  assert.equal(got.usedItemIds.includes("i1"), true);
});

test("merge keeps a turn the user moved, snap restore restarts the cycle", () => {
  const before: RandomBank = {
    ...emptyBank(),
    enabled: true,
    modules: [
      mod({
        id: "m",
        name: "动作",
        pick: "seq",
        nextId: "a",
        items: [
          { id: "a", name: "a", content: "A", enabled: true },
          { id: "b", name: "b", content: "B", enabled: true },
        ],
      }),
    ],
  };
  const after: RandomBank = {
    ...before,
    modules: [{ ...before.modules[0]!, nextId: "b", hold: { itemId: "a", used: 1 } }],
  };
  const changed: RandomBank = {
    ...before,
    modules: [{ ...before.modules[0]!, nextId: null }],
  };
  assert.equal(mergeDrawProgress(before, after, changed).modules[0]?.nextId, null);
  assert.equal(mergeDrawProgress(before, after, before).modules[0]?.nextId, "b");
  const restored = restoreRandomSnap(before, {
    modules: [
      {
        id: "m",
        name: "动作",
        pick: "random",
        rounds: 1,
        itemId: "a",
        used: 1,
        enabled: { a: true, b: false },
      },
    ],
  });
  assert.equal(restored.modules[0]?.hold ?? null, null);
  assert.equal(restored.modules[0]?.nextId ?? null, null);
  assert.equal(restored.modules[0]?.pick, "random");
  assert.equal(restored.modules[0]?.items.find((item) => item.id === "b")?.enabled, false);
  const seqDone = restoreRandomSnap(before, {
    modules: [{ id: "m", name: "动作", pick: "seq", rounds: 1, itemId: "a", used: 1, enabled: { a: true, b: true } }],
  });
  assert.equal(seqDone.modules[0]?.hold ?? null, null);
  assert.equal(seqDone.modules[0]?.nextId, "a");
  const seqMid = restoreRandomSnap(
    {
      ...before,
      modules: [
        mod({
          id: "m",
          name: "动作",
          pick: "seq",
          rounds: 3,
          nextId: "c",
          hold: { itemId: "b", used: 2 },
          items: [
            { id: "a", name: "a", content: "A", enabled: true },
            { id: "b", name: "b", content: "B", enabled: false },
            { id: "c", name: "c", content: "C", enabled: true },
          ],
        }),
      ],
    },
    {
      modules: [
        {
          id: "m",
          name: "动作",
          pick: "seq",
          rounds: 3,
          itemId: "b",
          used: 2,
          enabled: { a: true, b: true, c: true },
        },
      ],
    },
  );
  assert.equal(seqMid.modules[0]?.hold ?? null, null);
  assert.equal(seqMid.modules[0]?.nextId, "a");
  assert.equal(seqMid.modules[0]?.rounds, 3);
});

test("scheme replace and union skip unknown ids", () => {
  const items = [
    { id: "a", name: "a", content: "", enabled: false },
    { id: "b", name: "b", content: "", enabled: true },
    { id: "c", name: "c", content: "", enabled: false },
  ];
  const scheme: RandomScheme = { id: "s", name: "日", order: 0, enabled: { a: true, b: false } };
  const replaced = applyScheme(items, scheme, "replace");
  assert.equal(replaced[0]?.enabled, true);
  assert.equal(replaced[1]?.enabled, false);
  assert.equal(replaced[2]?.enabled, false);
  const union = applyScheme(items, scheme, "union");
  assert.equal(union[0]?.enabled, true);
  assert.equal(union[1]?.enabled, true);
});

test("refresh snap enabled keeps rounds and only rewrites ticks on recorded modules", () => {
  const snap: RandomSnap = {
    modules: [
      {
        id: "m",
        name: "动作",
        pick: "seq" as const,
        rounds: 4,
        itemId: "a",
        used: 2,
        enabled: { a: true, b: false },
      },
      {
        id: "gone",
        name: "旧模块",
        pick: "random" as const,
        rounds: 1,
        enabled: { z: true },
      },
    ],
  };
  const bank: RandomBank = {
    ...emptyBank(),
    enabled: true,
    modules: [
      mod({
        id: "m",
        name: "动作",
        pick: "random",
        rounds: 1,
        items: [
          { id: "a", name: "a", content: "A", enabled: false },
          { id: "c", name: "c", content: "C", enabled: true },
        ],
      }),
      mod({
        id: "other",
        name: "衣服",
        items: [{ id: "h", name: "h", content: "H", enabled: true }],
      }),
    ],
  };
  assert.equal(snapHasRandomItems(snap), true);
  assert.equal(snapHasRandomItems(undefined), false);
  const next = refreshSnapEnabled(snap, bank);
  assert.equal(next.modules[0]?.rounds, 4);
  assert.equal(next.modules[0]?.pick, "seq");
  assert.equal(next.modules[0]?.itemId, "a");
  assert.equal(next.modules[0]?.used, 2);
  assert.deepEqual(next.modules[0]?.enabled, { a: false, c: true });
  assert.deepEqual(next.modules[1]?.enabled, { z: true });
  assert.equal(next.modules.length, 2);
  assert.equal(refreshSnapEnabled(next, bank), next);
});

test("sys drift stamps old edits and only pops when the source hash moved", () => {
  let sysPrompt: Record<string, SysPromptPatch> | undefined = { hello: { text: "我写的" } };
  bindSysBaselines(() => ({ hello: "原文" }));
  bindSysApp(() => ({
    getState: () => ({
      settings: { sysPrompt },
      setSettings: (patch: { sysPrompt?: Record<string, SysPromptPatch> }) => {
        sysPrompt = patch.sysPrompt;
      },
    }),
  }));
  let h = 5381;
  for (const ch of "原文") h = (h << 5) + h ^ ch.charCodeAt(0);
  assert.equal(sourceHash("hello"), (h >>> 0).toString(16));
  assert.equal(sysDrifted("hello"), false);
  stampSysHashes();
  assert.equal(sysPrompt?.hello?.base, sourceHash("hello"));
  assert.equal(sysDrifted("hello"), false);
  bindSysBaselines(() => ({ hello: "新原文" }));
  assert.equal(sysDrifted("hello"), true);
  keepSysVersions(["hello"]);
  assert.equal(sysPrompt?.hello?.kept, true);
  saveSysText("hello", "新原文", "新原文");
  assert.equal(sysPrompt?.hello, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ImageParams } from "./types.ts";
import {
  appendPrompt,
  bankSwitch,
  duplicateRandomModule,
  expandParams,
  forgetIfPrompt,
  moduleTag,
  jumpSeq,
  liveRanSpans,
  withRanSlots,
  stripRanSlots,
  cleanCaret,
  commitRanDrafts,
  patchSnapFromDrafts,
  ranDraftOf,
  parseRandomBank,
  reviveAppearanceModule,
  deleteRandomGroup,
  seqTurnItem,
  setModulePick,
  setModuleRounds,
  syncAppearanceModule,
  type RandomBank,
} from "./random-prompt.ts";

function params(partial: Partial<ImageParams>): ImageParams {
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

const bank: RandomBank = {
  enabled: true,
  modules: [
    {
      id: "a",
      name: "角色",
      pick: "seq",
      items: [
        { id: "a1", name: "小玉", content: "xiaoyu", enabled: true },
        { id: "a2", name: "小铃", content: "xiaoling", enabled: true },
        { id: "a3", name: "关掉", content: "nope", enabled: false },
      ],
    },
    {
      id: "b",
      name: "动作",
      pick: "random",
      items: [{ id: "b1", name: "站", content: "standing", enabled: true }],
    },
  ],
  comboLast: {},
};

test("switch off leaves the tag as plain text", () => {
  const off = bankSwitch(bank, false);
  assert.equal(off.enabled, false);
  assert.equal(off.modules[0].nextId, null);
  const got = expandParams(params({ promptMid: '<ran_id="角色">' }), off, () => 0);
  assert.equal(got.params.promptMid, '<ran_id="角色">');
  assert.equal(got.bank, off);
});

test("slash form is not a tag", () => {
  const got = expandParams(params({ promptMid: '<ran_id="角色"/>' }), bank, () => 0);
  assert.equal(got.params.promptMid, '<ran_id="角色"/>');
});

test("sequence walks enabled items and remembers the next", () => {
  const first = expandParams(params({ promptMid: '<ran_id="角色">' }), bank, () => 0);
  assert.equal(first.params.promptMid, "xiaoyu");
  assert.equal(first.bank?.modules[0].nextId, "a2");
  const second = expandParams(params({ promptMid: '<ran_id="角色">' }), first.bank, () => 0);
  assert.equal(second.params.promptMid, "xiaoling");
  const third = expandParams(params({ promptMid: '<ran_id="角色">' }), second.bank, () => 0);
  assert.equal(third.params.promptMid, "xiaoyu");
});

test("ampersand picks one item from the pool", () => {
  const seqOnly: RandomBank = {
    enabled: true,
    modules: [
      {
        id: "a",
        name: "角色",
        pick: "seq",
        items: [{ id: "a1", name: "小玉", content: "xiaoyu", enabled: true }],
      },
      {
        id: "c",
        name: "发型",
        pick: "seq",
        items: [{ id: "c1", name: "双马尾", content: "twintails", enabled: true }],
      },
    ],
  };
  const first = expandParams(params({ promptMid: '<ran_id="角色"&"发型">' }), seqOnly, () => 0);
  assert.equal(first.params.promptMid, "xiaoyu");
  const second = expandParams(params({ promptMid: '<ran_id="角色"&"发型">' }), first.bank, () => 0);
  assert.equal(second.params.promptMid, "twintails");
});

test("any random module makes the whole pool random", () => {
  const got = expandParams(params({ promptMid: '<ran_id="角色"&"动作">' }), bank, () => 0.99);
  assert.equal(got.params.promptMid, "standing");
  assert.equal(got.bank?.modules[0].nextId ?? null, null);
});

test("removing the tag forgets the sequence", () => {
  const used = expandParams(params({ promptMid: '<ran_id="角色">' }), bank, () => 0).bank!;
  const kept = forgetIfPrompt(used, params({ promptMid: '<ran_id="角色">' }), params({ promptMid: '<ran_id="角色">, extra' }));
  assert.equal(kept, null);
  const forgotten = forgetIfPrompt(used, params({ promptMid: '<ran_id="角色">' }), params({ promptMid: "only text" }));
  assert.equal(forgotten?.modules[0].nextId, null);
});

test("empty module is removed and reported", () => {
  const got = expandParams(params({ promptMid: '1girl, <ran_id="没有">' }), bank, () => 0);
  assert.equal(got.params.promptMid, "1girl, ");
  assert.deepEqual(got.missing, ["没有"]);
});

test("append adds a comma only when the box already has text", () => {
  assert.equal(appendPrompt("", moduleTag(["角色"])), '<ran_id="角色">');
  assert.equal(appendPrompt("1girl", moduleTag(["角色"])), '1girl,<ran_id="角色">');
  assert.equal(appendPrompt("1girl,", moduleTag(["动作", "发型"])), '1girl,<ran_id="动作"&"发型">');
});

const looks = [
  { id: "p1", name: "小春", prompt: "koharu", order: 2 },
  { id: "p2", name: "花火", prompt: "hanabi", order: 0 },
];

test("appearance module follows the character list and starts unselected", () => {
  const made = syncAppearanceModule({ enabled: false, modules: [], comboLast: {} }, looks, "ensure");
  const mod = made.modules.find((m) => m.linked === "appearances");
  assert.ok(mod);
  assert.equal(mod?.name, "角色");
  assert.deepEqual(
    mod?.items.map((item) => [item.name, item.content, item.enabled, item.sourceId]),
    [
      ["花火", "hanabi", false, "p2"],
      ["小春", "koharu", false, "p1"],
    ],
  );
  const again = syncAppearanceModule(made, looks, "ensure");
  assert.equal(again, made);
});

test("custom item name stays, content follows, copy is independent", () => {
  const made = syncAppearanceModule({ enabled: true, modules: [], comboLast: {} }, looks, "ensure");
  const linked = made.modules[0];
  const renamed = {
    ...made,
    modules: [
      {
        ...linked,
        pick: "seq" as const,
        items: linked.items.map((item) => (item.sourceId === "p2" ? { ...item, name: "火花", nameCustom: true, enabled: true } : item)),
      },
    ],
  };
  const updated = syncAppearanceModule(
    renamed,
    [
      { id: "p2", name: "花火", prompt: "spark", order: 0 },
      { id: "p1", name: "小春", prompt: "koharu2", order: 1 },
      { id: "p3", name: "新的", prompt: "new", order: 2 },
    ],
    "update",
  );
  const mod = updated.modules[0];
  assert.equal(mod.pick, "seq");
  assert.equal(mod.items[0].name, "火花");
  assert.equal(mod.items[0].content, "spark");
  assert.equal(mod.items[0].enabled, true);
  assert.equal(mod.items[1].name, "小春");
  assert.equal(mod.items[1].content, "koharu2");
  assert.equal(mod.items[2].name, "新的");
  assert.equal(mod.items[2].enabled, false);
  const copy = duplicateRandomModule(mod, updated.modules);
  assert.equal(copy.linked, undefined);
  assert.equal(copy.items[0].sourceId, undefined);
  assert.equal(copy.name, "角色(副本)");
  const after = syncAppearanceModule({ ...updated, modules: [...updated.modules, copy] }, looks, "update");
  const copied = after.modules.find((m) => m.id === copy.id);
  assert.equal(copied?.items[0].content, "spark");
  assert.equal(after.modules.find((m) => m.linked === "appearances")?.items.length, 2);
});

test("deleting the appearance module stays deleted until a new character is saved", () => {
  const made = syncAppearanceModule({ enabled: false, modules: [], comboLast: {} }, looks, "ensure");
  const dismissed = { ...made, modules: [], appearanceModuleDismissed: true };
  const held = syncAppearanceModule(dismissed, looks, "ensure");
  assert.equal(held.modules.length, 0);
  const revived = syncAppearanceModule(dismissed, looks, "create");
  assert.equal(revived.modules.length, 1);
  assert.equal(revived.appearanceModuleDismissed, false);
  const parsed = parseRandomBank(dismissed);
  assert.equal(parsed.appearanceModuleDismissed, true);
  assert.equal(syncAppearanceModule(parsed, looks, "ensure").modules.length, 0);
});

test("opening random settings puts a deleted linked module back at the root", () => {
  const made = syncAppearanceModule({ enabled: false, modules: [], comboLast: {} }, looks, "ensure");
  const linked = made.modules[0];
  const bank: RandomBank = {
    ...made,
    appearanceModuleDismissed: true,
    groups: [{ id: "g1", name: "衣服", parentId: null, collapsed: true, order: 0 }],
    modules: [{ ...linked, groupId: "g1" }],
  };
  const gone = deleteRandomGroup(bank, "g1");
  assert.equal(gone.modules.length, 0);
  assert.equal(gone.appearanceModuleDismissed, true);
  const back = reviveAppearanceModule(gone, looks);
  const mod = back.modules.find((m) => m.linked === "appearances");
  assert.equal(mod?.groupId, null);
  assert.equal(mod?.items.length, 2);
  assert.equal(back.appearanceModuleDismissed, false);
  const kept = parseRandomBank(bank);
  assert.equal(kept.groups?.[0].name, "衣服");
  assert.equal(kept.modules[0].groupId, "g1");
});

test("a hand-made module named 角色 is not taken over", () => {
  const manual: RandomBank = {
    enabled: true,
    modules: [{ id: "hand", name: "角色", pick: "random", items: [{ id: "h1", name: "自建", content: "mine", enabled: true }] }],
  };
  const held = syncAppearanceModule(manual, looks, "ensure");
  assert.equal(held, manual);
});

function slowBank(rounds = 2): RandomBank {
  return {
    enabled: true,
    modules: [
      {
        id: "a",
        name: "角色",
        pick: "seq",
        rounds,
        items: [
          { id: "a1", name: "小玉", content: "xiaoyu", enabled: true },
          { id: "a2", name: "小铃", content: "xiaoling", enabled: true },
        ],
      },
    ],
  };
}

test("rounds reuse one item across images then pick the next", () => {
  const first = expandParams(params({ promptMid: '<ran_id="角色">' }), slowBank(), () => 0);
  assert.equal(first.params.promptMid, "xiaoyu");
  assert.equal(first.bank?.modules[0].hold?.used, 1);
  assert.equal(first.bank?.modules[0].nextId, "a2");
  const second = expandParams(params({ promptMid: '<ran_id="角色">' }), first.bank, () => 0);
  assert.equal(second.params.promptMid, "xiaoyu");
  assert.equal(second.bank?.modules[0].hold?.used, 2);
  assert.equal(second.bank?.modules[0].nextId, "a2");
  const third = expandParams(params({ promptMid: '<ran_id="角色">' }), second.bank, () => 0);
  assert.equal(third.params.promptMid, "xiaoling");
  assert.equal(third.bank?.modules[0].hold?.used, 1);
});

test("the same tag twice in one image is still one round", () => {
  const once = expandParams(
    params({ promptMid: '<ran_id="角色">,<ran_id="角色">', promptBack: '<ran_id="角色">' }),
    slowBank(),
    () => 0,
  );
  assert.equal(once.params.promptMid, "xiaoyu,xiaoyu");
  assert.equal(once.params.promptBack, "xiaoyu");
  assert.equal(once.bank?.modules[0].hold?.used, 1);
});

test("a combo re-picks every image when any module's rounds is 1", () => {
  const mixed: RandomBank = {
    enabled: true,
    modules: [
      {
        id: "a",
        name: "角色",
        pick: "seq",
        rounds: 4,
        items: [
          { id: "a1", name: "小玉", content: "xiaoyu", enabled: true },
          { id: "a2", name: "小铃", content: "xiaoling", enabled: true },
        ],
      },
      {
        id: "b",
        name: "动作",
        pick: "seq",
        items: [
          { id: "b1", name: "站", content: "standing", enabled: true },
          { id: "b2", name: "坐", content: "sitting", enabled: true },
        ],
      },
    ],
  };
  const first = expandParams(params({ promptMid: '<ran_id="角色"&"动作">' }), mixed, () => 0);
  const second = expandParams(params({ promptMid: '<ran_id="角色"&"动作">' }), first.bank, () => 0);
  assert.equal(first.params.promptMid, "xiaoyu");
  assert.notEqual(second.params.promptMid, "xiaoyu");
});

test("turning random off or deleting the tag clears the round count", () => {
  const used = expandParams(params({ promptMid: '<ran_id="角色">' }), slowBank(), () => 0).bank!;
  const off = bankSwitch(used, false);
  assert.equal(off.modules[0].hold, null);
  assert.equal(off.modules[0].rounds, 2);
  const forgotten = forgetIfPrompt(used, params({ promptMid: '<ran_id="角色">' }), params({ promptMid: "" }));
  assert.equal(forgotten?.modules[0].hold, null);
  assert.equal(forgotten?.modules[0].rounds, 2);
});

test("switching pick mode drops the held item but keeps rounds", () => {
  const used = expandParams(params({ promptMid: '<ran_id="角色">' }), slowBank(), () => 0).bank!;
  const flipped = setModulePick(used, "a", "random");
  assert.equal(flipped.modules[0].hold, null);
  assert.equal(flipped.modules[0].rounds, 2);
  assert.equal(flipped.modules[0].pick, "random");
  const raised = setModuleRounds(used, "a", 5);
  assert.equal(raised.modules[0].hold?.itemId, used.modules[0].hold?.itemId);
  assert.equal(raised.modules[0].rounds, 5);
});

test("seq turn shows the item still in use, and a manual jump starts there next", () => {
  const used = expandParams(params({ promptMid: '<ran_id="角色">' }), slowBank(), () => 0).bank!;
  const mod = used.modules[0];
  assert.equal(seqTurnItem(mod)?.id, "a1");
  assert.equal(mod.nextId, "a2");
  const jumped = jumpSeq(mod, "a2");
  assert.equal(jumped.hold, null);
  assert.equal(jumped.nextId, "a2");
  const next = expandParams(params({ promptMid: '<ran_id="角色">' }), { ...used, modules: [jumped] }, () => 0);
  assert.equal(next.params.promptMid, "xiaoling");
  assert.equal(seqTurnItem({ ...mod, items: mod.items.map((item) => ({ ...item, enabled: false })) }), null);
});

test("live ran marks need every named module", () => {
  const names = ["角色", "动作"];
  const one = liveRanSpans('<ran_id="角色">\n<ran_id="没有">', names);
  assert.equal(one.length, 1);
  assert.equal(one[0]?.names[0], "角色");
  assert.equal(liveRanSpans('<ran_id="角色"/>', names).length, 0);
  assert.equal(liveRanSpans('<ran_id="角色"&"没有">', names).length, 0);
  const both = liveRanSpans('<ran_id="角色"&"动作">', names);
  assert.deepEqual(both[0]?.names, ["角色", "动作"]);
  const slotted = withRanSlots('<ran_id="角色">后', names);
  assert.equal(slotted, `<ran_id="角色">${"\u2003\u2003"}后`);
  assert.equal(stripRanSlots(slotted), '<ran_id="角色">后');
  assert.equal(cleanCaret(slotted, slotted.indexOf("后")), '<ran_id="角色">'.length);
  assert.equal(withRanSlots('<ran_id="没有">', names), '<ran_id="没有">');
});

test("saving a ran draft rewrites ticks and clears the unfinished round", () => {
  const used = expandParams(params({ promptMid: '<ran_id="角色">' }), slowBank(), () => 0).bank!;
  const draft = ranDraftOf(used.modules[0]);
  assert.equal(commitRanDrafts(used, [draft]), used);
  const next = commitRanDrafts(used, [{ ...draft, enabled: { a1: false, a2: true }, nextId: "a2" }]);
  assert.equal(next.modules[0].items[0].enabled, false);
  assert.equal(next.modules[0].items[0].content, "xiaoyu");
  assert.equal(next.modules[0].hold, null);
  assert.equal(next.modules[0].nextId, "a2");
  assert.equal(next.modules[0].rounds, 2);
  const snap = patchSnapFromDrafts(
    { modules: [{ id: "a", name: "角色", pick: "seq", rounds: 2, itemId: "a1", used: 1, enabled: { a1: true, a2: true } }] },
    used,
    [{ ...draft, pick: "random", enabled: { a1: true, a2: false } }],
  );
  assert.equal(snap.modules[0]?.pick, "random");
  assert.equal(snap.modules[0]?.itemId, "a1");
  assert.deepEqual(snap.modules[0]?.enabled, { a1: true, a2: false });
});



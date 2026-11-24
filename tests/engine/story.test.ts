import { describe, expect, it } from "vitest";
import { parseOptions, parseScript } from "../../apps/web/src/engine/parser";
import { conditionHolds, StoryEngine } from "../../apps/web/src/engine/executor";

const script = `
title:第一章 · 启程;
changeBg:main;
导师:你好，旅人。;
say:导师:先学会输出，再谈改变世界。 -when=pass1!=true;
setVar:ready=true;
choose:选择你的道路 -options=代码=codePath|终端=termPath;;
label:codePath;
code:ch01 -lang=javascript -onPass=pass1;
say:导师:漂亮！ -when=pass1==true;
jump:done;
label:termPath;
term:sh01 -preset=bandit-l1 -mode=explore -unlock=pass2;
label:done;
end;
`;

describe("WebGAL-compatible script subset (design §4.2)", () => {
  it("parses commands, sugar, args, labels and comments", () => {
    const sentences = parseScript(script);
    expect(sentences[0]).toMatchObject({ command: "title", content: "第一章 · 启程" });
    expect(sentences[2]).toMatchObject({ command: "say", content: "导师::你好，旅人。" });
    const code = sentences.find((s) => s.command === "code")!;
    expect(code).toMatchObject({ content: "ch01", args: { lang: "javascript", onPass: "pass1" } });
    expect(parseOptions("A=left|B=right")).toEqual([
      { text: "A", label: "left" }, { text: "B", label: "right" },
    ]);
    expect(sentences.filter((s) => s.command === "label").map((s) => s.content)).toEqual([
      "codePath", "termPath", "done",
    ]);
  });

  it("evaluates -when gating (booleans/numbers/unknown)", () => {
    expect(conditionHolds("pass1==true", { pass1: true })).toBe(true);
    expect(conditionHolds("pass1==true", { pass1: false })).toBe(false);
    expect(conditionHolds("pass1!=true", { pass1: false })).toBe(true);
    expect(conditionHolds("ready", { ready: true })).toBe(true);
    expect(conditionHolds("n==3", { n: 3 })).toBe(true);
    expect(conditionHolds("unknown", {})).toBe(false);
  });

  it("walks the story, blocks at challenge, unlocks the gated line after passing", () => {
    const engine = new StoryEngine(parseScript(script));
    expect(engine.next().type).toBe("title");
    expect(engine.next().type).toBe("bg");
    expect(engine.next()).toMatchObject({ type: "say", text: "你好，旅人。" });
    expect(engine.next()).toMatchObject({ type: "say", text: "先学会输出，再谈改变世界。" });
    expect(engine.next()).toMatchObject({
      type: "choose",
      options: [{ text: "代码", label: "codePath" }, { text: "终端", label: "termPath" }],
    });
    expect(engine.jump("codePath")).toBe(true);
    expect(engine.next()).toMatchObject({ type: "code", challengeId: "ch01", lang: "javascript", onPass: "pass1" });

    // 未通过时门控台词被跳过，直接跳到 done
    expect(engine.next().type).toBe("jump");
    engine.setVar("pass1", true);
    engine.jump("codePath");
    engine.next(); // 再次弹出 code 事件
    expect(engine.next()).toMatchObject({ type: "say", text: "漂亮！" });
  });
});

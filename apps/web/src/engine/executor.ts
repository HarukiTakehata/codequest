import type { Lang } from "@codequest/judge";
import { parseOptions, type Sentence } from "./parser";

export interface StoryState {
  pointer: number;
  vars: Record<string, unknown>;
  scene: string;
}

export type StoryEvent =
  | { type: "say"; speaker: string; text: string }
  | { type: "bg"; name: string }
  | { type: "figure"; name: string }
  | { type: "bgm"; name: string }
  | { type: "title"; text: string }
  | { type: "choose"; prompt: string; options: { text: string; label: string }[] }
  | { type: "code"; challengeId: string; lang: Lang; onPass?: string }
  | { type: "term"; challengeId: string; preset?: string; unlock?: string; mode: "script" | "explore" }
  | { type: "token"; expected: string; onPass?: string }
  | { type: "hint"; file: string }
  | { type: "jump"; label: string }
  | { type: "end" };

function value(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/** WebGAL `-when` 条件：var==值 / var!=值 / var（真值）。 */
export function conditionHolds(when: string | undefined, vars: Record<string, unknown>): boolean {
  if (!when) return true;
  const match = when.match(/^([\w]+)\s*(==|!=|=!|=)\s*(.+)$/);
  if (!match) return Boolean(vars[when]);
  const [, name, op, expected] = match;
  const actual = vars[name!];
  const want = value(expected!.trim());
  if (op === "==" || op === "=") return actual === want || String(actual) === String(want);
  if (op === "!=" || op === "=!") return !(actual === want || String(actual) === String(want));
  return Boolean(actual);
}

/**
 * 逐条演出引擎：blocking 事件（choose/code/term/token）由 UI  resolves 后再继续。
 * 挑战/令牌通过后写变量，后续带 `-when=pass1==true` 的语句才放行——变量门控（R5）。
 */
export class StoryEngine {
  state: StoryState;
  private labels = new Map<string, number>();

  constructor(readonly sentences: Sentence[], initial?: Partial<StoryState>) {
    sentences.forEach((s, i) => { if (s.command === "label") this.labels.set(s.content, i); });
    this.state = {
      pointer: initial?.pointer ?? 0,
      vars: { ...(initial?.vars ?? {}) },
      scene: initial?.scene ?? "start.txt",
    };
  }

  setVar(name: string, raw: unknown): void {
    this.state.vars[name] = typeof raw === "string" ? value(raw) : raw;
  }

  jump(label: string): boolean {
    const target = this.labels.get(label);
    if (target === undefined) return false;
    this.state.pointer = target;
    return true;
  }

  /** 取出下一条可执行语句（跳过不满足 -when 的语句），并推进指针。 */
  next(): StoryEvent {
    while (this.state.pointer < this.sentences.length) {
      const sentence = this.sentences[this.state.pointer++]!;
      if (!conditionHolds(sentence.args.when, this.state.vars)) continue;
      const event = this.toEvent(sentence);
      if (event) return event;
    }
    return { type: "end" };
  }

  private toEvent(sentence: Sentence): StoryEvent | null {
    const { command, content, args } = sentence;
    switch (command) {
      case "say": {
        const marker = content.includes("::") ? "::" : content.includes(":") ? ":" : null;
        const speaker = marker ? content.slice(0, content.indexOf(marker)) : "";
        const text = marker ? content.slice(content.indexOf(marker) + marker.length) : content;
        return { type: "say", speaker, text };
      }
      case "changeBg": return { type: "bg", name: content };
      case "changeFigure": return { type: "figure", name: content };
      case "bgm": return { type: "bgm", name: content };
      case "title": return { type: "title", text: content };
      case "label": return null;
      case "setVar": {
        const [name, ...rest] = content.split("=");
        if (name) this.setVar(name, rest.join("="));
        return null;
      }
      case "choose":
        return { type: "choose", prompt: content, options: parseOptions(args.options ?? "") };
      case "jump": return { type: "jump", label: content };
      case "changeScene": return { type: "jump", label: args.label ?? content };
      case "code":
        return { type: "code", challengeId: content, lang: (args.lang ?? "javascript") as Lang, onPass: args.onPass };
      case "term":
        return {
          type: "term", challengeId: content, preset: args.preset, unlock: args.unlock,
          mode: args.mode === "explore" ? "explore" : "script",
        };
      case "token": return { type: "token", expected: content, onPass: args.onPass };
      case "hint": return { type: "hint", file: content };
      case "end": return { type: "end" };
      default: return { type: "say", speaker: "", text: content };
    }
  }
}

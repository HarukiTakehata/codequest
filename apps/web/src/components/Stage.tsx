import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { parseScript } from "../engine/parser";
import { StoryEngine, type StoryEvent } from "../engine/executor";
import { api, type CoursePack, type Progress } from "../api";
import type { Challenge, JudgeConfig } from "../types";
import { Workbench } from "./Workbench";
import { TerminalWorkbench } from "./TerminalWorkbench";

interface Props {
  courseId: string;
  pack: CoursePack;
  progress: Progress;
  onBack: () => void;
}

interface ActiveChallenge {
  event: Extract<StoryEvent, { type: "code" | "term" }>;
  challenge: Challenge;
  judge: JudgeConfig | null;
}

export function Stage({ courseId, pack, progress, onBack }: Props) {
  const meta = JSON.parse(pack["course.json"] ?? "{}") as { entry?: string };
  const engine = useRef(new StoryEngine(parseScript(pack[meta.entry ?? "start.txt"] ?? ""), {
    pointer: Number(progress.pointer ?? 0),
    vars: (progress.vars ?? {}) as Record<string, unknown>,
  }));
  const [event, setEvent] = useState<StoryEvent>(() => engine.current.next());
  const [active, setActive] = useState<ActiveChallenge | null>(null);
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [state, setState] = useState({
    bg: "main", figure: "mentor", bgm: "theme",
    challenges: { ...((progress.challenges ?? {}) as Record<string, unknown>) },
    hints: [...((progress.hints ?? []) as string[])],
  });
  const saved = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((extra: Record<string, unknown> = {}) => {
    const payload: Progress = {
      pointer: engine.current.state.pointer,
      vars: engine.current.state.vars,
      scene: engine.current.state.scene,
      ...state,
      ...extra,
    };
    setState((prev) => ({ ...prev, ...extra }));
    if (saved.current) clearTimeout(saved.current);
    saved.current = setTimeout(() => { void api.saveProgress(courseId, payload).catch(() => undefined); }, 250);
  }, [courseId, state]);

  const advance = useCallback(() => {
    setEvent(engine.current.next());
    save();
  }, [save]);

  useEffect(() => {
    if (event.type === "hint") {
      setHint(pack[event.file] ?? "本题暂无提示文件。");
      advance();
    }
    if (["bg", "figure", "bgm", "jump"].includes(event.type)) {
      const timer = setTimeout(advance, 320);
      return () => clearTimeout(timer);
    }
  }, [event, advance, pack]);

  const openChallenge = (challengeEvent: Extract<StoryEvent, { type: "code" | "term" }>) => {
    const challenge = JSON.parse(pack[`challenges/${challengeEvent.challengeId}.json`] ?? "null") as Challenge | null;
    if (!challenge) { advance(); return; }
    let judge: JudgeConfig | null = null;
    if (challenge.judge) {
      judge = JSON.parse(pack[`judges/${challenge.judge}.json`] ?? "null") as JudgeConfig | null;
    }
    setActive({ event: challengeEvent, challenge, judge });
  };

  useEffect(() => {
    if (event.type === "code" || event.type === "term") openChallenge(event);
    // openChallenge 仅依赖当前 pack/event，事件变化时才重新打开工作台。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const onPass = (payload: { score: number; code: string; files: Record<string, string> }) => {
    if (!active) return;
    const { score, code } = payload;
    const key = active.event.type === "code" ? active.event.onPass : active.event.unlock;
    if (key) engine.current.setVar(key, true);
    save({ challenges: { ...state.challenges, [active.challenge.id]: { passed: true, score, code } } });
    setActive(null);
    advance();
  };

  const submitToken = () => {
    if (event.type !== "token") return;
    if (token.trim() !== event.expected) { setTokenError("令牌不正确，再找找看。"); return; }
    if (event.onPass) engine.current.setVar(event.onPass, true);
    setTokenError("");
    save();
    advance();
  };

  const bg = state.bg === "main"
    ? "linear-gradient(180deg, #0b1026 0%, #1b2450 60%, #2d1b4e 100%)"
    : state.bg;
  const mentor = pack["assets/mentor.svg"]
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pack["assets/mentor.svg"])}`
    : "";
  return (
    <div className="stage" style={{ backgroundImage: bg }}>
      <div className="stage-top">
        <button className="ghost" onClick={onBack}><ArrowLeft size={15} /> 课程列表</button>
        <span className="stage-progress">剧情节点 {engine.current.state.pointer}</span>
      </div>
      <div className="stage-figure">
        {mentor && state.figure !== "none" && <img src={mentor} alt="导师立绘" />}
      </div>
      <div className="dialogue" onClick={() => event.type === "say" && advance()}>
        {event.type === "say" && (
          <>
            <div className="speaker">{event.speaker || "旁白"}</div>
            <div className="text">{event.text}</div>
            <div className="continue">点击继续 <ChevronDown size={13} /></div>
          </>
        )}
        {event.type === "title" && <div className="title-card">{event.text}</div>}
        {event.type === "choose" && (
          <>
            <div className="text">{event.prompt}</div>
            <div className="choices">
              {event.options.map((option) => (
                <button key={option.label} onClick={() => { engine.current.jump(option.label); advance(); }}>
                  {option.text}
                </button>
              ))}
            </div>
          </>
        )}
        {event.type === "code" || event.type === "term" ? (
          <div className="text">（工作台已弹出）</div>
        ) : null}
        {event.type === "token" && (
          <div className="token-gate">
            <div className="text">输入你找到的令牌：</div>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="CQ{...}" />
            <button className="primary" onClick={submitToken}>提交令牌</button>
            {tokenError && <p className="bad">{tokenError}</p>}
          </div>
        )}
        {event.type === "hint" && <div className="text">（提示面板已打开）</div>}
        {event.type === "end" && (
          <div className="ending">
            <h2>第一章 完成</h2>
            <p>你已经走完了演示剧情，所有四门语言的挑战都在等着你。</p>
            <button className="primary" onClick={onBack}>返回课程列表</button>
          </div>
        )}
      </div>

      {active && (
        active.event.type === "term" && active.challenge.termMode === "explore" ? (
          <TerminalWorkbench challenge={active.challenge} onClose={() => setActive(null)} />
        ) : (
          <Workbench
            challenge={active.challenge}
            judgeConfig={active.judge}
            onPass={onPass}
            onClose={() => { setActive(null); advance(); }}
          />
        )
      )}
      {hint && (
        <div className="modal" onClick={() => setHint(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>提示</h3><pre>{hint}</pre>
            <button onClick={() => setHint(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

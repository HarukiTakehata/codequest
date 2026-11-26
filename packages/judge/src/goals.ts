import type { Goal, GoalContext, GoalStatus } from "./types";

function sourceCheck(pattern: string, flags: string | undefined, source: string, negate: boolean): boolean {
  let matched = false;
  try {
    matched = new RegExp(pattern, flags).test(source);
  } catch {
    matched = false;
  }
  return negate ? !matched : matched;
}

/**
 * 过程性目标求值：source 类即时、output/exit-code 复用最近一次 Run、
 * testcase 类由判题结果驱动、file/command 类复用 shell 会话回传的 files/输出（设计 §6.2）。
 */
export function evaluateGoals(goals: Goal[], context: GoalContext): GoalStatus[] {
  return goals.map((goal) => {
    let done = false;
    const check = goal.check;
    switch (check.kind) {
      case "source-regex":
        done = sourceCheck(check.pattern, check.flags, context.source, false);
        break;
      case "source-not-regex":
        done = sourceCheck(check.pattern, check.flags, context.source, true);
        break;
      case "output-contains":
        done = Boolean(context.lastRun?.stdout.includes(check.value));
        break;
      case "output-regex": {
        try {
          done = new RegExp(check.pattern, check.flags).test(context.lastRun?.stdout ?? "");
        } catch {
          done = false;
        }
        break;
      }
      case "exit-code":
        done = context.lastRun?.exitCode === check.value;
        break;
      case "file-exists":
        done = context.runtimeGoalResults?.[goal.id] ?? Object.prototype.hasOwnProperty.call(context.files, check.path);
        break;
      case "command-stdout": {
        const output = context.files[`__command__${check.command}`];
        done = context.runtimeGoalResults?.[goal.id] ?? output === check.expect;
        break;
      }
      case "testcase":
        if (check.id) {
          done = context.testResults.some((r) => r.id === check.id && r.passed);
        } else {
          done = context.testResults.length > 0 &&
            (check.all ? context.testResults.every((r) => r.passed) : context.testResults.some((r) => r.passed));
        }
        break;
    }
    return {
      id: goal.id,
      text: goal.text,
      hint: goal.hint,
      hidden: goal.hidden,
      done,
    };
  });
}

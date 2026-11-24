/**
 * WebGAL 兼容子集的剧本解析器（设计 §4.2 / §4.2 MVP 折中）：
 *   command:content -arg=value -flag;注释
 *   `说话人:台词` 自动糖衣为 say；choose/setVar/changeScene/label 与扩展指令 code/term/token/hint。
 * 纯函数，不依赖浏览器 API。
 */
export interface Sentence {
  command: string;
  content: string;
  args: Record<string, string>;
  /** 原始行号，便于报错定位。 */
  line: number;
}

const COMMANDS = new Set([
  "say", "choose", "choice", "label", "jump", "changeScene", "changeBg",
  "changeFigure", "bgm", "setVar", "code", "term", "token", "hint", "end", "title",
]);

function parseArgs(text: string): Record<string, string> {
  const args: Record<string, string> = {};
  const pattern = /(?:^|\s)-([A-Za-z][\w-]*)(?:=("[^"]*"|[^\s]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const key = match[1]!;
    let value = match[2] ?? "true";
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    args[key] = value;
  }
  return args;
}

export function parseScript(script: string): Sentence[] {
  const sentences: Sentence[] = [];
  const chunks = script.replace(/\r\n?/g, "\n").split(";");
  let line = 1;
  for (const chunk of chunks) {
    const raw = chunk.trim();
    if (!raw) { line += (chunk.match(/\n/g) ?? []).length; continue; }
    const statement = raw.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
    if (!statement || statement.startsWith("//") || statement.startsWith("#")) {
      line += (chunk.match(/\n/g) ?? []).length;
      continue;
    }
    const colon = statement.indexOf(":");
    let command: string;
    let content: string;
    if (colon < 0) {
      command = statement.includes("=") ? "setVar" : "say";
      content = statement;
    } else {
      const head = statement.slice(0, colon).trim();
      command = COMMANDS.has(head) ? head : "say";
      content = statement.slice(colon + 1).trim();
    }
    if (command === "say" && colon >= 0 && !COMMANDS.has(statement.slice(0, colon).trim())) {
      content = `${statement.slice(0, colon).trim()}::${content}`;
    }
    const args = parseArgs(content);
    const body = content.replace(/(?:^|\s)-[A-Za-z][\w-]*(?:=(?:"[^"]*"|[^\s]+))?/g, "").trim();
    sentences.push({ command, content: body, args, line });
    line += (chunk.match(/\n/g) ?? []).length;
  }
  return sentences;
}

export function parseOptions(spec: string): { text: string; label: string }[] {
  if (!spec) return [];
  return spec.split("|").map((pair) => {
    const [text, label] = pair.split("=");
    return { text: text ?? pair, label: label ?? text ?? pair };
  });
}

#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { LANGUAGES, printLanguageList, resolveLanguage } from "./containers/config.mjs";
import { buildLanguageContainer, parseBuildFlags } from "./containers/common.mjs";

function printHelp() {
  console.log(`用法:
  node scripts/build-language-container.mjs list
  node scripts/build-language-container.mjs <shell|cpp|java|python|javascript|all> [--test] [--no-test] [--no-cache] [--tag <image>]
  node scripts/build-language-container.mjs                 # 交互选择（TTY）

示例:
  node scripts/build-language-container.mjs java --test
  node scripts/build-language-container.mjs all --test
  node scripts/containers/build-python.mjs --no-cache`);
}

async function chooseLanguage() {
  printLanguageList();
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("选择语言编号或 ID（all 构建全部）: ")).trim();
    if (!answer) throw new Error("未选择语言");
    if (/^\d+$/.test(answer)) {
      const language = LANGUAGES[Number(answer) - 1];
      if (!language) throw new Error(`编号超出范围: ${answer}`);
      return language.id;
    }
    if (answer.toLowerCase() === "all") return "all";
    return resolveLanguage(answer).id;
  } finally {
    rl.close();
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const positional = [];
const buildFlags = [];
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === "--tag") {
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error("--tag 缺少镜像名");
    buildFlags.push(arg, value);
  } else if (arg.startsWith("--")) {
    buildFlags.push(arg);
  } else {
    positional.push(arg);
  }
}

try {
  if (positional[0] === "list") {
    if (positional.length > 1) throw new Error("list 不接受其他参数");
    printLanguageList();
    process.exit(0);
  }
  if (positional.length > 1) throw new Error(`参数过多: ${positional.slice(1).join(" ")}`);

  const options = parseBuildFlags(buildFlags);
  let selected = positional[0];
  if (!selected) {
    if (!process.stdin.isTTY) {
      printHelp();
      throw new Error("非交互环境请显式指定语言或 all");
    }
    selected = await chooseLanguage();
  }
  if (selected === "all") {
    for (const language of LANGUAGES) await buildLanguageContainer(language.id, options);
  } else {
    await buildLanguageContainer(selected, options);
  }
} catch (error) {
  console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

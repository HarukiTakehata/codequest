#!/usr/bin/env node
import { LANGUAGES, resolveLanguage } from "./containers/config.mjs";
import { testLanguageContainer } from "./containers/common.mjs";

const selected = process.argv.slice(2);
if (selected.includes("--help") || selected.includes("-h")) {
  console.log("用法: node scripts/test-language-containers.mjs [shell|cpp|java|python|javascript|all]");
  process.exit(0);
}
const languages = !selected.length || selected[0] === "all"
  ? LANGUAGES
  : [resolveLanguage(selected[0])];

let failed = 0;
for (const language of languages) {
  try {
    testLanguageContainer(language.id);
  } catch (error) {
    failed++;
    console.error(`FAIL ${language.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${languages.length - failed}/${languages.length} language containers passed`);
process.exit(failed ? 1 : 0);

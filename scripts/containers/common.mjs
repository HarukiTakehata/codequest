import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALPINE_IMAGE, ALPINE_MIRROR_IMAGE, resolveLanguage } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`);
  return result;
}

function imageExists(image) {
  const result = spawnSync("podman", ["image", "inspect", image], { stdio: "ignore" });
  return result.status === 0;
}

export function ensureAlpineImage() {
  if (imageExists(ALPINE_IMAGE)) return;
  run("podman", ["pull", ALPINE_MIRROR_IMAGE]);
  run("podman", ["tag", ALPINE_MIRROR_IMAGE, ALPINE_IMAGE]);
}

export function buildLanguageContainer(input, options = {}) {
  const language = resolveLanguage(input);
  ensureAlpineImage();
  const tag = options.tag || language.image;
  const args = ["build", "--platform", "linux/amd64", "-t", tag, "-f", resolve(here, `Containerfile.${language.id}`), here];
  if (options.noCache) args.push("--no-cache");
  run("podman", args);
  console.log(`构建完成: ${language.name} -> ${tag}`);
  if (options.test !== false) testLanguageContainer(language.id, tag);
  return language;
}

export function testLanguageContainer(input, imageTag) {
  const language = resolveLanguage(input);
  const image = imageTag || language.image;
  console.log(`冒烟测试: ${language.name} (${image})`);
  const result = spawnSync("podman", [
    "run", "--rm", "--network", "none",
    "--entrypoint", "/bin/sh", image, "-c", `command -v git && command -v vim && command -v nano && ${language.smoke}`,
  ], { encoding: "utf8", timeout: 180_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || !output.includes(language.expect)) {
    console.error(output.slice(-2000));
    throw new Error(`${language.name} 冒烟测试失败 (exit ${result.status ?? "timeout"})`);
  }
  console.log(`PASS ${language.id}: ${language.expect}`);
  return output;
}

export function parseBuildFlags(argv) {
  const options = { test: true, noCache: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--test") options.test = true;
    else if (flag === "--no-test") options.test = false;
    else if (flag === "--no-cache") options.noCache = true;
    else if (flag === "--tag") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--tag 缺少镜像名");
      options.tag = value;
    } else throw new Error(`未知参数: ${flag}`);
  }
  return options;
}

export function runBuildCli(defaultLanguage, argv = process.argv.slice(2)) {
  const options = parseBuildFlags(argv);
  buildLanguageContainer(defaultLanguage, options);
}

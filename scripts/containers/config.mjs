export const ALPINE_IMAGE = "docker.io/library/alpine:3.22";
export const ALPINE_MIRROR_IMAGE = "docker.1ms.run/library/alpine:3.22";
export const APK_MIRROR = "https://mirrors.tuna.tsinghua.edu.cn/alpine";

export const LANGUAGES = [
  {
    id: "shell",
    name: "Shell",
    image: "cq-dev-shell:cn",
    memoryMb: 128,
    packages: ["bash", "coreutils", "findutils", "grep", "sed", "git", "vim", "nano", "procps", "iproute2"],
    command: ["/bin/bash"],
    smoke: "command -v bash && command -v sort && command -v find && command -v ps && command -v ss && command -v ip && bash -c 'printf \"CQ_SHELL_OK\\n\"'",
    expect: "CQ_SHELL_OK",
  },
  {
    id: "cpp",
    name: "C/C++",
    image: "cq-dev-cpp:cn",
    memoryMb: 256,
    packages: ["build-base", "cmake", "gdb", "git", "vim", "nano"],
    command: ["/bin/sh"],
    smoke: `cat >/tmp/main.cpp <<'EOF'
#include <iostream>
int main() { std::cout << "CQ_CPP_OK\\n"; }
EOF
g++ -std=c++17 /tmp/main.cpp -o /tmp/main && /tmp/main`,
    expect: "CQ_CPP_OK",
  },
  {
    id: "java",
    name: "Java",
    image: "cq-dev-java:cn",
    memoryMb: 512,
    packages: ["openjdk21-jdk", "git", "vim", "nano"],
    command: ["/bin/sh"],
    smoke: `cat >/tmp/Main.java <<'EOF'
public class Main { public static void main(String[] args) { System.out.println("CQ_JAVA_OK"); } }
EOF
javac /tmp/Main.java && java -cp /tmp Main`,
    expect: "CQ_JAVA_OK",
  },
  {
    id: "python",
    name: "Python",
    image: "cq-dev-python:cn",
    memoryMb: 256,
    packages: ["python3", "py3-pip", "python3-dev", "build-base", "git", "vim", "nano"],
    command: ["/bin/sh"],
    smoke: "python3 -c 'print(\"CQ_PYTHON_OK\")' && python3 -m pip --version",
    expect: "CQ_PYTHON_OK",
  },
  {
    id: "javascript",
    name: "JavaScript",
    image: "cq-dev-javascript:cn",
    memoryMb: 256,
    packages: ["nodejs", "npm", "git", "vim", "nano"],
    command: ["/bin/sh"],
    smoke: "node -e 'console.log(\"CQ_JS_OK\")' && npm --version",
    expect: "CQ_JS_OK",
  },
];

const aliases = new Map([
  ["sh", "shell"],
  ["c", "cpp"],
  ["c++", "cpp"],
  ["c-cpp", "cpp"],
  ["gcc", "cpp"],
  ["g++", "cpp"],
  ["jd", "java"],
  ["openjdk", "java"],
  ["py", "python"],
  ["js", "javascript"],
  ["node", "javascript"],
  ["nodejs", "javascript"],
]);

export function resolveLanguage(input) {
  const key = String(input ?? "").trim().toLowerCase();
  const id = aliases.get(key) ?? key;
  const language = LANGUAGES.find((item) => item.id === id);
  if (!language) throw new Error(`未知语言: ${input}；可选: ${LANGUAGES.map((item) => item.id).join(", ")}, all`);
  return language;
}

export function printLanguageList() {
  console.log("可用语言开发环境：");
  for (const [index, language] of LANGUAGES.entries()) {
    console.log(`  ${index + 1}. ${language.id.padEnd(10)} ${language.name.padEnd(10)} ${language.image}`);
    console.log(`     ${language.packages.join(", ")} · guest ${language.memoryMb} MiB`);
  }
}

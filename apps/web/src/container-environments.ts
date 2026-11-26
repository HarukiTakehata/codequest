export interface ContainerEnvironment {
  id: "shell" | "cpp" | "java" | "python" | "javascript";
  name: string;
  image: string;
  bytes: number;
  sha256?: string;
}

export const DEFAULT_CONTAINER_ENVIRONMENTS: ContainerEnvironment[] = [
  { id: "shell", name: "Shell", image: "cq-dev-shell:cn", bytes: 0 },
  { id: "cpp", name: "C/C++", image: "cq-dev-cpp:cn", bytes: 0 },
  { id: "java", name: "Java", image: "cq-dev-java:cn", bytes: 0 },
  { id: "python", name: "Python", image: "cq-dev-python:cn", bytes: 0 },
  { id: "javascript", name: "JavaScript", image: "cq-dev-javascript:cn", bytes: 0 },
];

import {
  GAME_API_DESCRIPTION,
  GAME_API_IMPL,
  globalNames,
  hostFromApi,
  missingImplementations,
  type ApiDescription,
  type ApiImpl,
  type HandleDesc,
  type Host,
  type MemberDesc,
  type ScriptWorld,
} from "@rpgjs/script/core";

/** Extension data understood by this package; RPGJS itself is not forked. */
export interface CourseMemberDesc extends MemberDesc {
  /** Name of an internal handle returned when this member is read. */
  handle?: string;
}

export interface CourseHandleDesc extends Omit<HandleDesc, "members"> {
  /** Internal handles are reachable through a parent member, never as globals. */
  nested?: boolean;
  members?: Record<string, CourseMemberDesc>;
}

export interface CourseApiDescription extends Omit<ApiDescription, "handles"> {
  handles: Record<string, CourseHandleDesc>;
}

/**
 * Pinned @rpgjs/script@5.3.0 server route whitelist:
 * dist/server/index.js ROUTE_STEPS + ROUTE_PLAYER_STEPS. `wait` is excluded:
 * it is a delay, not a movement direction, and has a different 0..60 rule.
 */
export const ROUTE_STEPS = [
  "up",
  "down",
  "left",
  "right",
  "random",
  "tileUp",
  "tileDown",
  "tileLeft",
  "tileRight",
  "tileRandom",
  "turnUp",
  "turnDown",
  "turnLeft",
  "turnRight",
  "turnRandom",
  "towardPlayer",
  "awayFromPlayer",
  "tileTowardPlayer",
  "tileAwayFromPlayer",
  "turnTowardPlayer",
  "turnAwayFromPlayer",
] as const;

export type RouteStep = (typeof ROUTE_STEPS)[number];
export const MAX_MOVE_TIMES = 100;

const NESTED_GAME_PLAYER = Object.freeze({}) as object;

export const COURSE_API_DESCRIPTION: CourseApiDescription = {
  handles: {
    ...GAME_API_DESCRIPTION.handles,
    game: {
      doc: "课程游戏门面；只暴露本课程声明的能力",
      members: {
        player: {
          type: "CoursePlayerHandle",
          doc: "课程玩家句柄",
          handle: "gamePlayer",
        },
      },
    },
    gamePlayer: {
      nested: true,
      doc: "game.player 的内部实现句柄；不是脚本全局名",
      methods: {
        move: {
          sig: "(way: string, times: number): void",
          doc: `朝 way 移动 times 步。way 可选：${ROUTE_STEPS.join("、")}；times 是 1..${MAX_MOVE_TIMES} 的整数。`,
        },
      },
    },
  },
  functions: { ...GAME_API_DESCRIPTION.functions },
  families: [
    ...(GAME_API_DESCRIPTION.families ?? []),
    {
      name: "课程 API",
      doc: "CodeQuest 课程门面；内部实现句柄不会成为脚本全局名",
      names: ["game"],
      example: 'game.player.move("up", 4);',
    },
  ],
  signals: { ...GAME_API_DESCRIPTION.signals },
};

export const COURSE_API_IMPL: ApiImpl<ScriptWorld> = {
  handles: {
    ...GAME_API_IMPL.handles,
    game: {
      members: {
        player: { read: () => NESTED_GAME_PLAYER },
      },
    },
    gamePlayer: {
      methods: {
        move: async (world, args) => {
          if (args.length !== 2) {
            throw new Error(`game.player.move() takes 2 arguments, got ${args.length}`);
          }
          const [way, times] = args;
          if (typeof way !== "string" || !ROUTE_STEPS.includes(way as RouteStep)) {
            throw new Error(`bad way: ${String(way)}`);
          }
          if (
            typeof times !== "number" ||
            !Number.isInteger(times) ||
            times < 1 ||
            times > MAX_MOVE_TIMES
          ) {
            throw new Error(`bad times: ${String(times)}`);
          }
          await world.engine.call("player.moveRoutes", [[{ [way]: times }]]);
        },
      },
    },
  },
  functions: { ...GAME_API_IMPL.functions },
};

/** Names the compiler may resolve. Nested implementation handles stay private. */
export function courseGlobalNames(description: CourseApiDescription = COURSE_API_DESCRIPTION): string[] {
  const publicDescription: ApiDescription = {
    ...description,
    handles: Object.fromEntries(
      Object.entries(description.handles).filter(([, handle]) => !handle.nested),
    ),
  };
  return globalNames(publicDescription);
}

/**
 * hostFromApi supplies the real handle/method dispatch. This wrapper only maps
 * the private nested marker to that host's internal handle and removes the
 * internal handle from globals.
 */
export function hostFromCourseApi<W extends ScriptWorld>(
  description: CourseApiDescription,
  implementation: ApiImpl<W>,
  world: W,
): Host {
  const base = hostFromApi(description, implementation, world);
  const nestedGamePlayer = base.globals.gamePlayer;
  if (!nestedGamePlayer) throw new Error("course API is missing its internal gamePlayer handle");
  const globals = { ...base.globals };
  delete globals.gamePlayer;

  return {
    ...base,
    globals,
    isHandle: (value) => value === NESTED_GAME_PLAYER || base.isHandle(value),
    read: (object, key) => base.read(object === NESTED_GAME_PLAYER ? nestedGamePlayer : object, key),
    write: (object, key, op, value) =>
      base.write(object === NESTED_GAME_PLAYER ? nestedGamePlayer : object, key, op, value),
    callMethod: (object, key, args) =>
      base.callMethod(object === NESTED_GAME_PLAYER ? nestedGamePlayer : object, key, args),
  };
}

/** Validate parent-member -> nested-handle links in addition to upstream parity. */
export function missingNestedImplementations<W>(
  description: CourseApiDescription,
  implementation: ApiImpl<W>,
): string[] {
  const problems: string[] = [];
  const referenced = new Set<string>();

  for (const [parentName, parent] of Object.entries(description.handles)) {
    for (const [memberName, member] of Object.entries(parent.members ?? {})) {
      if (!member.handle) continue;
      referenced.add(member.handle);
      const target = description.handles[member.handle];
      if (!target) {
        problems.push(`${parentName}.${memberName} references missing handle ${member.handle}`);
        continue;
      }
      if (!target.nested) {
        problems.push(`${parentName}.${memberName} references public handle ${member.handle} as nested`);
      }
      if (!implementation.handles[parentName]?.members?.[memberName]?.read) {
        problems.push(`${parentName}.${memberName} has no nested-handle read implementation`);
      }
      if (!implementation.handles[member.handle]) {
        problems.push(`nested handle ${member.handle} is not implemented`);
      }
    }
  }

  for (const [name, handle] of Object.entries(description.handles)) {
    if (!handle.nested) continue;
    if (!referenced.has(name)) {
      problems.push(`nested handle ${name} is not reachable from a public member`);
    }
    const implemented = implementation.handles[name];
    if (!implemented) continue;
    for (const method of Object.keys(handle.methods ?? {})) {
      if (!implemented.methods?.[method]) problems.push(`nested handle ${name}.${method}() is not implemented`);
    }
    for (const method of Object.keys(implemented.methods ?? {})) {
      if (!handle.methods?.[method]) problems.push(`nested handle ${name}.${method}() is implemented but not described`);
    }
    for (const [member, desc] of Object.entries(handle.members ?? {})) {
      const actual = implemented.members?.[member];
      if (!actual?.read) problems.push(`nested handle ${name}.${member} has no read`);
      if (desc.writable && !actual?.write) problems.push(`nested handle ${name}.${member} is writable but has no write`);
      if (!desc.writable && actual?.write) problems.push(`nested handle ${name}.${member} has a write but is not writable`);
    }
    for (const member of Object.keys(implemented.members ?? {})) {
      if (!handle.members?.[member]) problems.push(`nested handle ${name}.${member} is implemented but not described`);
    }
  }

  return [...new Set(problems)];
}

export function missingCourseImplementations<W>(
  description: CourseApiDescription = COURSE_API_DESCRIPTION,
  implementation: ApiImpl<W> = COURSE_API_IMPL as ApiImpl<W>,
): string[] {
  return [...new Set([
    ...missingImplementations(description, implementation),
    ...missingNestedImplementations(description, implementation),
  ])];
}

export function assertCourseApiParity(): void {
  const problems = missingCourseImplementations();
  if (problems.length) throw new Error(`course API parity failed: ${problems.join("; ")}`);
}

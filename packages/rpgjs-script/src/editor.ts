import { describeApi } from "@rpgjs/script/core";
import {
  COURSE_API_DESCRIPTION,
  type CourseApiDescription,
  type CourseHandleDesc,
} from "./api";

function nestedHandleType(handle: CourseHandleDesc, description: CourseApiDescription, stack: string[]): string {
  const parts = ["{"];
  for (const [name, member] of Object.entries(handle.members ?? {})) {
    let type = member.type;
    if (member.handle) {
      const target = handleTarget(member.handle, description, stack);
      type = nestedHandleType(target, description, [...stack, member.handle]);
    }
    parts.push(`readonly ${name}: ${type};`);
  }
  for (const [name, method] of Object.entries(handle.methods ?? {})) {
    parts.push(`${name}${method.sig};`);
  }
  if (handle.dynamic) {
    parts.push(`${handle.dynamic.writable ? "" : "readonly "}[${handle.dynamic.keyDoc}]: ${handle.dynamic.type};`);
  }
  parts.push("}");
  return parts.join(" ");
}

function handleTarget(name: string, description: CourseApiDescription, stack: string[]): CourseHandleDesc {
  const target = description.handles[name];
  if (!target) throw new Error(`nested API handle ${name} is not described`);
  if (stack.includes(name)) throw new Error(`nested API handle cycle: ${[...stack, name].join(" -> ")}`);
  return target;
}

/**
 * Upstream describeApi() knows only flat handles. Inline our nested handle
 * types into their public parent and omit internal globals so Monaco sees
 * exactly `game.player.move(...)`, never `gamePlayer`.
 */
export function describeCourseApi(description: CourseApiDescription = COURSE_API_DESCRIPTION): string {
  const handles: CourseApiDescription["handles"] = {};
  for (const [name, handle] of Object.entries(description.handles)) {
    if (handle.nested) continue;
    const members = Object.fromEntries(
      Object.entries(handle.members ?? {}).map(([memberName, member]) => {
        if (!member.handle) return [memberName, member];
        const target = description.handles[member.handle];
        if (!target?.nested) {
          throw new Error(`${name}.${memberName} must reference a nested handle`);
        }
        return [memberName, {
          ...member,
          type: nestedHandleType(target, description, [member.handle]),
        }];
      }),
    );
    handles[name] = { ...handle, members };
  }
  return describeApi({ ...description, handles });
}

export const COURSE_API_DECLARATIONS = describeCourseApi();

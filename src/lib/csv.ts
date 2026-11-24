export interface RosterRow {
  email: string;
  display_name: string;
  password?: string;
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** CSV 名单：email,display_name[,初始密码]；首行可为表头。 */
export function parseRoster(text: string): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cells = splitLine(line);
    const email = (cells[0] ?? "").toLowerCase();
    if (!EMAIL.test(email)) continue;
    if (email === "email") continue;
    rows.push({
      email,
      display_name: cells[1] || email.split("@")[0]!,
      password: cells[2] || undefined,
    });
  }
  return rows;
}

export function rosterToCsv(rows: { email: string; display_name: string; password: string }[]): string {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return ["email,display_name,password", ...rows.map((r) =>
    [r.email, r.display_name, r.password].map(escape).join(","))].join("\n") + "\n";
}

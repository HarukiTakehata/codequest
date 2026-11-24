import { HttpError } from "./http-error";
import { normalizeEmail, normalizeUsername } from "./identity";
import { normalizeDisplayName } from "./user";

export interface RosterRow {
  username: string;
  email: string | null;
  display_name: string;
  password?: string;
  /** 原始 CSV 中的起始物理行号，用于把校验错误定位回上传文件。 */
  line: number;
}

interface CsvRecord {
  cells: string[];
  line: number;
}

const MAX_ROWS = 500;

function invalid(line: number, message: string): never {
  throw new HttpError(400, "INVALID_CSV", `CSV 第 ${line} 行: ${message}`);
}

/** RFC 4180 风格解析：支持 BOM、转义引号、引号内逗号与多行字段。 */
function parseRecords(text: string): CsvRecord[] {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let state: "start" | "unquoted" | "quoted" | "after-quote" | "after-quote-space" = "start";
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const finishField = () => {
    cells.push(field);
    field = "";
    state = "start";
  };
  const finishRecord = () => {
    finishField();
    // 忽略空物理行；带引号的空字段仍是记录，必须参与列数/账号校验。
    if (touched || cells.some((cell) => cell.trim() !== "")) records.push({ cells, line: recordLine });
    cells = [];
    touched = false;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (state === "quoted") {
      if (ch === '"') state = "after-quote";
      else if (ch === "\r" || ch === "\n") {
        field += "\n";
        if (ch === "\r" && source[i + 1] === "\n") i++;
        line++;
      } else field += ch;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      finishRecord();
      line++;
      recordLine = line;
      continue;
    }

    if (state === "after-quote" || state === "after-quote-space") {
      if (ch === '"') {
        if (state === "after-quote-space") invalid(line, "闭引号后的空白不能分隔转义引号");
        field += '"';
        state = "quoted";
      } else if (ch === ",") finishField();
      else if (ch === " " || ch === "\t") {
        // 允许闭引号后的空白，输出时仍按 trim 处理。
        state = "after-quote-space";
      } else invalid(line, "闭引号后只能出现逗号或换行");
      continue;
    }

    if (ch === ",") {
      finishField();
      touched = true;
    } else if (ch === '"') {
      if (state !== "start") invalid(line, "未加引号的字段中不能出现双引号");
      state = "quoted";
      touched = true;
    } else {
      field += ch;
      state = "unquoted";
      if (ch !== " " && ch !== "\t") touched = true;
    }
  }

  if (state === "quoted") invalid(line, "引号字段未闭合");
  if (state !== "start" || field !== "" || cells.length > 0 || touched) finishRecord();
  return records;
}

function isHeader(cells: string[]): boolean {
  return cells[0]?.trim().toLowerCase() === "username";
}

/** CSV 名单：username,email,display_name[,初始密码]；首行可为表头，最多 500 行。 */
export function parseRoster(text: string): RosterRow[] {
  const records = parseRecords(text);
  let emptyLine = 1;
  if (records.length && isHeader(records[0]!.cells)) {
    emptyLine = records[0]!.line;
    const header = records[0]!.cells.map((cell) => cell.trim().toLowerCase());
    if (!((header.length === 3 && header[1] === "email" && header[2] === "display_name") ||
      (header.length === 4 && header[1] === "email" && header[2] === "display_name" && header[3] === "password"))) {
      invalid(records[0]!.line, "表头必须为 username,email,display_name[,password]");
    }
    records.shift();
  }

  const rows: RosterRow[] = [];
  for (const record of records) {
    if (rows.length >= MAX_ROWS) invalid(record.line, "单次最多 500 个账号");
    if (record.cells.length !== 3 && record.cells.length !== 4) {
      invalid(record.line, "每行必须包含 username,email,display_name[,password] 三列或四列");
    }
    let username: string;
    let email: string | null;
    try {
      username = normalizeUsername(record.cells[0] ?? "");
      email = normalizeEmail(record.cells[1] ?? "");
    } catch (error) {
      invalid(record.line, error instanceof Error ? error.message : "账号标识不合法");
    }
    // 无法编码的名单可能把姓名写成 `?????`，此时回退到用户名而不是保留乱码。
    const displayName = normalizeDisplayName(record.cells[2]) ?? username;
    const password = (record.cells[3] ?? "").trim() || undefined;
    rows.push({ username, email, display_name: displayName, ...(password ? { password } : {}), line: record.line });
  }
  if (!rows.length) invalid(records.at(-1)?.line ?? emptyLine, "CSV 中没有账号");
  return rows;
}

export function rosterToCsv(rows: { username: string; email: string | null; display_name: string; password: string }[]): string {
  const escape = (value: string, textCell = false) => {
    // 显示名可能来自外部名单；公式前缀加文本标记，避免 Excel/LibreOffice 执行。
    const safe = textCell && /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // BOM 让中文显示名在常见电子表格软件中按 UTF-8 解码。
  return "\uFEFF" + ["username,email,display_name,password", ...rows.map((r) =>
    [r.username, r.email ?? "", r.display_name, r.password].map((value, index) => escape(value, index === 2)).join(","))].join("\n") + "\n";
}

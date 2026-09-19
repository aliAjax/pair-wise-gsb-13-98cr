import { computed, reactive } from "vue";
import type { ChainConflict, FuelLine, LineCheck, Shift, ShiftType } from "./types";

const STORAGE_KEY = "dfwlfront-7-tank-handoff-v1";

/** 绝对差额阈值（升） */
export const ABS_LIMIT = 50;
/** 相对差额阈值（0.5%） */
export const REL_LIMIT = 0.005;

export const FUELS = ["92#汽油", "95#汽油", "0#柴油"] as const;
export const SHIFT_TYPES: ShiftType[] = ["早班", "中班", "晚班"];
/** 一天之内班次的先后顺序，用于跨班继承 */
const SHIFT_ORDER: Record<ShiftType, number> = { 早班: 0, 中班: 1, 晚班: 2 };

export function emptyLine(fuel: string, opening = 0): FuelLine {
  return { fuel, opening, inflow: 0, sales: 0, measured: null, lossReason: "" };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bookStock(line: Pick<FuelLine, "opening" | "inflow" | "sales">): number {
  return round2(Number(line.opening || 0) + Number(line.inflow || 0) - Number(line.sales || 0));
}

export function checkLine(line: FuelLine): LineCheck {
  const book = bookStock(line);
  const measuredMissing = line.measured === null || line.measured === undefined || Number.isNaN(line.measured);
  const measured = measuredMissing ? null : Number(line.measured);
  const diff = measured === null ? null : round2(measured - book);
  const relDiff = diff === null || book === 0 ? null : Math.abs(diff) / Math.max(Math.abs(book), 1);
  const overLimit = diff !== null && (Math.abs(diff) > ABS_LIMIT || (relDiff !== null && relDiff > REL_LIMIT));
  return {
    fuel: line.fuel,
    opening: Number(line.opening || 0),
    inflow: Number(line.inflow || 0),
    sales: Number(line.sales || 0),
    measured,
    book,
    diff,
    relDiff,
    overLimit,
    bookNegative: book < 0,
    measuredMissing,
    reasonMissing: overLimit && !line.lossReason.trim()
  };
}

/** 交班校验：所有油品都必须实测、账面不能为负、超阈值必须填原因 */
export function validateClose(lines: FuelLine[]): string[] {
  const errors: string[] = [];
  for (const line of lines) {
    const c = checkLine(line);
    if (c.measuredMissing) errors.push(`${line.fuel}：未填写交班实测罐存`);
    if (c.bookNegative) errors.push(`${line.fuel}：账面罐存为 ${c.book} 升，销量超过开班罐存与进油量之和`);
    if (c.reasonMissing) {
      errors.push(
        `${line.fuel}：差额 ${c.diff} 升（相对 ${((c.relDiff ?? 0) * 100).toFixed(2)}%）超过阈值，必须填写损溢原因`
      );
    }
  }
  return errors;
}

/* ---------------- 存储 ---------------- */

interface PersistShape {
  shifts: Shift[];
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function seed(): Shift[] {
  const today = todayStr();
  const mkClosed = (
    shiftType: ShiftType,
    dayOffset: number,
    openings: number[],
    inflows: number[],
    sales: number[],
    measured: (number | null)[]
  ): Shift => {
    const date = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
    const lines = FUELS.map((fuel, i) => ({
      ...emptyLine(fuel, openings[i]),
      inflow: inflows[i],
      sales: sales[i],
      measured: measured[i]
    }));
    const closedAt = new Date(Date.now() + dayOffset * 86400000 + 8 * 3600000).toISOString();
    return {
      id: uid(),
      date,
      shiftType,
      status: "closed",
      lines,
      operator: "王建国",
      note: "账实一致",
      createdAt: closedAt,
      versions: [{ version: 1, lines: structuredClone(lines), operator: "王建国", note: "账实一致", closedAt, reviseReason: "" }]
    };
  };
  const yesterday = mkClosed("晚班", -1, [12000, 9000, 15000], [0, 0, 8000], [3650, 2980, 4100], [8350, 6020, 18900]);
  const early = mkClosed("早班", 0, [8350, 6020, 18900], [10000, 8000, 0], [4120, 3350, 3600], [14210, 10680, 15280]);
  // 当前中班（草稿）：开班继承早班实测值
  const draftLines = FUELS.map((fuel, i) => emptyLine(fuel, [14210, 10680, 15280][i]));
  draftLines[0].inflow = 0;
  draftLines[0].sales = 2980;
  const draft: Shift = {
    id: uid(),
    date: today,
    shiftType: "中班",
    status: "draft",
    lines: draftLines,
    operator: "李晓梅",
    note: "",
    createdAt: new Date().toISOString(),
    versions: []
  };
  return [yesterday, early, draft];
}

function load(): Shift[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const s = seed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ shifts: s } satisfies PersistShape));
      return s;
    }
    const data = JSON.parse(raw) as PersistShape;
    return Array.isArray(data.shifts) ? data.shifts : [];
  } catch {
    return [];
  }
}

const state = reactive<{ shifts: Shift[] }>({ shifts: load() });

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ shifts: state.shifts } satisfies PersistShape));
}

/* ---------------- 班次排序与继承 ---------------- */

/** 按时间先后排序：日期 + 班次序号 */
export function sortedShifts(list: Shift[] = state.shifts): Shift[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return SHIFT_ORDER[a.shiftType] - SHIFT_ORDER[b.shiftType];
  });
}

export function prevShift(shift: Shift): Shift | null {
  const ordered = sortedShifts();
  const idx = ordered.findIndex((s) => s.id === shift.id);
  return idx > 0 ? ordered[idx - 1] : null;
}

/** 沿时间轴向前找到最近一个已交班班次（用于继承与衔接校验，跳过未交班草稿） */
export function prevClosedShift(shift: Shift): Shift | null {
  const ordered = sortedShifts();
  const index = ordered.findIndex((s) => s.id === shift.id);
  for (let i = index - 1; i >= 0; i--) {
    if (ordered[i].status === "closed") return ordered[i];
  }
  return null;
}

/** 某班次当前生效的油品行（修订后以最新冻结版本为准） */
export function effectiveLines(shift: Shift): FuelLine[] {
  if (shift.status === "closed" && shift.versions.length > 0) {
    return shift.versions[shift.versions.length - 1].lines;
  }
  return shift.lines;
}

/**
 * 新建班次时，开班罐存自动继承最近一个已交班班次的交班实测值；
 * 没有任何已交班记录时取最近草稿值，再没有则为 0。
 */
export function inheritedOpenings(): Record<string, number> {
  const ordered = sortedShifts();
  const lastClosed = [...ordered].reverse().find((s) => s.status === "closed");
  const source = lastClosed ?? ordered[ordered.length - 1];
  const result: Record<string, number> = {};
  for (const fuel of FUELS) result[fuel] = 0;
  if (source) {
    for (const line of effectiveLines(source)) {
      result[line.fuel] = line.measured ?? 0;
    }
  }
  return result;
}

/**
 * 跨班衔接冲突：某班开班罐存不等于上一班交班实测罐存。
 * 正常继承不会冲突；对上一班做过修订后，下一班的开班值可能与之不符，此时列出。
 */
export const chainConflicts = computed<ChainConflict[]>(() => {
  const ordered = sortedShifts();
  const conflicts: ChainConflict[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const cur = ordered[i];
    // 开班罐存应承接最近已交班班次；中间的未交班草稿跳过，避免重复比对
    const prev = prevClosedShift(cur);
    if (!prev) continue;
    const prevLines = new Map(effectiveLines(prev).map((l) => [l.fuel, l]));
    for (const line of effectiveLines(cur)) {
      const prevLine = prevLines.get(line.fuel);
      if (!prevLine || prevLine.measured === null) continue;
      const gap = round2(line.opening - prevLine.measured);
      if (gap !== 0) {
        conflicts.push({
          shiftId: cur.id,
          shiftType: cur.shiftType,
          date: cur.date,
          fuel: line.fuel,
          opening: line.opening,
          prevMeasured: prevLine.measured,
          gap
        });
      }
    }
  }
  return conflicts;
});

/* ---------------- 操作 ---------------- */

export function createShift(date: string, shiftType: ShiftType, operator: string): Shift {
  const openings = inheritedOpenings();
  const shift: Shift = {
    id: uid(),
    date,
    shiftType,
    status: "draft",
    lines: FUELS.map((fuel) => emptyLine(fuel, openings[fuel] ?? 0)),
    operator: operator.trim(),
    note: "",
    createdAt: new Date().toISOString(),
    versions: []
  };
  state.shifts.push(shift);
  persist();
  return shift;
}

/** 保存草稿（未交班，可反复修改） */
export function saveDraft(shift: Shift, patch: { lines: FuelLine[]; operator: string; note: string }) {
  if (shift.status !== "draft") return;
  shift.lines = patch.lines;
  shift.operator = patch.operator.trim();
  shift.note = patch.note;
  persist();
}

/** 交班：校验通过后冻结为版本 1 */
export function closeShift(shift: Shift, patch: { lines: FuelLine[]; operator: string; note: string }): string[] {
  if (shift.status !== "draft") return ["该班次已交班，不能重复交班"];
  const errors = validateClose(patch.lines);
  if (errors.length) return errors;
  shift.lines = structuredClone(patch.lines);
  shift.operator = patch.operator.trim();
  shift.note = patch.note;
  shift.status = "closed";
  shift.versions = [
    {
      version: 1,
      lines: structuredClone(patch.lines),
      operator: shift.operator,
      note: patch.note,
      closedAt: new Date().toISOString(),
      reviseReason: ""
    }
  ];
  persist();
  return [];
}

/**
 * 修订已交班记录：旧版本原样冻结，新建带原因的修订版本。
 * 修订同样要通过交班阈值校验。
 */
export function reviseShift(
  shift: Shift,
  patch: { lines: FuelLine[]; operator: string; note: string; reason: string }
): string[] {
  if (shift.status !== "closed") return ["只能修订已交班的记录"];
  if (!patch.reason.trim()) return ["必须填写修订原因"];
  const errors = validateClose(patch.lines);
  if (errors.length) return errors;
  const nextVersion = shift.versions.length + 1;
  shift.versions.push({
    version: nextVersion,
    lines: structuredClone(patch.lines),
    operator: patch.operator.trim(),
    note: patch.note,
    closedAt: new Date().toISOString(),
    reviseReason: patch.reason.trim()
  });
  persist();
  return [];
}

export function getShift(id: string): Shift | undefined {
  return state.shifts.find((s) => s.id === id);
}

/** 仅供单元验证使用：清空内存与本地存储 */
export function __resetForTest() {
  state.shifts = reactive([]);
  localStorage.removeItem(STORAGE_KEY);
}

export function useStore() {
  return {
    shifts: computed(() => sortedShifts()),
    chainConflicts,
    createShift,
    saveDraft,
    closeShift,
    reviseShift,
    getShift,
    checkLine
  };
}

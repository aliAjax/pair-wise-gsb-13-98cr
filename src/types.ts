export type ShiftType = "早班" | "中班" | "晚班";
export type ShiftStatus = "draft" | "closed";

/** 单油品单班的罐存计量数据（单位：升） */
export interface FuelLine {
  fuel: string;
  /** 开班罐存 */
  opening: number;
  /** 进油量 */
  inflow: number;
  /** 销量 */
  sales: number;
  /** 交班实测罐存 */
  measured: number | null;
  /** 损溢原因（超阈值时必填） */
  lossReason: string;
}

/** 已冻结的历史版本，修订时保留，不允许再修改 */
export interface ShiftVersion {
  version: number;
  lines: FuelLine[];
  operator: string;
  note: string;
  closedAt: string;
  /** 修订原因，首版交班为空，修订版必填 */
  reviseReason: string;
}

export interface Shift {
  id: string;
  date: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  lines: FuelLine[];
  operator: string;
  note: string;
  createdAt: string;
  /** 已交班后的历史版本，最后一个元素为当前生效版本 */
  versions: ShiftVersion[];
}

export interface LineCheck {
  fuel: string;
  opening: number;
  inflow: number;
  sales: number;
  measured: number | null;
  /** 账面罐存 = 开班 + 进油 - 销量 */
  book: number;
  /** 差额 = 实测 - 账面；未实测时为 null */
  diff: number | null;
  /** 相对差额 = 差额 / 账面 */
  relDiff: number | null;
  overLimit: boolean;
  /** 账面是否为负数（开班 + 进油 < 销量） */
  bookNegative: boolean;
  measuredMissing: boolean;
  reasonMissing: boolean;
}

export interface ChainConflict {
  shiftId: string;
  shiftType: ShiftType;
  date: string;
  fuel: string;
  /** 该班记录的开班罐存（可能经过修订） */
  opening: number;
  /** 上一班交班实测罐存 */
  prevMeasured: number;
  gap: number;
}

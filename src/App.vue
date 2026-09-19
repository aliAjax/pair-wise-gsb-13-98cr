<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

/* ---------------- 业务常量 ---------------- */

const FUELS = ["92#汽油", "95#汽油", "98#汽油", "0#柴油"] as const;
const SHIFTS = ["早班", "中班", "晚班"] as const;

/** 绝对差额阈值（升），超过即必须填损溢原因 */
const ABS_LIMIT = 50;
/** 相对差额阈值（占账面罐存比例），超过即必须填损溢原因 */
const REL_LIMIT = 0.005;

const STORAGE_KEY = "dfwlfront-7-tank-handover-v1";

/* ---------------- 类型定义 ---------------- */

/** 已落盘的单油品行（数值型，冻结后不可变） */
interface TankEntry {
  fuel: string;
  opening: number; // 开班罐存
  inbound: number; // 进油量
  sales: number; // 销量
  closing: number; // 交班实测罐存
  reason: string; // 损溢原因（差额超限时必填）
}

/** 已落盘的班次记录 */
interface ShiftRecord {
  id: string;
  date: string; // YYYY-MM-DD
  shift: string;
  status: "open" | "closed" | "superseded";
  version: number; // 同一班次的版本号，修订一次 +1
  rootId: string; // 同班次版本族 id（首版等于自身 id）
  revisionReason: string; // 本版相对上一版的修订原因（首版为空）
  entries: TankEntry[];
  createdAt: string;
  closedAt: string | null;
}

/** 草稿行：输入框统一用字符串承接，计算时再转数 */
interface DraftEntry {
  fuel: string;
  opening: number;
  inbound: string;
  sales: string;
  closing: string;
  reason: string;
}

interface Draft {
  id: string;
  date: string;
  shift: string;
  version: number;
  rootId: string;
  revisionOf: string | null; // 修订时指向被修订的已交班记录 id
  revisionReason: string;
  sourceLabel: string; // 开班罐存来源说明
  entries: DraftEntry[];
}

interface PersistShape {
  version: 1;
  records: ShiftRecord[];
  draft: Draft | null;
}

/* ---------------- 工具函数 ---------------- */

function uid(): string {
  return crypto.randomUUID();
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return (Math.round(n * 100) / 100).toLocaleString("zh-CN");
}

function fmtSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RowCalc {
  fuel: string;
  opening: number;
  inbound: number;
  sales: number;
  book: number; // 账面罐存 = 开班 + 进油 - 销量
  closing: number | null;
  diff: number | null; // 差额 = 实测 - 账面，正为溢余、负为损耗
  relPct: number | null;
  exceeds: boolean; // 是否超过 50L 或 0.5%
  missingClosing: boolean;
  needReason: boolean; // 超限但未填原因
}

function calcRow(
  fuel: string,
  opening: number,
  inboundRaw: string,
  salesRaw: string,
  closingRaw: string,
  reason: string
): RowCalc {
  const inbound = Number(inboundRaw) || 0;
  const sales = Number(salesRaw) || 0;
  const closing = closingRaw.trim() === "" ? null : Number(closingRaw);
  const book = opening + inbound - sales;
  const diff = closing === null || !Number.isFinite(closing) ? null : closing - book;
  const exceeds =
    diff !== null &&
    (Math.abs(diff) > ABS_LIMIT || Math.abs(diff) > Math.abs(book) * REL_LIMIT);
  return {
    fuel,
    opening,
    inbound,
    sales,
    book,
    closing,
    diff,
    relPct: diff === null || book === 0 ? null : (diff / Math.abs(book)) * 100,
    exceeds,
    missingClosing: closing === null,
    needReason: exceeds && reason.trim() === ""
  };
}

function entryCalc(e: TankEntry): RowCalc {
  return calcRow(e.fuel, e.opening, String(e.inbound), String(e.sales), String(e.closing), e.reason);
}

/* ---------------- 种子数据（首次进入演示闭环） ---------------- */

function seed(): PersistShape {
  const morning: ShiftRecord = {
    id: "seed-morning",
    date: "2026-09-18",
    shift: "早班",
    status: "closed",
    version: 1,
    rootId: "seed-morning",
    revisionReason: "",
    createdAt: "2026-09-18T00:30:00.000Z",
    closedAt: "2026-09-18T08:05:00.000Z",
    entries: [
      { fuel: "92#汽油", opening: 12000, inbound: 8000, sales: 9500, closing: 10500, reason: "" },
      { fuel: "95#汽油", opening: 8000, inbound: 6000, sales: 7200, closing: 6790, reason: "" },
      { fuel: "98#汽油", opening: 3000, inbound: 0, sales: 800, closing: 2200, reason: "" },
      { fuel: "0#柴油", opening: 9000, inbound: 10000, sales: 6000, closing: 13000, reason: "" }
    ]
  };

  // 中班 v1：已交班，后因 92# 实测值多记被修订替代 → 冻结作废
  const noonV1: ShiftRecord = {
    id: "seed-noon-v1",
    date: "2026-09-18",
    shift: "中班",
    status: "superseded",
    version: 1,
    rootId: "seed-noon-v2",
    revisionReason: "",
    createdAt: "2026-09-18T08:20:00.000Z",
    closedAt: "2026-09-18T16:02:00.000Z",
    entries: [
      { fuel: "92#汽油", opening: 10500, inbound: 0, sales: 3200, closing: 7500, reason: "液位计读数异常，当班按估计值填报（事后复测更正）" },
      { fuel: "95#汽油", opening: 6790, inbound: 0, sales: 2100, closing: 4680, reason: "" },
      { fuel: "98#汽油", opening: 2200, inbound: 0, sales: 260, closing: 1935, reason: "" },
      { fuel: "0#柴油", opening: 13000, inbound: 0, sales: 4100, closing: 8820, reason: "温差导致液位计计量偏差，已复测并上报站长" }
    ]
  };

  // 中班 v2：现行有效版本
  const noonV2: ShiftRecord = {
    id: "seed-noon-v2",
    date: "2026-09-18",
    shift: "中班",
    status: "closed",
    version: 2,
    rootId: "seed-noon-v2",
    revisionReason: "92#交班实测值录入错误（多记 200L），按液位仪复测数据更正。",
    createdAt: "2026-09-18T16:20:00.000Z",
    closedAt: "2026-09-18T16:40:00.000Z",
    entries: [
      { fuel: "92#汽油", opening: 10500, inbound: 0, sales: 3200, closing: 7300, reason: "" },
      { fuel: "95#汽油", opening: 6790, inbound: 0, sales: 2100, closing: 4680, reason: "" },
      { fuel: "98#汽油", opening: 2200, inbound: 0, sales: 260, closing: 1935, reason: "" },
      { fuel: "0#柴油", opening: 13000, inbound: 0, sales: 4100, closing: 8820, reason: "温差导致液位计计量偏差，已复测并上报站长" }
    ]
  };

  // 当前待交班的晚班草稿：开班罐存继承自中班 v2 实测值
  const draft: Draft = {
    id: "seed-draft-night",
    date: "2026-09-19",
    shift: "晚班",
    version: 1,
    rootId: "seed-draft-night",
    revisionOf: null,
    revisionReason: "",
    sourceLabel: "09-18 中班 v2",
    entries: [
      { fuel: "92#汽油", opening: 7300, inbound: "6000", sales: "4000", closing: "10000", reason: "" },
      { fuel: "95#汽油", opening: 4680, inbound: "0", sales: "1800", closing: "", reason: "" },
      { fuel: "98#汽油", opening: 1935, inbound: "0", sales: "200", closing: "", reason: "" },
      { fuel: "0#柴油", opening: 8820, inbound: "0", sales: "3600", closing: "", reason: "" }
    ]
  };

  return { version: 1, records: [morning, noonV1, noonV2], draft };
}

/* ---------------- 落盘 / 读取 ---------------- */

function load(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seed();
  try {
    const parsed = JSON.parse(raw) as PersistShape;
    if (!Array.isArray(parsed.records)) return seed();
    return { version: 1, records: parsed.records, draft: parsed.draft ?? null };
  } catch {
    return seed();
  }
}

const initial = load();
const records = ref<ShiftRecord[]>(initial.records);
const draft = ref<Draft | null>(initial.draft);

// 首次进入（使用种子数据）时也立即落盘，保证刷新后跨班数据仍在
localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({ version: 1, records: records.value, draft: draft.value } satisfies PersistShape)
);

watch(
  [records, draft],
  () => {
    const payload: PersistShape = { version: 1, records: records.value, draft: draft.value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  },
  { deep: true }
);

/* ---------------- 查询派生 ---------------- */

/** 最近一次已交班（现行有效）班次 */
const latestClosed = computed<ShiftRecord | null>(() => {
  const closed = records.value
    .filter((r) => r.status === "closed")
    .sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
  return closed[0] ?? null;
});

function openingsOf(rec: ShiftRecord | null): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of FUELS) map[f] = 0;
  if (rec) for (const e of rec.entries) map[e.fuel] = e.closing;
  return map;
}

const draftRows = computed<RowCalc[]>(() => {
  if (!draft.value) return [];
  return draft.value.entries.map((e) =>
    calcRow(e.fuel, e.opening, e.inbound, e.sales, e.closing, e.reason)
  );
});

/** 阻断交班的冲突行 */
const conflicts = computed(() =>
  draftRows.value.filter((r) => r.missingClosing || r.needReason)
);

const revisionReasonMissing = computed(
  () => !!draft.value?.revisionOf && draft.value.revisionReason.trim() === ""
);

const canClose = computed(
  () =>
    !!draft.value &&
    draftRows.value.length > 0 &&
    draftRows.value.every((r) => !r.missingClosing && !r.needReason) &&
    !revisionReasonMissing.value
);

const attempted = ref(false);
const startError = ref("");

/* ---------------- 指标 / 列表 ---------------- */

const closedRecords = computed(() => records.value.filter((r) => r.status === "closed"));

const metrics = computed(() => {
  const totalDiff = closedRecords.value.reduce(
    (sum, r) => sum + r.entries.reduce((s, e) => s + (entryCalc(e).diff ?? 0), 0),
    0
  );
  return [
    { label: "待交班班次", value: draft.value ? 1 : 0 },
    { label: "已交班班次（现行）", value: closedRecords.value.length },
    { label: "累计账实差额 L", value: fmtSigned(Math.round(totalDiff * 100) / 100) }
  ];
});

const chartRows = computed(() => [
  { status: "待交班", value: draft.value ? 1 : 0 },
  { status: "已交班冻结", value: records.value.filter((r) => r.status === "closed").length },
  { status: "修订作废版本", value: records.value.filter((r) => r.status === "superseded").length }
]);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((r) => r.value)));

const filter = ref<string>("全部班次");

interface VersionGroup {
  date: string;
  shift: string;
  versions: ShiftRecord[]; // v 从新到旧
}

const groups = computed<VersionGroup[]>(() => {
  const map = new Map<string, ShiftRecord[]>();
  for (const r of records.value) {
    const key = `${r.date}#${r.shift}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const list: VersionGroup[] = [];
  for (const [, recs] of map) {
    const versions = [...recs].sort((a, b) => b.version - a.version);
    list.push({ date: versions[0].date, shift: versions[0].shift, versions });
  }
  list.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return SHIFTS.indexOf(b.shift as (typeof SHIFTS)[number]) -
      SHIFTS.indexOf(a.shift as (typeof SHIFTS)[number]);
  });
  return list.filter((g) => filter.value === "全部班次" || g.shift === filter.value);
});

/* ---------------- 动作：新建 / 交班 / 放弃 / 修订 ---------------- */

const newDate = ref(today());
const newShift = ref<string>("早班");

function startDraft() {
  startError.value = "";
  if (draft.value) {
    startError.value = "已有待交班班次，请先完成交班或放弃草稿。";
    return;
  }
  if (records.value.some((r) => r.date === newDate.value && r.shift === newShift.value)) {
    startError.value = "该班次已存在交班记录，如需更正请在下方记录中使用「新建修订」。";
    return;
  }
  const seed2 = latestClosed.value;
  const openings = openingsOf(seed2);
  const sourceLabel = seed2
    ? `${seed2.date.slice(5)} ${seed2.shift}${seed2.version > 1 ? ` v${seed2.version}` : ""}`
    : "首次建账，无";
  draft.value = {
    id: uid(),
    date: newDate.value,
    shift: newShift.value,
    version: 1,
    rootId: "",
    revisionOf: null,
    revisionReason: "",
    sourceLabel,
    entries: FUELS.map((fuel) => ({
      fuel,
      opening: openings[fuel],
      inbound: "0",
      sales: "0",
      closing: "",
      reason: ""
    }))
  };
  attempted.value = false;
}

function discardDraft() {
  if (!draft.value) return;
  if (!window.confirm("放弃当前待交班草稿？该操作不会影响已交班记录。")) return;
  draft.value = null;
  attempted.value = false;
}

/** 尝试交班：不通过则列出冲突，通过才落盘冻结 */
function closeDraft() {
  attempted.value = true;
  if (!draft.value || !canClose.value) return;

  const d = draft.value;
  const entries: TankEntry[] = d.entries.map((e) => {
    const c = calcRow(e.fuel, e.opening, e.inbound, e.sales, e.closing, e.reason);
    return {
      fuel: e.fuel,
      opening: c.opening,
      inbound: c.inbound,
      sales: c.sales,
      closing: c.closing ?? 0,
      reason: c.exceeds ? e.reason.trim() : ""
    };
  });

  if (d.revisionOf) {
    // 修订：同版本族内旧版全部冻结作废，新版生效
    for (const r of records.value) {
      if (r.rootId === d.rootId && r.status === "closed") r.status = "superseded";
    }
  }

  const record: ShiftRecord = {
    id: d.id,
    date: d.date,
    shift: d.shift,
    status: "closed",
    version: d.version,
    rootId: d.rootId || d.id,
    revisionReason: d.revisionOf ? d.revisionReason.trim() : "",
    entries,
    createdAt: records.value.find((r) => r.id === d.id)?.createdAt ?? new Date().toISOString(),
    closedAt: new Date().toISOString()
  };
  records.value.push(record);
  draft.value = null;
  attempted.value = false;
}

function startRevision(rec: ShiftRecord) {
  startError.value = "";
  if (draft.value) {
    startError.value = "已有待交班班次，请先完成交班或放弃草稿后再发起修订。";
    return;
  }
  draft.value = {
    id: uid(),
    date: rec.date,
    shift: rec.shift,
    version: rec.version + 1,
    rootId: rec.rootId,
    revisionOf: rec.id,
    revisionReason: "",
    sourceLabel: `${rec.date.slice(5)} ${rec.shift} v${rec.version}`,
    entries: rec.entries.map((e) => ({
      fuel: e.fuel,
      opening: e.opening, // 开班罐存为历史事实，修订不改写
      inbound: String(e.inbound),
      sales: String(e.sales),
      closing: String(e.closing),
      reason: e.reason
    }))
  };
  attempted.value = false;
  // 草稿面板在页面顶部，自动滚上去
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------- 展示辅助 ---------------- */

function diffClass(r: RowCalc): string {
  if (r.diff === null) return "diff-neutral";
  if (r.exceeds) return "diff-bad";
  return "diff-ok";
}

function diffText(r: RowCalc): string {
  if (r.diff === null) return "未实测";
  const tail = r.relPct === null ? "" : `（${r.relPct > 0 ? "+" : ""}${fmt(r.relPct)}%）`;
  return `${fmtSigned(r.diff)} L${tail}`;
}

function verdictText(r: RowCalc): string {
  if (r.missingClosing) return "待填实测";
  if (!r.exceeds) return r.diff === 0 ? "账实一致" : "差额在阈值内";
  return r.needReason ? "超限·须填损溢原因" : "超限·已填原因";
}

function statusBadge(r: ShiftRecord): { text: string; cls: string } {
  if (r.status === "closed") return { text: `已交班 · v${r.version} 冻结`, cls: "badge-closed" };
  if (r.status === "superseded") return { text: `v${r.version} 已被修订替代`, cls: "badge-old" };
  return { text: "待交班", cls: "badge-open" };
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>加油站油罐班次交接</h1>
          <p class="subtitle">
            每班按油品记录开班罐存、进油量、销量与交班实测罐存；账面罐存 = 开班罐存 + 进油量 − 销量。
            绝对差额超过 50L 或相对差额超过 0.5% 时禁止交班，须填写损溢原因；下一班开班罐存继承上一班实测值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage 落盘</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <!-- 当前待交班班次 -->
      <section class="panel draft-panel">
        <template v-if="draft">
          <div class="panel-head">
            <h2>
              交班录入 · {{ draft.date }} {{ draft.shift }}
              <span v-if="draft.revisionOf" class="rev-flag">修订 v{{ draft.version }}</span>
            </h2>
            <p class="hint">
              开班罐存继承自上一班（{{ draft.sourceLabel }}）的交班实测值，不可手工修改。
            </p>
          </div>

          <div v-if="draft.revisionOf" class="revision-box">
            <label>
              修订原因（必填，旧版将保留并冻结）
              <textarea
                v-model="draft.revisionReason"
                placeholder="例如：实测值录入错误，按液位仪复测数据更正……"
              />
            </label>
          </div>

          <div class="table-scroll">
            <table class="tank-table">
              <thead>
                <tr>
                  <th>油品</th>
                  <th>开班罐存 L</th>
                  <th>进油量 L</th>
                  <th>销量 L</th>
                  <th>账面罐存 L</th>
                  <th>交班实测 L</th>
                  <th>差额（实测−账面）</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(row, i) in draftRows" :key="row.fuel">
                  <tr>
                    <td class="fuel-cell">{{ row.fuel }}</td>
                    <td class="num locked">{{ fmt(row.opening) }}</td>
                    <td class="num">
                      <input v-model="draft.entries[i].inbound" type="number" min="0" step="0.1" />
                    </td>
                    <td class="num">
                      <input v-model="draft.entries[i].sales" type="number" min="0" step="0.1" />
                    </td>
                    <td class="num book">{{ fmt(row.book) }}</td>
                    <td class="num">
                      <input
                        v-model="draft.entries[i].closing"
                        type="number"
                        min="0"
                        step="0.1"
                        :class="{ 'input-bad': attempted && row.missingClosing }"
                        placeholder="实测"
                      />
                    </td>
                    <td class="num" :class="diffClass(row)">{{ diffText(row) }}</td>
                    <td>
                      <span class="verdict" :class="diffClass(row)">{{ verdictText(row) }}</span>
                    </td>
                  </tr>
                  <tr v-if="row.exceeds" class="reason-row">
                    <td colspan="8">
                      <label>
                        损溢原因（{{ row.fuel }} 差额已超 50L 或 0.5%，不填不能交班）
                        <input
                          v-model="draft.entries[i].reason"
                          :class="{ 'input-bad': attempted && row.needReason }"
                          placeholder="填写损耗/溢余原因，如：温度补偿偏差、管线渗漏排查、液位计校准……"
                        />
                      </label>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- 冲突清单 -->
          <div v-if="attempted && (conflicts.length || revisionReasonMissing)" class="conflict-box">
            <h3>无法交班，请先处理以下冲突：</h3>
            <div v-if="revisionReasonMissing" class="conflict-line">
              · 修订班次必须填写修订原因。
            </div>
            <table v-if="conflicts.length" class="conflict-table">
              <thead>
                <tr>
                  <th>油品</th>
                  <th>账面量 L</th>
                  <th>实测量 L</th>
                  <th>差额 L</th>
                  <th>阻断原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in conflicts" :key="row.fuel">
                  <td>{{ row.fuel }}</td>
                  <td class="num">{{ fmt(row.book) }}</td>
                  <td class="num">{{ row.closing === null ? "未填写" : fmt(row.closing) }}</td>
                  <td class="num">{{ row.diff === null ? "—" : fmtSigned(row.diff) }}</td>
                  <td>
                    <template v-if="row.missingClosing">未填写交班实测罐存</template>
                    <template v-else-if="row.needReason">
                      差额超阈值（&gt;50L 或 &gt;0.5%），须填写损溢原因
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="draft-actions">
            <button type="button" :disabled="!canClose" @click="closeDraft">
              确认交班并冻结
            </button>
            <button type="button" class="danger secondary" @click="discardDraft">放弃草稿</button>
            <span class="hint">阈值：|差额| &gt; 50 L 或 |差额| &gt; 账面 × 0.5%</span>
          </div>
        </template>

        <template v-else>
          <div class="panel-head">
            <h2>新建班次交接</h2>
            <p class="hint">
              本班开班罐存将自动继承
              <strong>{{ latestClosed ? `${latestClosed.date.slice(5)} ${latestClosed.shift} v${latestClosed.version} 的实测罐存` : "（首次建账，默认 0）" }}</strong>。
            </p>
          </div>
          <form class="start-form" @submit.prevent="startDraft">
            <label>
              交接日期
              <input v-model="newDate" type="date" required />
            </label>
            <label>
              班次
              <select v-model="newShift">
                <option v-for="s in SHIFTS" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <button type="submit">开班录入</button>
          </form>
          <p v-if="startError" class="error-text">{{ startError }}</p>
        </template>
      </section>

      <!-- 已交班记录 -->
      <section class="list-panel">
        <div class="toolbar">
          <h2>交接记录（已交班冻结，更正只能新建修订）</h2>
          <select v-model="filter">
            <option>全部班次</option>
            <option v-for="s in SHIFTS" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <p v-if="startError" class="error-text">{{ startError }}</p>

        <div class="record-grid">
          <div v-if="groups.length === 0" class="empty">暂无匹配的交接记录</div>

          <article v-for="g in groups" :key="g.date + g.shift" class="record">
            <div v-for="(rec, vi) in g.versions" :key="rec.id" class="version-block" :class="{ 'is-old': rec.status === 'superseded' }">
              <div class="record-head">
                <p class="record-title">
                  {{ rec.date }} {{ rec.shift }}
                  <span v-if="g.versions.length > 1" class="version-count">共 {{ g.versions.length }} 个版本</span>
                </p>
                <span class="badge" :class="statusBadge(rec).cls">{{ statusBadge(rec).text }}</span>
              </div>

              <div v-if="vi === 0" class="table-scroll">
                <table class="tank-table readonly">
                  <thead>
                    <tr>
                      <th>油品</th>
                      <th>开班 L</th>
                      <th>进油 L</th>
                      <th>销量 L</th>
                      <th>账面 L</th>
                      <th>实测 L</th>
                      <th>差额</th>
                      <th>判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="e in rec.entries" :key="e.fuel">
                      <tr>
                        <td class="fuel-cell">{{ e.fuel }}</td>
                        <td class="num">{{ fmt(e.opening) }}</td>
                        <td class="num">{{ fmt(e.inbound) }}</td>
                        <td class="num">{{ fmt(e.sales) }}</td>
                        <td class="num book">{{ fmt(entryCalc(e).book) }}</td>
                        <td class="num">{{ fmt(e.closing) }}</td>
                        <td class="num" :class="diffClass(entryCalc(e))">{{ diffText(entryCalc(e)) }}</td>
                        <td><span class="verdict" :class="diffClass(entryCalc(e))">{{ verdictText(entryCalc(e)) }}</span></td>
                      </tr>
                      <tr v-if="e.reason" class="reason-row">
                        <td colspan="8" class="reason-text">损溢原因（{{ e.fuel }}）：{{ e.reason }}</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>

              <!-- 旧版本折叠展示 -->
              <details v-else class="old-version">
                <summary>查看 v{{ rec.version }} 旧版内容（已冻结保留）</summary>
                <table class="tank-table readonly">
                  <thead>
                    <tr>
                      <th>油品</th>
                      <th>开班 L</th>
                      <th>进油 L</th>
                      <th>销量 L</th>
                      <th>账面 L</th>
                      <th>实测 L</th>
                      <th>差额</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="e in rec.entries" :key="e.fuel">
                      <td class="fuel-cell">{{ e.fuel }}</td>
                      <td class="num">{{ fmt(e.opening) }}</td>
                      <td class="num">{{ fmt(e.inbound) }}</td>
                      <td class="num">{{ fmt(e.sales) }}</td>
                      <td class="num">{{ fmt(entryCalc(e).book) }}</td>
                      <td class="num">{{ fmt(e.closing) }}</td>
                      <td class="num" :class="diffClass(entryCalc(e))">{{ diffText(entryCalc(e)) }}</td>
                    </tr>
                  </tbody>
                </table>
              </details>

              <p v-if="rec.revisionReason" class="note">
                修订原因（v{{ rec.version }}）：{{ rec.revisionReason }}
              </p>
              <p v-else-if="rec.status === 'superseded'" class="note old-note">
                该版本已被后续修订替代，仅作存档，不能编辑或删除。
              </p>

              <div v-if="rec.status === 'closed' && vi === 0" class="actions">
                <button
                  type="button"
                  class="secondary"
                  :disabled="!!draft"
                  :title="draft ? '存在待交班班次，请先处理' : '基于该版创建带原因的修订'"
                  @click="startRevision(rec)"
                >
                  新建修订（保留旧版）
                </button>
                <span class="hint">交班时间：{{ rec.closedAt ? new Date(rec.closedAt).toLocaleString("zh-CN") : "—" }}</span>
              </div>
            </div>
          </article>
        </div>

        <div class="mini-chart">
          <div v-for="row in chartRows" :key="row.status" class="bar">
            <span>{{ row.status }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

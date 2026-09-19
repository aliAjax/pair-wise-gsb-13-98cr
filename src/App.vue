<script setup lang="ts">
import { computed, ref } from "vue";
import ShiftCard from "./components/ShiftCard.vue";
import {
  ABS_LIMIT,
  chainConflicts,
  checkLine,
  createShift,
  effectiveLines,
  REL_LIMIT,
  SHIFT_TYPES,
  useStore
} from "./store";
import type { Shift, ShiftType } from "./types";

const { shifts } = useStore();

const showNew = ref(false);
const newDate = ref(new Date().toISOString().slice(0, 10));
const newType = ref<ShiftType>("早班");
const newOperator = ref("");
const newError = ref("");

const filter = ref<"all" | "draft" | "closed">("all");
const filtered = computed(() => {
  if (filter.value === "all") return shifts.value;
  return shifts.value.filter((s) => s.status === filter.value);
});

/** 列表展示：最新班次在前，方便接着交班 */
const displayShifts = computed(() => [...filtered.value].reverse());

function openNew() {
  newDate.value = new Date().toISOString().slice(0, 10);
  newType.value = "早班";
  newOperator.value = "";
  newError.value = "";
  showNew.value = true;
}

function submitNew() {
  if (!newDate.value) {
    newError.value = "请选择日期";
    return;
  }
  if (!newOperator.value.trim()) {
    newError.value = "请填写交班人";
    return;
  }
  const dup = shifts.value.some((s) => s.date === newDate.value && s.shiftType === newType.value);
  if (dup) {
    newError.value = `${newDate.value} ${newType.value} 已存在，不能重复开班`;
    return;
  }
  createShift(newDate.value, newType.value, newOperator.value);
  showNew.value = false;
}

/* ---------------- 指标 ---------------- */
const totalShifts = computed(() => shifts.value.length);
const draftCount = computed(() => shifts.value.filter((s) => s.status === "draft").length);
const closedCount = computed(() => shifts.value.filter((s) => s.status === "closed").length);
const revisionCount = computed(() => shifts.value.reduce((acc, s) => acc + Math.max(0, s.versions.length - 1), 0));
const conflictCount = computed(() => chainConflicts.value.length);

/* ---------------- 交班校验汇总（未交班草稿） ---------------- */
interface BlockRow {
  shift: Shift;
  fuel: string;
  book: number;
  measured: number | null;
  diff: number | null;
  relDiff: number | null;
  reason: string;
}

const blockRows = computed<BlockRow[]>(() => {
  const rows: BlockRow[] = [];
  for (const shift of shifts.value) {
    if (shift.status !== "draft") continue;
    for (const line of shift.lines) {
      const c = checkLine(line);
      if (c.measuredMissing || c.bookNegative || c.overLimit) {
        let reason = c.measuredMissing
          ? "未填实测罐存"
          : c.bookNegative
            ? "账面为负"
            : c.overLimit && !c.reasonMissing
              ? "超阈值（已填损溢原因）"
              : "超阈值且未填损溢原因，不能交班";
        rows.push({ shift, fuel: line.fuel, book: c.book, measured: c.measured, diff: c.diff, relDiff: c.relDiff, reason });
      }
    }
  }
  return rows;
});

function fmt(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function shiftLabel(s: Shift): string {
  return `${s.date} ${s.shiftType}`;
}

function scrollToShift(id: string) {
  document.getElementById(`shift-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const latestClosed = computed(() => [...shifts.value].reverse().find((s) => s.status === "closed"));
const latestLines = computed(() => (latestClosed.value ? effectiveLines(latestClosed.value) : []));
const inheritHint = computed(() =>
  latestClosed.value ? shiftLabel(latestClosed.value) + " 的交班实测罐存" : "无历史班次，开班罐存初始为 0"
);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 油罐交接闭环</p>
          <h1>加油站班次油罐交接</h1>
          <p class="subtitle">
            按油品逐班记录开班罐存、进油量、销量与交班实测罐存；账面罐存自动核算，超差必须填写损溢原因才能交班。
            下一班开班罐存自动继承上一班实测值，已交班记录冻结，更正只能新建带原因的修订。
          </p>
        </div>
        <button class="new-btn" type="button" @click="openNew">+ 新开一班</button>
      </header>

      <section class="metrics">
        <article class="metric"><span>班次总数</span><strong>{{ totalShifts }}</strong></article>
        <article class="metric"><span>已交班（冻结）</span><strong>{{ closedCount }}</strong></article>
        <article class="metric"><span>待交班</span><strong :class="{ alert: draftCount > 0 }">{{ draftCount }}</strong></article>
        <article class="metric"><span>修订次数</span><strong>{{ revisionCount }}</strong></article>
        <article class="metric" :class="{ alert: conflictCount > 0 }">
          <span>跨班衔接冲突</span><strong>{{ conflictCount }}</strong>
        </article>
      </section>

      <!-- 跨班冲突：油品、开班量、上一班实测量、差额 -->
      <section v-if="conflictCount" class="panel conflict-panel">
        <h2>⚠ 跨班数据冲突（{{ conflictCount }} 项）</h2>
        <p class="panel-desc">
          下列油品的本班开班罐存与上一班交班实测罐存不一致（通常因上一班记录被修订）。差额 = 本班开班 − 上一班实测。
        </p>
        <table class="conflict-table">
          <thead>
            <tr>
              <th>班次</th><th>油品</th><th>本班开班罐存 (L)</th><th>上一班交班实测 (L)</th><th>差额 (L)</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in chainConflicts" :key="c.shiftId + c.fuel">
              <td>{{ c.date }} {{ c.shiftType }}</td>
              <td class="fuel-name">{{ c.fuel }}</td>
              <td>{{ fmt(c.opening) }}</td>
              <td>{{ fmt(c.prevMeasured) }}</td>
              <td class="diff-bad">{{ fmt(c.gap) }}</td>
              <td><button type="button" class="link-btn" @click="scrollToShift(c.shiftId)">前往处理 / 修订</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 交班阻塞项：油品、账面量、实测量、差额 -->
      <section v-if="blockRows.length" class="panel block-panel">
        <h2>交班校验未通过（{{ blockRows.length }} 项）</h2>
        <p class="panel-desc">
          绝对差额 &gt; {{ ABS_LIMIT }} L 或相对差额 &gt; {{ (REL_LIMIT * 100).toFixed(1) }}% 时，必须填写损溢原因方可交班。
        </p>
        <table class="conflict-table">
          <thead>
            <tr>
              <th>班次</th><th>油品</th><th>账面罐存 (L)</th><th>实测量 (L)</th><th>差额 (L)</th><th>相对差额</th><th>问题</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in blockRows" :key="r.shift.id + r.fuel + i">
              <td>{{ shiftLabel(r.shift) }}</td>
              <td class="fuel-name">{{ r.fuel }}</td>
              <td>{{ fmt(r.book) }}</td>
              <td>{{ fmt(r.measured) }}</td>
              <td class="diff-bad">{{ fmt(r.diff) }}</td>
              <td class="diff-bad">{{ r.relDiff === null ? "—" : (r.relDiff * 100).toFixed(2) + "%" }}</td>
              <td>{{ r.reason }}</td>
              <td><button type="button" class="link-btn" @click="scrollToShift(r.shift.id)">去填写</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="workspace">
        <aside class="side panel">
          <h2>当前罐存概览</h2>
          <p v-if="!latestClosed" class="muted">尚无已交班记录，完成第一次交班后展示。</p>
          <ul v-else class="stock-list">
            <li v-for="line in latestLines" :key="line.fuel">
              <span class="fuel-name">{{ line.fuel }}</span>
              <strong>{{ fmt(line.measured) }} L</strong>
              <small>{{ shiftLabel(latestClosed) }} 交班实测</small>
            </li>
          </ul>
          <div class="rule-box">
            <h3>交接规则</h3>
            <ul>
              <li>账面罐存 = 开班罐存 + 进油量 − 销量</li>
              <li>差额 = 交班实测 − 账面罐存</li>
              <li>|差额| &gt; {{ ABS_LIMIT }} L 或相对差额 &gt; 0.5% 时，必须填写损溢原因</li>
              <li>未通过校验不能交班；数据保存在浏览器本地，刷新后跨班数据仍在</li>
              <li>已交班记录冻结；修订会生成新版本，旧版保留备查</li>
            </ul>
          </div>
        </aside>

        <section class="shift-list">
          <div class="toolbar">
            <h2>班次记录</h2>
            <div class="filters">
              <button v-for="f in (['all','draft','closed'] as const)" :key="f"
                      type="button" class="chip" :class="{ active: filter === f }"
                      @click="filter = f">
                {{ f === "all" ? "全部" : f === "draft" ? "待交班" : "已交班" }}
              </button>
            </div>
          </div>

          <div v-if="displayShifts.length === 0" class="empty">暂无班次，点击右上角“新开一班”开始交接</div>
          <div v-else class="cards">
            <div v-for="shift in displayShifts" :id="`shift-${shift.id}`" :key="shift.id" class="card-anchor">
              <ShiftCard :shift="shift" />
            </div>
          </div>
        </section>
      </section>
    </div>

    <!-- 新开一班弹层 -->
    <div v-if="showNew" class="modal-mask" @click.self="showNew = false">
      <div class="modal">
        <h2>新开一班</h2>
        <p class="modal-hint">
          开班罐存将自动继承上一班（{{ inheritHint }}）。
        </p>
        <label>日期
          <input v-model="newDate" type="date" />
        </label>
        <label>班次
          <select v-model="newType">
            <option v-for="t in SHIFT_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label>交班人
          <input v-model="newOperator" placeholder="本班负责人姓名" />
        </label>
        <p v-if="newError" class="modal-error">{{ newError }}</p>
        <div class="modal-actions">
          <button type="button" class="ghost" @click="showNew = false">取消</button>
          <button type="button" class="primary" @click="submitNew">开班</button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.app { min-height: 100vh; padding: 28px; }
.shell { max-width: 1240px; margin: 0 auto; }

.topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: end;
  margin-bottom: 22px;
}
.eyebrow { margin: 0 0 8px; color: #176b87; font-weight: 700; font-size: 13px; }
h1 { margin: 0; font-size: clamp(26px, 3.4vw, 38px); }
.subtitle { margin: 10px 0 0; max-width: 820px; color: #5b667a; line-height: 1.7; font-size: 14px; }

.new-btn {
  background: #176b87;
  color: #fff;
  border: 0;
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 15px;
  cursor: pointer;
  white-space: nowrap;
}
.new-btn:hover { background: #12586f; }

.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.metric {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px 16px;
}
.metric span { display: block; color: #69758c; font-size: 12.5px; }
.metric strong { display: block; margin-top: 6px; font-size: 26px; font-variant-numeric: tabular-nums; }
.metric strong.alert { color: #d99a22; }
.metric.alert { border-color: #eab4a8; background: #fdf7f5; }
.metric.alert strong { color: #c84b31; }

.panel {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 18px;
}
.panel h2 { margin: 0 0 8px; font-size: 17px; }
.panel-desc { margin: 0 0 12px; font-size: 13px; color: #69758c; }
.conflict-panel { border-color: #eab4a8; }
.block-panel { border-color: #e8cf9b; }

.conflict-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.conflict-table th, .conflict-table td {
  border: 1px solid #e6ecf4;
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}
.conflict-table th { background: #f7f9fc; color: #445069; font-weight: 600; }
.fuel-name { font-weight: 700; }
.diff-bad { color: #c84b31; font-weight: 700; font-variant-numeric: tabular-nums; }
.link-btn {
  background: transparent;
  border: 0;
  color: #176b87;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  text-decoration: underline;
}

.workspace {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
  align-items: start;
}
.side { position: sticky; top: 16px; margin-bottom: 0; }
.side h2 { margin: 0 0 12px; font-size: 16px; }
.muted { color: #8693a8; font-size: 13px; }

.stock-list { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 8px; }
.stock-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  padding: 10px 12px;
  background: #f7f9fc;
  border-radius: 8px;
}
.stock-list li strong { font-size: 17px; font-variant-numeric: tabular-nums; }
.stock-list li small { grid-column: 1 / -1; color: #8693a8; font-size: 12px; }

.rule-box { border-top: 1px dashed #d9e2ee; padding-top: 12px; }
.rule-box h3 { margin: 0 0 8px; font-size: 13px; color: #445069; }
.rule-box ul { margin: 0; padding-left: 18px; color: #5b667a; font-size: 12.5px; line-height: 1.9; }

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 10px;
}
.toolbar h2 { margin: 0; font-size: 18px; }
.filters { display: flex; gap: 6px; }
.chip {
  border: 1px solid #cfd8e5;
  background: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #445069;
}
.chip.active { background: #176b87; border-color: #176b87; color: #fff; }

.cards { display: grid; gap: 14px; }
.card-anchor { scroll-margin-top: 14px; }
.empty {
  text-align: center;
  color: #69758c;
  background: #fff;
  border: 1px dashed #cfd8e5;
  border-radius: 10px;
  padding: 40px 12px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 32, 51, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}
.modal {
  background: #fff;
  border-radius: 12px;
  padding: 22px 24px;
  width: min(420px, 100%);
  display: grid;
  gap: 12px;
}
.modal h2 { margin: 0; font-size: 19px; }
.modal-hint { margin: 0; font-size: 12.5px; color: #69758c; line-height: 1.6; }
.modal label { display: grid; gap: 6px; font-size: 13.5px; color: #445069; }
.modal-error { margin: 0; color: #c84b31; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.modal-actions button {
  border: 0; border-radius: 8px; padding: 9px 18px; cursor: pointer; font-size: 14px;
}
.modal-actions .primary { background: #176b87; color: #fff; }
.modal-actions .ghost { background: #eef2f7; color: #445069; }

@media (max-width: 920px) {
  .app { padding: 16px; }
  .topbar { grid-template-columns: 1fr; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .workspace { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>

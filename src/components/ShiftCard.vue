<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FuelLine, Shift } from "../types";
import { checkLine, closeShift, effectiveLines, emptyLine, FUELS, prevClosedShift, reviseShift, saveDraft, validateClose } from "../store";
import FuelTable from "./FuelTable.vue";

const props = defineProps<{ shift: Shift }>();

type Mode = "view" | "edit" | "revise";
const mode = ref<Mode>("view");
const editLines = ref<FuelLine[]>([]);
const editOperator = ref("");
const editNote = ref("");
const reviseReason = ref("");
const errors = ref<string[]>([]);
const showVersions = ref<number[]>([]);
const savedTip = ref("");

const currentLines = computed(() => effectiveLines(props.shift));
const lineChecks = computed(() => currentLines.value.map((l) => checkLine(l)));
const hasOverLimit = computed(() => lineChecks.value.some((c) => c.overLimit));

const previous = computed(() => prevClosedShift(props.shift));

function clone(lines: FuelLine[]): FuelLine[] {
  return lines.map((l) => ({ ...l }));
}

function startEdit() {
  editLines.value = clone(props.shift.lines);
  editOperator.value = props.shift.operator;
  editNote.value = props.shift.note;
  errors.value = [];
  mode.value = "edit";
}

function startRevise() {
  editLines.value = clone(currentLines.value);
  editOperator.value = props.shift.versions.at(-1)?.operator ?? props.shift.operator;
  editNote.value = props.shift.versions.at(-1)?.note ?? props.shift.note;
  reviseReason.value = "";
  errors.value = [];
  mode.value = "revise";
}

function cancel() {
  mode.value = "view";
  errors.value = [];
}

function flashTip(text: string) {
  savedTip.value = text;
  window.setTimeout(() => (savedTip.value = ""), 2000);
}

function doSaveDraft() {
  saveDraft(props.shift, { lines: clone(editLines.value), operator: editOperator.value, note: editNote.value });
  flashTip("草稿已保存");
}

function doClose() {
  errors.value = validateClose(editLines.value);
  if (!editOperator.value.trim()) errors.value.unshift("请填写交班人");
  if (errors.value.length) return;
  const rest = closeShift(props.shift, {
    lines: clone(editLines.value),
    operator: editOperator.value,
    note: editNote.value
  });
  if (rest.length) {
    errors.value = rest;
    return;
  }
  mode.value = "view";
}

function doRevise() {
  if (!reviseReason.value.trim()) {
    errors.value = ["必须填写修订原因"];
    return;
  }
  errors.value = reviseShift(props.shift, {
    lines: clone(editLines.value),
    operator: editOperator.value,
    note: editNote.value,
    reason: reviseReason.value
  });
  if (!errors.value.length) mode.value = "view";
}

const editChecks = computed(() => (mode.value === "view" ? [] : editLines.value.map((l) => checkLine(l))));

function toggleVersion(v: number) {
  const i = showVersions.value.indexOf(v);
  if (i >= 0) showVersions.value.splice(i, 1);
  else showVersions.value.push(v);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

// 切换到别的班次时重置面板状态
watch(
  () => props.shift.id,
  () => {
    mode.value = "view";
    errors.value = [];
    showVersions.value = [];
  }
);

/** 新增一行油品（防御性：正常油品固定，修订时也不需要） */
function addFuelLine() {
  const used = new Set(editLines.value.map((l) => l.fuel));
  const next = FUELS.find((f) => !used.has(f));
  if (next) editLines.value.push(emptyLine(next));
}
</script>

<template>
  <article class="shift-card" :class="{ draft: shift.status === 'draft', closed: shift.status === 'closed' }">
    <header class="shift-head">
      <div class="shift-title">
        <h3>{{ shift.date }} {{ shift.shiftType }}</h3>
        <span class="badge" :class="shift.status">{{ shift.status === "draft" ? "交班中" : "已交班 · 冻结" }}</span>
        <span v-if="hasOverLimit && shift.status === 'closed'" class="badge warn">有损益</span>
        <span v-if="shift.versions.length > 1" class="badge revise">已修订 v{{ shift.versions.length }}</span>
      </div>
      <div class="shift-meta">
        <span>交班人：{{ (shift.versions.at(-1)?.operator) || shift.operator || "—" }}</span>
        <span v-if="shift.status === 'closed'">
          交班时间：{{ fmtTime(shift.versions.at(-1)!.closedAt) }}
        </span>
      </div>
    </header>

    <p v-if="previous" class="inherit-hint">
      开班罐存继承自上一班（{{ previous.date }} {{ previous.shiftType }}）交班实测值
    </p>
    <p v-else class="inherit-hint">本班为最早记录，开班罐存按初始盘点录入</p>

    <!-- 查看态：展示当前生效版本 -->
    <FuelTable v-if="mode === 'view'" :lines="currentLines" :editable="false" />

    <p v-if="mode === 'view' && (shift.versions.at(-1)?.note || shift.note)" class="note-line">
      备注：{{ shift.versions.at(-1)?.note || shift.note }}
    </p>

    <!-- 编辑/修订态 -->
    <template v-if="mode !== 'view'">
      <FuelTable :lines="editLines" :editable="true" />
      <div v-if="FUELS.length > editLines.length" class="row-actions">
        <button type="button" class="secondary small" @click="addFuelLine">补充油品行</button>
      </div>

      <div class="edit-meta">
        <label>
          交班人
          <input v-model="editOperator" placeholder="姓名" />
        </label>
        <label class="grow">
          备注
          <input v-model="editNote" placeholder="本班情况说明（选填）" />
        </label>
      </div>

      <label v-if="mode === 'revise'" class="revise-reason">
        修订原因（必填，旧版本将保留备查）
        <textarea v-model="reviseReason" rows="2" placeholder="例如：前尺读数错误，实测应为……"></textarea>
      </label>

      <div v-if="editChecks.some((c) => c.overLimit)" class="live-warn">
        <strong>实时校验：</strong>
        <span v-for="c in editChecks.filter((c) => c.overLimit)" :key="c.fuel">
          {{ c.fuel }} 账面 {{ c.book }} L / 实测 {{ c.measured }} L / 差额 {{ c.diff }} L
          （{{ ((c.relDiff ?? 0) * 100).toFixed(2) }}%），须填损溢原因；
        </span>
      </div>

      <ul v-if="errors.length" class="errors">
        <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
      </ul>

      <div class="card-actions">
        <template v-if="mode === 'edit'">
          <button type="button" class="secondary" @click="doSaveDraft">保存草稿</button>
          <button type="button" class="primary" @click="doClose">交班</button>
          <button type="button" class="ghost" @click="cancel">取消</button>
          <span v-if="savedTip" class="tip">{{ savedTip }}</span>
        </template>
        <template v-else>
          <button type="button" class="primary" @click="doRevise">提交修订（保留旧版）</button>
          <button type="button" class="ghost" @click="cancel">取消</button>
        </template>
      </div>
    </template>

    <!-- 查看态操作 -->
    <div v-if="mode === 'view'" class="card-actions">
      <button v-if="shift.status === 'draft'" type="button" class="primary" @click="startEdit">录入 / 交班</button>
      <button v-if="shift.status === 'closed'" type="button" class="secondary" @click="startRevise">新建修订</button>
      <span v-if="savedTip" class="tip">{{ savedTip }}</span>
    </div>

    <!-- 版本历史 -->
    <section v-if="shift.versions.length" class="versions">
      <h4>冻结版本（共 {{ shift.versions.length }} 版，旧版不可修改）</h4>
      <div v-for="ver in [...shift.versions].reverse()" :key="ver.version" class="version-item">
        <button type="button" class="version-head" @click="toggleVersion(ver.version)">
          <span>v{{ ver.version }}{{ ver.version === shift.versions.length ? "（当前生效）" : "" }}</span>
          <span>{{ fmtTime(ver.closedAt) }} · {{ ver.operator }}</span>
          <span v-if="ver.reviseReason" class="revise-tag">修订：{{ ver.reviseReason }}</span>
          <span class="caret">{{ showVersions.includes(ver.version) ? "收起 ▲" : "展开 ▼" }}</span>
        </button>
        <div v-if="showVersions.includes(ver.version)" class="version-body">
          <FuelTable :lines="ver.lines" :editable="false" />
          <p v-if="ver.note" class="note-line">备注：{{ ver.note }}</p>
        </div>
      </div>
    </section>
  </article>
</template>

<style scoped>
.shift-card {
  background: #fff;
  border: 1px solid #dfe7f1;
  border-left-width: 4px;
  border-radius: 10px;
  padding: 16px 18px;
}
.shift-card.draft { border-left-color: #d99a22; }
.shift-card.closed { border-left-color: #14724f; }

.shift-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: baseline;
}
.shift-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.shift-title h3 { margin: 0; font-size: 18px; }
.shift-meta { display: flex; gap: 14px; color: #69758c; font-size: 13px; flex-wrap: wrap; }

.badge {
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  background: #e8eef5;
  color: #445069;
}
.badge.draft { background: #fdf2dd; color: #9a6b12; }
.badge.closed { background: #e8f4ef; color: #14724f; }
.badge.warn { background: #fdeae6; color: #c84b31; }
.badge.revise { background: #e7f0fb; color: #1a5fa8; }

.inherit-hint { margin: 8px 0 12px; font-size: 12px; color: #176b87; }

.note-line {
  margin: 10px 0 0;
  padding: 8px 10px;
  background: #eef5fb;
  border-radius: 8px;
  font-size: 13px;
  color: #445069;
}

.edit-meta {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.edit-meta label { display: grid; gap: 5px; font-size: 13px; color: #445069; }
.edit-meta .grow { flex: 1; min-width: 220px; }

.revise-reason { display: grid; gap: 5px; margin-top: 12px; font-size: 13px; color: #c84b31; font-weight: 600; }

.live-warn {
  margin-top: 10px;
  padding: 9px 12px;
  background: #fdf3f1;
  border: 1px solid #f0c7bf;
  border-radius: 8px;
  font-size: 12.5px;
  color: #a53e28;
  line-height: 1.7;
}

.errors {
  margin: 10px 0 0;
  padding: 9px 12px 9px 28px;
  background: #fdeae6;
  border: 1px solid #eab4a8;
  border-radius: 8px;
  color: #a53e28;
  font-size: 13px;
}
.errors li { margin: 2px 0; }

.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  flex-wrap: wrap;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 14px;
}
button.primary { background: #176b87; color: #fff; }
button.secondary { background: #e8eef5; color: #172033; }
button.ghost { background: transparent; color: #69758c; border: 1px solid #cfd8e5; }
button.small { padding: 6px 10px; font-size: 12px; }
.tip { color: #14724f; font-size: 13px; }

.versions { margin-top: 16px; border-top: 1px dashed #d9e2ee; padding-top: 12px; }
.versions h4 { margin: 0 0 8px; font-size: 13px; color: #69758c; font-weight: 600; }
.version-item { border: 1px solid #e6ecf4; border-radius: 8px; margin-bottom: 6px; overflow: hidden; }
.version-head {
  width: 100%;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  background: #f7f9fc;
  padding: 8px 12px;
  color: #445069;
  font-size: 13px;
  text-align: left;
  border-radius: 0;
}
.version-head .caret { margin-left: auto; color: #176b87; }
.revise-tag { color: #a53e28; }
.version-body { padding: 10px 12px; }

.row-actions { margin-top: 8px; }
</style>

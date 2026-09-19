<script setup lang="ts">
import { computed } from "vue";
import type { FuelLine } from "../types";
import { ABS_LIMIT, REL_LIMIT, bookStock, checkLine } from "../store";

const props = defineProps<{
  lines: FuelLine[];
  editable?: boolean;
}>();

const editable = computed(() => props.editable !== false);

function num(line: FuelLine, key: "opening" | "inflow" | "sales", value: string) {
  line[key] = value === "" ? 0 : Number(value);
}

function measured(line: FuelLine, value: string) {
  line.measured = value === "" ? null : Number(value);
}

function fmt(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
</script>

<template>
  <div class="fuel-table-wrap">
    <table class="fuel-table">
      <thead>
        <tr>
          <th>油品</th>
          <th>开班罐存 (L)</th>
          <th>进油量 (L)</th>
          <th>销量 (L)</th>
          <th>账面罐存 (L)</th>
          <th>交班实测 (L)</th>
          <th>差额 (L)</th>
          <th>相对差额</th>
          <th class="reason-col">损溢原因</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="line in lines" :key="line.fuel" :class="{ conflict: checkLine(line).overLimit }">
          <td class="fuel-name">{{ line.fuel }}</td>
          <td>
            <input v-if="editable" type="number" min="0" step="0.01" :value="line.opening"
                   @input="num(line, 'opening', ($event.target as HTMLInputElement).value)" />
            <span v-else>{{ fmt(line.opening) }}</span>
          </td>
          <td>
            <input v-if="editable" type="number" min="0" step="0.01" :value="line.inflow"
                   @input="num(line, 'inflow', ($event.target as HTMLInputElement).value)" />
            <span v-else>{{ fmt(line.inflow) }}</span>
          </td>
          <td>
            <input v-if="editable" type="number" min="0" step="0.01" :value="line.sales"
                   @input="num(line, 'sales', ($event.target as HTMLInputElement).value)" />
            <span v-else>{{ fmt(line.sales) }}</span>
          </td>
          <td class="book">{{ fmt(bookStock(line)) }}</td>
          <td>
            <input v-if="editable" type="number" min="0" step="0.01" :value="line.measured ?? ''"
                   placeholder="实测"
                   @input="measured(line, ($event.target as HTMLInputElement).value)" />
            <span v-else>{{ fmt(line.measured) }}</span>
          </td>
          <td :class="checkLine(line).overLimit ? 'diff-bad' : 'diff-ok'">
            {{ fmt(checkLine(line).diff) }}
          </td>
          <td :class="checkLine(line).overLimit ? 'diff-bad' : 'diff-ok'">
            {{ checkLine(line).relDiff === null ? "—" : (checkLine(line).relDiff * 100).toFixed(2) + "%" }}
          </td>
          <td class="reason-col">
            <textarea v-if="editable" v-model="line.lossReason" rows="1"
                      :placeholder="checkLine(line).overLimit ? '超阈值，必填' : '账实相符可留空'" />
            <span v-else>{{ line.lossReason || "—" }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="rule-hint">
      账面罐存 = 开班罐存 + 进油量 − 销量；绝对差额 &gt; {{ ABS_LIMIT }} L 或相对差额 &gt;
      {{ (REL_LIMIT * 100).toFixed(1) }}% 时必须填写损溢原因，否则不能交班。
    </p>
  </div>
</template>

<style scoped>
.fuel-table-wrap { overflow-x: auto; }
.fuel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.fuel-table th, .fuel-table td {
  border: 1px solid #dfe7f1;
  padding: 7px 9px;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}
.fuel-table th {
  background: #f2f6fb;
  color: #445069;
  font-weight: 600;
}
.fuel-table input {
  width: 100%;
  min-width: 86px;
  padding: 6px 8px;
}
.fuel-table textarea {
  min-width: 150px;
  width: 100%;
  min-height: 34px;
  resize: vertical;
}
.reason-col { white-space: normal !important; min-width: 170px; }
.fuel-name { font-weight: 700; }
.book { font-variant-numeric: tabular-nums; color: #172033; font-weight: 600; }
.conflict { background: #fdf3f1; }
.diff-bad { color: #c84b31; font-weight: 700; font-variant-numeric: tabular-nums; }
.diff-ok { color: #14724f; font-variant-numeric: tabular-nums; }
.rule-hint {
  margin: 8px 2px 0;
  font-size: 12px;
  color: #8693a8;
}
</style>

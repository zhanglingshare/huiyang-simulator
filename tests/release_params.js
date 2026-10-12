#!/usr/bin/env node
/* release_params.js — 把 evidence/events 中 status=approved 且 parameter_change 非空的事件
   发布为 params.json（参数版本）。无已审核事件时不写文件、exit 0。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const HT = require(path.join(root, 'model.js'));

const evDir = path.join(root, 'evidence', 'events');
if (!fs.existsSync(evDir)) { console.log('无 evidence/events 目录，跳过'); process.exit(0); }
const files = fs.readdirSync(evDir).filter(f => f.endsWith('.json'));
const approved = [];
for (const f of files) {
  let ev;
  try { ev = JSON.parse(fs.readFileSync(path.join(evDir, f), 'utf8')); }
  catch (e) { console.error('✗ ' + f + ' 解析失败: ' + e.message); process.exit(1); }
  if (ev.status === 'approved') {
    if (!ev.parameter_change) { console.error('✗ ' + f + ' status=approved 但缺 parameter_change（禁止无凭据入库）'); process.exit(1); }
    if (ev.requires_review !== true) { console.error('✗ ' + f + ' parameter_change 非空但 requires_review!==true'); process.exit(1); }
    if (!ev.review || !ev.review.reviewer) { console.error('✗ ' + f + ' approved 但 review.reviewer 为空（需人工签名）'); process.exit(1); }
    approved.push(ev);
  }
}
if (!approved.length) { console.log('无已审核事件，未生成 params.json（保持内置默认参数）'); process.exit(0); }

const paths = JSON.parse(JSON.stringify(HT.DEFAULT_PATHS));
const changes = [];
for (const ev of approved) {
  const pc = ev.parameter_change;
  const idx = pc.path_index != null ? pc.path_index : (ev.related_paths || []).map(p => {
    return paths.findIndex(x => x.name === p || x.key === p);
  }).find(n => n >= 0);
  if (idx == null || idx < 0 || idx >= paths.length) { console.error('✗ ' + ev.event_id + ' 无法定位 path_index=' + idx); process.exit(1); }
  const oldMu = paths[idx].mu;
  paths[idx].mu = Math.max(0, oldMu + (pc.mu_delta || 0));
  changes.push({ event_id: ev.event_id, path_index: idx, path_name: paths[idx].name, old_mu: oldMu, new_mu: paths[idx].mu, reason: pc.reason || '', reviewer: ev.review.reviewer });
}
const out = {
  version: 'params-' + new Date().toISOString().slice(0, 10) + '-' + approved.length + 'ev',
  generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  base_note: '基于内置默认参数 + 人工审核事件增量；与模型口径同源（SEED=42）',
  paths,changes
};
fs.writeFileSync(path.join(root, 'params.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('✓ 已生成 params.json：' + changes.map(c => c.label + ' ' + c.old_v + '→' + c.new_v + '（' + c.event_id + '）').join('；'));

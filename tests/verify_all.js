#!/usr/bin/env node
/* verify_all.js — 发布前质量门（语法 + 口径 + 数据 + 证据 四类断言）
   全过 exit 0，任一失败 exit 1。供 GitHub Actions 与本地 `node tests/verify_all.js` 使用。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let fails = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { fails++; console.log('  ✗ ' + m); };

console.log('── 1) HTML 内联 script 语法 ──');
const htmlFiles = ["index.html", "network.html", "who.html", "choices.html", "future.html", "windtunnel.html", "blindspot.html", "report.html", "ending.html", "town.html"];
for (const f of htmlFiles) {
  const fp = path.join(root, f);
  if (!fs.existsSync(fp)) { bad('缺少页面文件 ' + f); continue; }
  const html = fs.readFileSync(fp, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((code, i) => { try { new Function(code); } catch (e) { bad(f + ' 第' + (i + 1) + '个script块语法错误: ' + e.message); } });
  ok(f + '（' + blocks.length + ' 块）');
}

console.log('── 2) 模型口径断言（SEED=42 N=10000，与页面口径同源）──');
const HT = require(path.join(root, 'model.js'));
const SEED = 42, N = 10000;
const res = HT.run(SEED, N, HT.DEFAULT_PATHS);
const near = (a, b, t) => Math.abs(a - b) <= t;
if (!near(res.p10, 1344, 8)) bad('p10 应≈1344，实际 ' + Math.round(res.p10));
else ok('p10 = ' + Math.round(res.p10));
if (!near(res.p50, 1474, 8)) bad('p50 应≈1474，实际 ' + Math.round(res.p50));
else ok('p50 = ' + Math.round(res.p50));
if (!near(res.p90, 1603, 8)) bad('p90 应≈1603，实际 ' + Math.round(res.p90));
else ok('p90 = ' + Math.round(res.p90));
if (!near(res.hit, 39.6, 1.2)) bad('hit 应≈39.6%，实际 ' + res.hit.toFixed(2) + '%');
else ok('hit = ' + res.hit.toFixed(2) + '%');
if (!near(HT.BASE, 878.04, 0.05)) bad('BASE 应≈878.04，实际 ' + HT.BASE);
else ok('BASE = ' + HT.BASE);
if (HT.TARGET !== 1500) bad('TARGET 应=1500，实际 ' + HT.TARGET);
else ok('TARGET = ' + HT.TARGET);

console.log('── 3) 每日数据文件（v2 审计字段）──');
for (const f of ['hot.json', 'life.json']) {
  const fp = path.join(root, f);
  if (!fs.existsSync(fp)) { bad('缺少 ' + f); continue; }
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!d.updated) bad(f + ' 缺 updated');
    if (d.schema_version !== 2) bad(f + ' schema_version 应为 2，实际 ' + d.schema_version);
    if (!d.fetched_at) bad(f + ' 缺 fetched_at');
    if (!Array.isArray(d.items) && !Array.isArray(d.spots) && !Array.isArray(d.towns)) bad(f + ' 缺主体数组');
    if (f === 'hot.json' && d.items.some(x => !x.url || !x.source)) bad('hot.json 存在缺 url/source 条目');
    if (f === 'hot.json' && d.items.some(x => !x.verified_status)) bad('hot.json 存在缺 verified_status 条目');
    const arr = d.items || d.spots || d.towns || [];
    ok(f + ' 可解析 v2（updated=' + d.updated + '，' + arr.length + '条）');
  } catch (e) { bad(f + ' JSON 解析失败: ' + e.message); }
}

console.log('── 4) 事件证据库（evidence/events/*.json）──');
const evDir = path.join(root, 'evidence', 'events');
const evFiles = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter(f => f.endsWith('.json')) : [];
const reqFields = ['event_id','region','event_type','subject','source_url','evidence_level','status','related_paths','parameter_change','requires_review'];
const evIds = new Set();
if (!evFiles.length) ok('暂无候选事件（目录存在即可，不视为失败）');
for (const f of evFiles) {
  try {
    const ev = JSON.parse(fs.readFileSync(path.join(evDir, f), 'utf8'));
    for (const k of reqFields) if (!(k in ev)) bad(f + ' 缺字段 ' + k);
    if (evIds.has(ev.event_id)) bad(f + ' event_id 重复: ' + ev.event_id);
    evIds.add(ev.event_id);
    if (ev.status === 'approved' && ev.parameter_change == null) bad(f + ' approved 但 parameter_change 为 null（禁止无凭据入库）');
    if (ev.status !== 'rejected' && ev.parameter_change != null && ev.requires_review !== true) bad(f + ' parameter_change 非空但未标 requires_review');
    ok(f + '（' + ev.event_id + ' · ' + ev.status + '）');
  } catch (e) { bad(f + ' 解析失败: ' + e.message); }
}

console.log(fails ? '\n✗ 共 ' + fails + ' 项失败' : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);

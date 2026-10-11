/* ============================================================
 * model.js —— 惠阳产业风洞 统一模型内核
 * future / windtunnel / report / choices 共用这一份。
 *
 * 口径：
 *  - BASE 878.04 亿：惠阳 2025 年地区生产总值现实锚点
 *  - TARGET 1500 亿：惠阳“十五五”规划提出的力争目标（官方参考目标）
 *  - 五条路径 μ/σ：模型设定的情景参数，非实测
 *  - 全局噪声：加性，模型设定的外部冲击波动
 *  - 命门“邻”：惠阳与深圳一路之隔，电子信息、光学制造高度联动
 *    深圳与海外市场；风洞按“外部需求一回调（订单脉冲）+ 恢复”
 *    测算，属于经济外溢的传导型冲击，区别于自然灾害与日常拥堵。
 * ============================================================ */
const HT = {
  BASE: 878.04,
  TARGET: 1500,
  NOISE_SD: 32,
  DEFAULT_PATHS: [
    {mu: 260, sd: 70, name: '电子信息', color: '#ea580c'},
    {mu: 130, sd: 45, name: 'AI机器人', color: '#f59e0b'},
    {mu: 110, sd: 38, name: '汽车光学', color: '#0ea5e9'},
    {mu: 60,  sd: 22, name: '吉他时尚', color: '#ec4899'},
    {mu: 35,  sd: 12, name: '都市农业', color: '#22c55e'}
  ],

  // 基本面事实（均来自 2025 统计公报 / 2026 政府工作报告公开口径）
  FACTS: {
    gdp: 878.04, growth: 3.3, pop: 95.98,
    ind: {p1: 29.40, p2: 570.43, p3: 278.21},
    industry: 2088.8, industryGrowth: 4.1, vaGrowth: 7.2,
    advanced: 71.2, highTech: 58.3,
    retail: 249.57, budget: 50.3,
    electronics2025: 1200, electronicsTarget: 1350,
    ndTourists: 38.16, ndOvernight: 6.1468,
    ndIncome: 1.469
  },

  // 外部需求回调参数（模型情景，用于风洞校准；非特定真实事件预报）
  DEMAND: {
    name: '外部需求回调',
    note: '深圳与海外消费电子、光学订单一次明显回落，订单脉冲后逐周恢复',
    expo: {elec: 2.2, auto: 0.8, other: 0.2}, // 各线月度外部敞口（亿，模型估算）
    rebook: 0.4,                              // 订单延后可回补比例
    housingSens: 40,                          // 置业居住景气对2030的敏感度
    railBoost: 8                              // 跨城轨道贯通的提振
  },

  mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  },
  makeRandn(prng) {
    return function () {
      let u = 0, v = 0;
      while (u === 0) u = prng();
      while (v === 0) v = prng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
  },
  quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  },
  corr(xs, ys) {
    const n = xs.length;
    let mx = 0, my = 0;
    for (let k = 0; k < n; k++) { mx += xs[k]; my += ys[k]; }
    mx /= n; my /= n;
    let num = 0, dx = 0, dy = 0;
    for (let k = 0; k < n; k++) {
      num += (xs[k] - mx) * (ys[k] - my);
      dx += (xs[k] - mx) * (xs[k] - mx);
      dy += (ys[k] - my) * (ys[k] - my);
    }
    return num / Math.sqrt(dx * dy);
  },

  // 一次外部需求回调的净损失（亿）：电子信息 + 汽车光学为主（扣回补）
  demandLoss(strength, duration) {
    const D = this.DEMAND;
    strength = strength == null ? 1 : strength;
    duration = duration == null ? 3 : duration;
    const f = duration * (1 - D.rebook) * strength;
    const elec = D.expo.elec * f;
    const auto = D.expo.auto * f;
    const other = D.expo.other * f;
    return {elec, auto, other, total: elec + auto + other};
  },

  // 订单/开工脉冲后的恢复曲线（周）：当周谷底，逐周回升，约 6–9 周回到趋势
  demandCurve(strength) {
    strength = strength == null ? 1 : strength;
    const weeks = [], loss = [];
    const trough = Math.min(95, 50 + strength * 35); // 当周开工/订单损失幅度%
    for (let w = 0; w <= 8; w++) {
      weeks.push('第' + w + '周');
      let v;
      if (w === 0) v = trough;
      else v = trough * Math.exp(-0.7 * w);   // 指数恢复
      loss.push(+Math.max(0, v).toFixed(1));
    }
    return {weeks, loss};
  },

  run(seed, N, paths, opts = {}) {
    const base = opts.base != null ? opts.base : this.BASE;
    const target = opts.target != null ? opts.target : this.TARGET;
    const noise = opts.noise != null ? opts.noise : this.NOISE_SD;
    // 路径深拷贝，允许按情景调整 μ
    const P = paths.map(p => Object.assign({}, p));
    // 链主（光学/电子大块头）扩产或外迁：影响电子信息与汽车光学
    if (opts.anchorFactor != null) {
      const af = opts.anchorFactor;
      P.filter(x => x.name === '电子信息' || x.name === '汽车光学')
        .forEach(x => { x.mu = Math.max(0, x.mu * af); });
    }
    // 外部需求回调脉冲
    let demand = null;
    if (opts.demand) {
      demand = this.demandLoss(opts.demand.strength, opts.demand.duration);
    }
    const prng = this.mulberry32(seed), randn = this.makeRandn(prng);
    const raw = [], sorted = [], contribs = P.map(() => []);
    for (let i = 0; i < N; i++) {
      let total = base;
      for (let j = 0; j < P.length; j++) {
        let v = P[j].mu + randn() * P[j].sd;
        if (v < 0) v = 0;
        total += v;
        contribs[j].push(v);
      }
      if (demand) total -= demand.total;      // 外部需求脉冲净损失（已含回补）
      // 置业居住景气（房地产相关，慢变量）
      if (opts.housingFactor != null) {
        total += (opts.housingFactor - 1) * this.DEMAND.housingSens;
      }
      // 跨城轨道贯通提振
      if (opts.rail) total += this.DEMAND.railBoost;
      total += randn() * noise;
      raw.push(total);
      sorted.push(total);
    }
    sorted.sort((a, b) => a - b);
    return {
      p10: this.quantile(sorted, 0.10),
      p50: this.quantile(sorted, 0.50),
      p90: this.quantile(sorted, 0.90),
      hit: sorted.filter(x => x >= target).length / N * 100,
      coefs: contribs.map(c => Math.abs(this.corr(c, raw))),
      results: sorted,
      rawResults: raw,
      demand
    };
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = HT;

// ThermaSight — ML models, pure TypeScript, deterministic seeds, run entirely
// in the browser so the pipeline is deployable anywhere and auditable.
//
// 1) Isolation Forest: unsupervised isolation of structurally unusual rows
//    (interaction effects across all measurements at once).
// 2) Residual MLP: predicts expected energy from operating context
//    (load, water temperatures, ambient conditions, dynamics); deviations of
//    actual energy from the reconstruction are contextual anomalies.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: () => number): number {
  let u = 0;
  do {
    u = rng();
  } while (u === 0);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Isolation Forest
// ---------------------------------------------------------------------------

type IFNode = { feat: number; thr: number; left: number; right: number } | { size: number };

export class IsolationForest {
  private trees: IFNode[][] = [];
  private sampleSize = 256;
  private limit = 0;
  private d = 0;

  fit(X: number[][], nTrees = 80, maxSamples = 256, seed = 7): void {
    const n = X.length;
    this.sampleSize = Math.min(maxSamples, Math.max(2, n));
    this.limit = Math.ceil(Math.log2(Math.max(2, this.sampleSize))) + 2;
    this.d = X[0]?.length ?? 0;
    const rng = mulberry32(seed);
    this.trees = [];
    const universe = X.map((_, i) => i);

    for (let t = 0; t < nTrees; t++) {
      const idxs: number[] = [];
      for (let k = 0; k < this.sampleSize; k++) {
        idxs.push(universe[Math.floor(rng() * universe.length)]);
      }
      const nodes: IFNode[] = [];
      this.buildTree(X, idxs, 0, nodes, rng);
      this.trees.push(nodes);
    }
  }

  private buildTree(X: number[][], idxs: number[], depth: number, nodes: IFNode[], rng: () => number): number {
    if (depth >= this.limit || idxs.length <= 1) {
      nodes.push({ size: idxs.length });
      return nodes.length - 1;
    }
    const f = Math.floor(rng() * this.d);
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of idxs) {
      const v = X[i][f];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1e-12) {
      nodes.push({ size: idxs.length });
      return nodes.length - 1;
    }
    let thr = lo + rng() * (hi - lo);
    let left: number[] = [];
    let right: number[] = [];
    for (let attempt = 0; attempt < 8 && (left.length === 0 || right.length === 0); attempt++) {
      left = [];
      right = [];
      thr = lo + rng() * (hi - lo);
      for (const i of idxs) {
        if (X[i][f] < thr) left.push(i);
        else right.push(i);
      }
    }
    if (left.length === 0 || right.length === 0) {
      nodes.push({ size: idxs.length });
      return nodes.length - 1;
    }
    const nodeIdx = nodes.length;
    nodes.push({ feat: f, thr, left: -1, right: -1 });
    const l = this.buildTree(X, left, depth + 1, nodes, rng);
    const r = this.buildTree(X, right, depth + 1, nodes, rng);
    nodes[nodeIdx] = { feat: f, thr, left: l, right: r };
    return nodeIdx;
  }

  private c(n: number): number {
    if (n <= 1) return 1;
    return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
  }

  private path(nodes: IFNode[], x: number[]): number {
    let idx = 0;
    let depth = 0;
    for (;;) {
      const nd = nodes[idx];
      if ("size" in nd) return depth + this.c(nd.size);
      depth++;
      if (x[nd.feat] < nd.thr) idx = nd.left;
      else idx = nd.right;
    }
  }

  /** Anomaly score in (0, 1]; higher = more isolated/abnormal. */
  score(X: number[][]): number[] {
    const c = this.c(this.sampleSize);
    const out = new Array<number>(X.length).fill(0);
    if (!this.trees.length) return out;
    const t = this.trees[0];
    for (let i = 0; i < X.length; i++) {
      if (X[i].length !== this.d) continue;
      let sum = 0;
      for (const nodes of this.trees) sum += this.path(nodes, X[i]);
      const avg = sum / this.trees.length;
      out[i] = Math.pow(2, -avg / c);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// MLP regressor (residual model): expected energy from operating context
// ---------------------------------------------------------------------------

export interface MLPResult {
  trainLoss: number;
  valLoss: number;
  epochs: number;
}

export class MLPRegressor {
  private hidden = 24;
  private W1: number[][] = [];
  private b1: number[] = [];
  private W2: number[] = [];
  private b2 = 0;
  private fitted = false;

  fit(
    X: number[][],
    y: number[],
    opts: { epochs?: number; lr?: number; momentum?: number; batch?: number; seed?: number; patience?: number } = {},
  ): MLPResult {
    const { epochs = 150, lr = 0.02, momentum = 0.9, batch = 48, seed = 11, patience = 22 } = opts;
    const n = X.length;
    const d = X[0]?.length ?? 0;
    const h = this.hidden;
    const rng = mulberry32(seed);

    // He-ish init scaled down for stability.
    const w1: number[][] = [];
    for (let j = 0; j < d; j++) {
      const row: number[] = [];
      for (let k = 0; k < h; k++) row.push((rng() * 2 - 1) * Math.sqrt(2 / d) * 0.5);
      w1.push(row);
    }
    const W1 = w1;
    const b1 = new Array<number>(h).fill(0);
    const W2 = new Array<number>(h).fill(0).map(() => (rng() * 2 - 1) * Math.sqrt(2 / h) * 0.5);
    let b2 = 0;

    // Train / validation split.
    const order = X.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const valCount = Math.max(1, Math.floor(n * 0.1));
    const trainIdx = order.slice(0, n - valCount);
    const valIdx = order.slice(n - valCount);

    const predictBatch = (rows: number[]): number[] => {
      const out: number[] = [];
      for (const r of rows) {
        const x = X[r];
        let acc = b2;
        for (let k = 0; k < h; k++) {
          let a = b1[k];
          for (let j = 0; j < d; j++) a += x[j] * W1[j][k];
          const act = a > 0 ? a : 0;
          acc += act * W2[k];
        }
        out.push(acc);
      }
      return out;
    };
    const mse = (rows: number[]): number => {
      const p = predictBatch(rows);
      let s = 0;
      for (let i = 0; i < rows.length; i++) {
        const e = p[i] - y[rows[i]];
        s += e * e;
      }
      return rows.length ? s / rows.length : 0;
    };

    let vW1 = W1.map((r) => r.map(() => 0));
    let vb1 = b1.map(() => 0);
    let vW2 = W2.map(() => 0);
    let vb2 = 0;

    let bestVal = Infinity;
    let bestW1 = W1.map((r) => r.slice());
    let bestb1 = b1.slice();
    let bestW2 = W2.slice();
    let bestb2 = b2;
    let badEpochs = 0;
    let done = 0;

    for (let ep = 0; ep < epochs; ep++) {
      const perm = trainIdx.slice();
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      for (let b = 0; b < perm.length; b += batch) {
        const rows = perm.slice(b, b + batch);
        // Gradient accumulation (per-sample SGD backward).
        const gW1 = W1.map((r) => r.map(() => 0));
        const gb1 = b1.map(() => 0);
        const gW2 = W2.map(() => 0);
        let gb2 = 0;
        for (const r of rows) {
          const x = X[r];
          const act = new Array<number>(h);
          for (let k = 0; k < h; k++) {
            let a = b1[k];
            for (let j = 0; j < d; j++) a += x[j] * W1[j][k];
            act[k] = a > 0 ? a : 0;
          }
          let out = b2;
          for (let k = 0; k < h; k++) out += act[k] * W2[k];
          const err = out - y[r];
          gb2 += err;
          for (let k = 0; k < h; k++) {
            const gOut = err * act[k];
            gW2[k] += gOut;
            const gAct = err * W2[k] * (act[k] > 0 ? 1 : 0);
            gb1[k] += gAct;
            for (let j = 0; j < d; j++) gW1[j][k] += gAct * x[j];
          }
        }
        const s = rows.length;
        // Gradient clipping (per-layer max norm) keeps the small net stable.
        let maxAbs = 1e-9;
        for (let k = 0; k < h; k++) {
          maxAbs = Math.max(maxAbs, Math.abs(gW2[k]), Math.abs(gb1[k]));
          for (let j = 0; j < d; j++) maxAbs = Math.max(maxAbs, Math.abs(gW1[j][k]));
        }
        const clip = maxAbs > 40 ? 40 / maxAbs : 1;
        for (let k = 0; k < h; k++) {
          vb2 = momentum * vb2 + (lr * gb2 * clip) / s;
          b2 -= vb2;
          vb1[k] = momentum * vb1[k] + (lr * gb1[k] * clip) / s;
          b1[k] -= vb1[k];
          vW2[k] = momentum * vW2[k] + (lr * gW2[k] * clip) / s;
          W2[k] -= vW2[k];
          for (let j = 0; j < d; j++) {
            vW1[j][k] = momentum * vW1[j][k] + (lr * gW1[j][k] * clip) / s;
            W1[j][k] -= vW1[j][k];
          }
        }
      }
      const vl = mse(valIdx);
      done = ep + 1;
      if (vl < bestVal - 1e-4) {
        bestVal = vl;
        badEpochs = 0;
        bestW1 = W1.map((r) => r.slice());
        bestb1 = b1.slice();
        bestW2 = W2.slice();
        bestb2 = b2;
      } else if (++badEpochs >= patience) {
        break;
      }
    }

    this.W1 = bestW1;
    this.b1 = bestb1;
    this.W2 = bestW2;
    this.b2 = bestb2;
    this.fitted = true;
    return { trainLoss: mse(trainIdx), valLoss: bestVal, epochs: done };
  }

  predict(X: number[][]): number[] {
    if (!this.fitted) return new Array<number>(X.length).fill(0);
    const { W1, b1, W2, b2, hidden: h } = this;
    const d = W1.length;
    return X.map((x) => {
      let acc = b2;
      for (let k = 0; k < h; k++) {
        let a = b1[k];
        for (let j = 0; j < d; j++) a += x[j] * W1[j][k];
        const act = a > 0 ? a : 0;
        acc += act * W2[k];
      }
      return acc;
    });
  }
}

// ---------------------------------------------------------------------------
// Rank correlation (degradation trend detection)
// ---------------------------------------------------------------------------

export function spearman(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const rank = (a: number[]): number[] => {
    const idx = a.map((_, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += rx[i];
    my += ry[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const adx = rx[i] - mx;
    const ady = ry[i] - my;
    num += adx * ady;
    dx += adx * adx;
    dy += ady * ady;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export function quantileSorted(arr: number[], q: number): number {
  if (!arr.length) return 0;
  const pos = (arr.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = arr[lo];
  const b = arr[hi];
  return a + (b - a) * (pos - lo);
}
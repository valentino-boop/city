/* 서울 유동인구 · 3D 시티맵
   MapLibre GL JS + 커스텀 WebGL 도로(유동인구)·야간 조명 레이어 */
(function () {
  'use strict';

  const CENTER = [126.9780, 37.5665];
  const QS = 1.5;                                  // metres per quantisation unit
  const MLON = 111320 * Math.cos(CENTER[1] * Math.PI / 180);
  const MLAT = 110574;
  const DATA = 'data/';
  const Q = new URLSearchParams(location.search);
  const OFF = (Q.get('off') || '').split(',');
  const on = (k) => OFF.indexOf(k) < 0;

  /* ---------------------------------------------------------------- colour utils */
  const hx = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const toHex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('');
  const mixc = (a, b, t) => { const A = hx(a), B = hx(b);
    return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); };
  const mixa = (a, b, t) => a.map((v, i) => mixc(v, b[i], t));

  /* ---------------------------------------------------------------- palettes */
  // 도로 유동인구 16단계 (한산 → 번잡)
  const RAMP_DAY = ['#ECE6D7', '#ECE5D5', '#ECE3D2', '#EBE0CE', '#EADCC9', '#E8D8C3',
    '#E5D3BC', '#E1CCB2', '#DBC3A5', '#D3B795', '#C9A785', '#BE9576', '#B27F66',
    '#C0695A', '#A94F47', '#933B37'];
  const RAMP_NIGHT = ['#0C1826', '#0E1E2D', '#102634', '#14303A', '#1B3C3D', '#2A4A3C',
    '#4C5434', '#7A5F2C', '#A06A28', '#C1762A', '#DC8230', '#F08B39', '#FB8B41',
    '#FF7C45', '#FF6844', '#FF5544'];

  // 건물 용도·높이·면적별 16색 (따뜻한 건축 일러스트 톤)
  const BLD0 = ['#BE7038', '#CE8452', '#A85B33', '#E3C79B', '#D8BE96', '#EDD8B4',
    '#C9B183', '#B9A176', '#7E97AD', '#6C87A0', '#4E6B85', '#9FB2C0',
    '#D2C9B6', '#D2AE7D', '#B08858', '#EDE2CC'];
  // 벽면 음영으로 어두워지는 만큼 밝게 보정
  const BLD = BLD0.map((c, i) => mixc(c, i >= 8 && i < 12 ? '#eef4f8' : '#fff8ec', 0.10));

  const DAY = {
    bg: '#F2EBDF', ground: '#EFE8DA',
    grass: '#D3DCC2', park: '#C9D7B4', wood: '#C4D3AF',
    water: '#AFCCDA', river: '#9BC0CE', bound: '#BFB49D',
    relief: [[0, '#F1EBDF'], [30, '#EDE6D7'], [90, '#E7DDCA'], [200, '#DFD2B9'],
      [420, '#D2C2A3'], [700, '#C0AD8B'], [950, '#AC9773']],
    hill: { exag: 0.5, high: '#FFF7E9', shadow: '#BFB29B', accent: '#A99A80' },
    light: { color: '#FFFAF0', intensity: 0.34, pos: [1.15, 220, 40] },
    ramp: RAMP_DAY,
    casing: '#FFFFFF', casingOp: 0.5, glowOp: 0.14, coreOp: 0.96,
    edge: '#FFFFFF', edgeOp: 0.56, edgeBlur: 0,
    ink: '#24282f', sub: '#6d7683', panel: 'rgba(255,252,246,0.80)',
    panel2: 'rgba(255,252,246,0.55)', line: 'rgba(74,62,45,0.14)', accent: '#c15f3c',
    accentSoft: 'rgba(193,95,60,0.16)', thumb: '#ffffff', shadow: '0 12px 40px rgba(58,44,26,0.18)',
    lights: 0
  };
  // 밤: 건물이 까맣게 묻히지 않도록 달빛(차가운 흰빛)을 세게, 발광은 은은하게
  const NIGHT = {
    bg: '#05090F', ground: '#0A1220',
    grass: '#0C1A1E', park: '#0E1F1E', wood: '#0B1A1B',
    water: '#071627', river: '#0A1F33', bound: '#1D2C3E',
    relief: [[0, '#0B1522'], [30, '#0E1A28'], [90, '#12202F'], [200, '#172736'],
      [420, '#1C2E3F'], [700, '#223448'], [950, '#283B50']],
    hill: { exag: 0.42, high: '#33455E', shadow: '#010409', accent: '#0A1119' },
    light: { color: '#B3A896', intensity: 0.42, pos: [1.25, 232, 58] },
    ramp: RAMP_NIGHT,
    casing: '#0B1622', casingOp: 0.4, glowOp: 0.34, coreOp: 1,
    edge: '#FFB27A', edgeOp: 0.16, edgeBlur: 0,
    ink: '#eaf2ff', sub: '#93a6c1', panel: 'rgba(9,14,25,0.74)',
    panel2: 'rgba(9,14,25,0.5)', line: 'rgba(130,170,220,0.20)', accent: '#ff9a5a',
    accentSoft: 'rgba(255,154,90,0.18)', thumb: '#fff3e2', shadow: '0 14px 46px rgba(0,0,0,0.55)',
    lights: 1
  };

  const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  // 해 진 뒤(17:40) ~ 완전한 밤(19:40), 새벽(05:20) ~ 해 뜬 뒤(07:00)
  function nightFactor(h) {
    if (h >= 19.7 || h < 5.3) return 1;
    if (h < 7.2) return 1 - smooth((h - 5.3) / 1.9);
    if (h < 17.6) return 0;
    return smooth((h - 17.6) / 2.1);
  }

  function themeAt(t) {
    const T = {};
    for (const k in DAY) {
      const a = DAY[k], b = NIGHT[k];
      if (typeof a === 'string' && a[0] === '#') T[k] = mixc(a, b, t);
      else if (typeof a === 'number') T[k] = a + (b - a) * t;
      else if (Array.isArray(a) && Array.isArray(a[0])) T[k] = a.map((v, i) => [v[0], mixc(v[1], b[i][1], t)]);
      else if (Array.isArray(a)) T[k] = mixa(a, b, t);
      else if (typeof a === 'object') {
        T[k] = {};
        for (const j in a) {
          const x = a[j], y = b[j];
          if (Array.isArray(x)) T[k][j] = x.map((v, i) => v + (y[i] - v) * t);
          else if (typeof x === 'number') T[k][j] = x + (y - x) * t;
          else T[k][j] = mixc(x, y, t);
        }
      } else T[k] = t < 0.5 ? a : b;
    }
    // 해 질 녘 따뜻한 빛
    const gold = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * (t > 0.02 ? 1 : 0);
    if (gold > 0) {
      T.bg = mixc(T.bg, '#EDA26D', 0.55 * gold);
      T.ground = mixc(T.ground, '#D79B7C', 0.45 * gold);
      T.grass = mixc(T.grass, '#C0A078', 0.42 * gold);
      T.park = mixc(T.park, '#B89A70', 0.42 * gold);
      T.water = mixc(T.water, '#B3928F', 0.35 * gold);
      T.light.color = mixc(T.light.color, '#FFB884', 0.7 * gold);
      T.relief = T.relief.map(([e, c]) => [e, mixc(c, '#E0AA80', 0.45 * gold)]);
    }
    T.style = ['ink', 'sub', 'panel', 'panel2', 'line', 'accent', 'accentSoft', 'thumb', 'shadow'];
    return T;
  }

  /* ---------------------------------------------------------------- state */
  let map = null, ready = false;
  let hourF = 15, day = 0, mode = 'auto', playing = false;
  let nightT = 0, appliedT = -1;
  let buildings = null, roads = null, water = null, lightPoints = null;
  let roadMesh = null, roadLayer = null;
  const roadStyle = { ramp: new Float32Array(48), glow: 0, core: 1 };

  const $ = (id) => document.getElementById(id);
  const stat = (msg, pct) => { $('stat').textContent = msg; if (pct != null) $('barfill').style.width = pct + '%'; };

  /* ---------------------------------------------------------------- data */
  function loadBuffer(name, onProgress) {
    return fetch(DATA + name).then(r => {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      if (!r.body || !r.body.getReader) return r.arrayBuffer();
      const total = +(r.headers.get('content-length') || 0);
      const reader = r.body.getReader();
      const chunks = []; let got = 0;
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) {
          const out = new Uint8Array(got);
          let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
          return out.buffer;
        }
        chunks.push(value); got += value.length;
        if (onProgress && total) onProgress(got / total);
        return pump();
      });
      return pump();
    });
  }

  function decodeBuildings(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const major = [], minor = [];
    let p = 0;
    const L = u8.length;
    const lon0 = CENTER[0], lat0 = CENTER[1];
    while (p + 3 <= L) {
      const n = u8[p], h = u8[p + 1], c = u8[p + 2];
      p += 3;
      if (n < 3) break;
      const ring = new Array(n + 1);
      for (let i = 0; i < n; i++) {
        const x = dv.getInt16(p, true), y = dv.getInt16(p + 2, true);
        p += 4;
        ring[i] = [lon0 + x * QS / MLON, lat0 + y * QS / MLAT];
      }
      ring[n] = on('copyring') ? [ring[0][0], ring[0][1]] : ring[0];
      const f = { type: 'Feature', properties: { h: h, c: c },
        geometry: { type: 'Polygon', coordinates: [ring] } };
      (h >= 12 ? major : minor).push(f);
    }
    console.log('buildings', major.length, '+', minor.length);
    return { major: { type: 'FeatureCollection', features: major },
             minor: { type: 'FeatureCollection', features: minor } };
  }

  // 24개 시간 니블(4비트)을 4시간씩 묶어 16비트 정수 6개로 — WebGL float32 정밀도(24비트) 안전
  function packVals(nib) {
    const out = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 24; i++) {
      const byte = nib[i >> 1];
      const v = (i & 1) ? (byte & 15) : (byte >> 4);
      out[i >> 2] += v * Math.pow(16, i & 3);
    }
    return out;
  }

  const RW = { 0: 5.0, 1: 4.2, 2: 3.4, 3: 2.8, 4: 2.3, 5: 1.7, 6: 1.6, 7: 1.4, 8: 1.3, 9: 1.2,
    10: 1.1, 11: 1.1, 12: 1.0, 15: 5.0, 16: 4.2, 17: 3.4, 18: 2.8, 19: 2.3 };

  const MAJOR_K = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1 };

  /* GeoJSON 경로(폴백/비교용): data-driven paint */
  function decodeRoads(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const major = [], minor = [];
    let p = 0; const L = u8.length;
    const lon0 = CENTER[0], lat0 = CENTER[1];
    while (p + 2 <= L) {
      const n = u8[p], k = u8[p + 1];
      p += 2;
      if (n < 2) break;
      const line = new Array(n);
      for (let i = 0; i < n; i++) {
        const x = dv.getInt16(p, true), y = dv.getInt16(p + 2, true);
        p += 4;
        line[i] = [lon0 + x * QS / MLON, lat0 + y * QS / MLAT];
      }
      const w = packVals(u8.subarray(p, p + 12)); p += 12;
      const e = packVals(u8.subarray(p, p + 12)); p += 12;
      (MAJOR_K[k] ? major : minor).push({ type: 'Feature',
        properties: { k: k, w: RW[k] || 1.15,
          p0: w[0], p1: w[1], p2: w[2], p3: w[3], p4: w[4], p5: w[5],
          q0: e[0], q1: e[1], q2: e[2], q3: e[3], q4: e[4], q5: e[5] },
        geometry: { type: 'LineString', coordinates: line } });
    }
    console.log('roads', major.length, '+', minor.length);
    return { major: { type: 'FeatureCollection', features: major },
             minor: { type: 'FeatureCollection', features: minor } };
  }

  /* ---------------------------------------------------------------- road mesh (GPU) */
  // 도로 세그먼트를 셰이더용 삼각형 메시로 굽는다.
  //  정점 8바이트: [pos x,y:int16(QS단위)] [dir x,y:int8(수직 단위벡터)] [hw:uint8(0.02px)] [side:uint8]
  //  레벨 버퍼 1바이트/정점: 유동인구 칸(0~240 = 레벨×16) → 셰이더가 16단계 램프를 연속 보간
  function buildRoadMesh(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const L = u8.length;
    let p = 0;
    const feats = [];
    while (p + 2 <= L) {
      const n = u8[p], k = u8[p + 1];
      p += 2;
      if (n < 2) break;
      const at = p; p += 4 * n;
      const blk = u8.subarray(p, p + 24); p += 24;
      feats.push({ k: k, n: n, at: at, blk: blk, major: !!MAJOR_K[k] });
    }
    let nM = 0, nm = 0;
    for (let i = 0; i < feats.length; i++) { if (feats[i].major) nM += feats[i].n - 1; else nm += feats[i].n - 1; }
    const nSeg = nM + nm;
    const geom = new ArrayBuffer(nSeg * 4 * 8);
    const i16 = new Int16Array(geom), i8 = new Int8Array(geom), ub = new Uint8Array(geom);
    const idx = new Uint32Array(nSeg * 6);
    const blocks = new Uint8Array(nSeg * 24);
    const levels = new Uint8Array(nSeg * 4);

    let seg = 0;
    function emit(f) {
      const hwBox = Math.max(2, Math.min(255, Math.round((0.5 + (RW[f.k] || 1.15)) * 20)));
      let px = 0, py = 0;
      for (let i = 0; i < f.n; i++) {
        const x = dv.getInt16(f.at + i * 4, true), y = dv.getInt16(f.at + i * 4 + 2, true);
        if (i === 0) { px = x; py = y; continue; }
        const dx = x - px, dy = y - py;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = Math.round(-dy / len * 127), ny = Math.round(dx / len * 127);
        const v = seg * 4;
        i16[v * 4] = px; i16[v * 4 + 1] = py;
        i16[(v + 1) * 4] = px; i16[(v + 1) * 4 + 1] = py;
        i16[(v + 2) * 4] = x; i16[(v + 2) * 4 + 1] = y;
        i16[(v + 3) * 4] = x; i16[(v + 3) * 4 + 1] = y;
        i8[v * 8 + 4] = -nx; i8[v * 8 + 5] = -ny;
        i8[(v + 1) * 8 + 4] = nx; i8[(v + 1) * 8 + 5] = ny;
        i8[(v + 2) * 8 + 4] = -nx; i8[(v + 2) * 8 + 5] = -ny;
        i8[(v + 3) * 8 + 4] = nx; i8[(v + 3) * 8 + 5] = ny;
        for (let j = 0; j < 4; j++) { ub[(v + j) * 8 + 6] = hwBox; ub[(v + j) * 8 + 7] = (j & 1); }
        const o = seg * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
        blocks.set(f.blk, seg * 24);
        seg++;
        px = x; py = y;
      }
    }
    for (let i = 0; i < feats.length; i++) if (feats[i].major) emit(feats[i]);
    for (let i = 0; i < feats.length; i++) if (!feats[i].major) emit(feats[i]);
    console.log('road mesh', Math.round(geom.byteLength / 1048576 * 10) / 10 + 'MB',
      'segments', nSeg, '(major', nM + ')');
    return { geom: geom, idx: idx, blocks: blocks, levels: levels, nSeg: nSeg,
      majorIdx: nM * 6, minorIdx: nm * 6, verts: nSeg * 4 };
  }

  // hourF에 맞춰 정점별 레벨 바이트를 갱신 (도로 paint 재계산 없이 버퍼만 갱신)
  let lastLevelKey = '';
  function updateRoadLevels(force) {
    if (!roadMesh || !roadLayer || !on('roadpaint')) return;
    const q = Math.round(hourF * 12);              // 약 5분 단위로 양자화
    const key = q + '_' + day;
    if (!force && key === lastLevelKey) return;
    lastLevelKey = key;
    const hf = ((q / 12) % 24 + 24) % 24;
    const h0 = Math.floor(hf) % 24, fr = hf - Math.floor(hf), h1 = (h0 + 1) % 24;
    const bo = day ? 12 : 0;
    const o0 = bo + (h0 >> 1), o1 = bo + (h1 >> 1);
    const hi0 = (h0 & 1) === 0, hi1 = (h1 & 1) === 0;
    const blocks = roadMesh.blocks, out32 = roadMesh.out32;
    const n = roadMesh.nSeg;
    for (let s = 0; s < n; s++) {
      const b = s * 24;
      const b0 = blocks[b + o0], b1 = blocks[b + o1];
      const a = hi0 ? (b0 >> 4) : (b0 & 15);
      const c = hi1 ? (b1 >> 4) : (b1 & 15);
      if (fr === 0 || a === c) { out32[s] = (a * 16) * 0x01010101; }
      else { out32[s] = (((a + (c - a) * fr) * 16) | 0) * 0x01010101; }
    }
    roadLayer.updateLevels(roadMesh.levels);
  }

  function updateRoadStyle() {
    const t = nightT;
    const A = RAMP_DAY, B = RAMP_NIGHT;
    for (let i = 0; i < 16; i++) {
      const c = mixc(A[i], B[i], t), rgb = hx(c);
      roadStyle.ramp[i * 3] = rgb[0] / 255;
      roadStyle.ramp[i * 3 + 1] = rgb[1] / 255;
      roadStyle.ramp[i * 3 + 2] = rgb[2] / 255;
    }
    roadStyle.glow = Math.min(1, Math.max(0, (t - 0.16) / 0.5)) * 0.34;
    roadStyle.core = 0.96 + 0.04 * t;
  }

  const WFACT = new Float32Array([0.42, 0.46, 0.5, 0.55, 0.6, 0.66, 0.72, 0.8,
    0.88, 0.97, 1.06, 1.16, 1.27, 1.38, 1.5, 1.64]);
  const ZK = [[9, 0.42], [11, 0.58], [13, 0.78], [15, 1.05], [17.5, 1.45]];

  function zkW(zoom) {
    if (zoom <= ZK[0][0]) return ZK[0][1];
    for (let i = 1; i < ZK.length; i++) {
      if (zoom <= ZK[i][0]) {
        const a = ZK[i - 1], b = ZK[i];
        return a[1] + (b[1] - a[1]) * (zoom - a[0]) / (b[0] - a[0]);
      }
    }
    return ZK[ZK.length - 1][1];
  }

  function makeRoadsLayer(mesh) {
    return {
      id: 'cityroads',
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (m, gl) {
        this.map = m; this.gl = gl;
        const vs = `
attribute vec2 a_pos;
attribute vec2 a_dir;
attribute float a_hw;
attribute float a_side;
attribute float a_lvl;
uniform mat4 u_m;
uniform float u_zoomf;
uniform float u_wmul;
uniform float u_mpp;      // 중심 위도의 미터/px
uniform float u_pk;       // 경사 보정 계수
uniform vec3 u_ramp[16];
varying float v_t;
varying vec3 v_c;
void main() {
  float lv = a_lvl * (1.0 / 16.0);
  int i0 = int(floor(lv + 0.001));
  int i1 = i0 < 15 ? i0 + 1 : 15;
  float fr = lv - float(i0);
  float wf = 0.42 + 1.22 * (lv / 15.0);   // 레벨에 따른 굵기 계수(유니폼 배열 대신 산식)
  // 색은 버텍스 셰이더에서 보간 (GLSL ES 1.00 프래그먼트는 동적 배열 인덱스 불가)
  v_c = mix(u_ramp[i0], u_ramp[i1], fr);
  // 화면 픽셀 폭 → 월드 두께(미터). 경사 시선 보정 u_pk 포함
  float wpx = max(a_hw * 0.05 * u_zoomf * u_wmul * wf, 1.1);
  float hw = wpx * 0.5 * u_mpp * u_pk;
  vec3 cw = vec3(a_pos.x * 1.5, a_pos.y * 1.5, 0.0);
  v_t = a_side * 2.0 - 1.0;
  vec4 c0 = u_m * vec4(cw + vec3(a_dir.x, a_dir.y, 0.0) * hw, 1.0);
  c0.z -= 0.0009 * c0.w;
  gl_Position = c0;
}`;
        const fs = `
precision mediump float;
varying float v_t;
varying vec3 v_c;
uniform float u_alpha;
uniform float u_glow;
void main() {
  float d = abs(v_t);
  float a = u_glow > 0.5 ? exp(-d * d * 2.4) : (1.0 - smoothstep(0.55, 1.0, d));
  a = clamp(a * u_alpha, 0.0, 1.0);
  gl_FragColor = vec4(v_c, a);
}`;
        const sh = (t, s) => {
          const o = gl.createShader(t);
          gl.shaderSource(o, s); gl.compileShader(o);
          if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error('shader', gl.getShaderInfoLog(o));
          return o;
        };
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.error('link', gl.getProgramInfoLog(pr));
        this.prog = pr;
        const at = (n) => gl.getAttribLocation(pr, n);
        this.a = { pos: at('a_pos'), dir: at('a_dir'), hw: at('a_hw'), side: at('a_side'), lvl: at('a_lvl') };
        this.u = {
          m: gl.getUniformLocation(pr, 'u_m'), zoomf: gl.getUniformLocation(pr, 'u_zoomf'),
          wmul: gl.getUniformLocation(pr, 'u_wmul'),
          ramp: gl.getUniformLocation(pr, 'u_ramp'),
          mpp: gl.getUniformLocation(pr, 'u_mpp'), pk: gl.getUniformLocation(pr, 'u_pk'),
          alpha: gl.getUniformLocation(pr, 'u_alpha'), glow: gl.getUniformLocation(pr, 'u_glow')
        };
        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.geom, gl.STATIC_DRAW);
        this.lbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lbo);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.levels, gl.DYNAMIC_DRAW);
        this.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
        this.majorIdx = mesh.majorIdx;
        this.minorIdx = mesh.minorIdx;

        const mc = maplibregl.MercatorCoordinate.fromLngLat(CENTER, 0);
        this.k = (typeof mc.meterInMercatorCoordinateUnits === 'function')
          ? mc.meterInMercatorCoordinateUnits()
          : 1 / (40075016.686 * Math.cos(CENTER[1] * Math.PI / 180));
        this.origin = [mc.x, mc.y];
      },
      updateLevels: function (arr) {
        const gl = this.gl;
        if (!gl) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      },
      render: function (gl, arg) {
        if (!this.prog) return;
        const matrix = arg && arg.defaultProjectionData ? arg.defaultProjectionData.mainMatrix : arg;
        const z = this.map.getZoom();
        const dpr = this.map.getPixelRatio ? this.map.getPixelRatio() : (window.devicePixelRatio || 1);
        const ctr = this.map.getCenter();
        const mpp = 40075016.686 * Math.cos(ctr.lat * Math.PI / 180) / (512 * Math.pow(2, z));
        const pitch = this.map.getPitch();
        // 경사 시선에서 도로 폭이 눌려 보이지 않도록 보정 (과하지 않게 최대 1.45배)
        const pk = Math.min(1.45, 1 / Math.max(0.72, Math.sin(Math.PI / 180 * Math.max(18, pitch))));
        const k = this.k, ox = this.origin[0], oy = this.origin[1];
        // MapLibre 커스텀 레이어 행렬은 절대 머케이터 좌표 기준: world = origin + k*metres
        const TS = new Float64Array([k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k, 0, ox, oy, 0, 1]);
        const M = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
          for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let i = 0; i < 4; i++) s += matrix[i * 4 + row] * TS[col * 4 + i];
            M[col * 4 + row] = s;
          }
        }
        const a = this.a;
        gl.useProgram(this.prog);
        gl.uniformMatrix4fv(this.u.m, false, M);
        gl.uniform1f(this.u.zoomf, zkW(z));
        gl.uniform1f(this.u.mpp, mpp);
        gl.uniform1f(this.u.pk, pk);
        gl.uniform3fv(this.u.ramp, roadStyle.ramp);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(a.pos);
        gl.vertexAttribPointer(a.pos, 2, gl.SHORT, false, 8, 0);
        gl.enableVertexAttribArray(a.dir);
        gl.vertexAttribPointer(a.dir, 2, gl.BYTE, true, 8, 4);
        gl.enableVertexAttribArray(a.hw);
        gl.vertexAttribPointer(a.hw, 1, gl.UNSIGNED_BYTE, false, 8, 6);
        gl.enableVertexAttribArray(a.side);
        gl.vertexAttribPointer(a.side, 1, gl.UNSIGNED_BYTE, false, 8, 7);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lbo);
        gl.enableVertexAttribArray(a.lvl);
        gl.vertexAttribPointer(a.lvl, 1, gl.UNSIGNED_BYTE, false, 1, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.enable(gl.BLEND);

        const minorOn = z >= 12.2;
        // 1) 도로 발광(글로우) — 가산 혼합
        if (roadStyle.glow > 0.004 && on('glow')) {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.uniform1f(this.u.alpha, roadStyle.glow);
          gl.uniform1f(this.u.glow, 1);
          gl.uniform1f(this.u.wmul, 3.4);
          gl.drawElements(gl.TRIANGLES, this.majorIdx, gl.UNSIGNED_INT, 0);
          if (minorOn) gl.drawElements(gl.TRIANGLES, this.minorIdx, gl.UNSIGNED_INT, this.majorIdx * 4);
        }
        // 2) 도로 본체
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(this.u.alpha, roadStyle.core);
        gl.uniform1f(this.u.glow, 0);
        gl.uniform1f(this.u.wmul, 1.0);
        gl.drawElements(gl.TRIANGLES, this.majorIdx, gl.UNSIGNED_INT, 0);
        if (minorOn) gl.drawElements(gl.TRIANGLES, this.minorIdx, gl.UNSIGNED_INT, this.majorIdx * 4);

        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(a.pos);
        gl.disableVertexAttribArray(a.dir);
        gl.disableVertexAttribArray(a.hw);
        gl.disableVertexAttribArray(a.side);
        gl.disableVertexAttribArray(a.lvl);
      },
      onRemove: function (gl) {
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.lbo) gl.deleteBuffer(this.lbo);
        if (this.prog) gl.deleteProgram(this.prog);
      }
    };
  }

  /* ---------------------------------------------------------------- stock road path (fallback) */
  let ROAD_SETS = [];

  function levelExpr(hour, dayIdx) {
    const hh = ((Math.round(hour) % 24) + 24) % 24;
    const key = (dayIdx ? 'q' : 'p') + (hh >> 2);
    const shift = Math.pow(16, hh & 3);
    return ['%', ['floor', ['/', ['get', key], shift]], 16];
  }

  function rampMatch(hour, dayIdx, ramp) {
    const lv = levelExpr(hour, dayIdx);
    const e = ['match', lv];
    for (let i = 0; i < 16; i++) e.push(i, ramp[i]);
    e.push(ramp[0]);
    return e;
  }

  function widthExpr(hour, dayIdx, kzoom) {
    const lv = levelExpr(hour, dayIdx);
    const e = ['match', lv];
    for (let i = 0; i < 16; i++) e.push(i, WFACT[i]);
    e.push(1);
    const base = ['+', 0.5, ['get', 'w']];
    return ['interpolate', ['linear'], ['zoom'],
      9, ['*', base, e, kzoom[0]],
      11, ['*', base, e, kzoom[1]],
      13, ['*', base, e, kzoom[2]],
      15, ['*', base, e, kzoom[3]],
      17.5, ['*', base, e, kzoom[4]]];
  }

  let roadCache = {};
  function refreshRoads(force) {
    if (!ready || !on('roadpaint') || !on('rl')) return;
    const hh = ((Math.round(hourF) % 24) + 24) % 24;
    const key = hh + '_' + day + '_' + Math.round(nightT * 10);
    if (!force && key === roadCache.key) return;
    roadCache.key = key;
    const T = window.__theme;
    const ramp = T.ramp;
    ['A', 'B'].forEach(function (sfx) {
      if (hasLayer('road' + sfx)) {
        safePaint('road' + sfx, 'line-color', rampMatch(hh, day, ramp));
        safePaint('road' + sfx, 'line-width', widthExpr(hh, day, [0.42, 0.58, 0.78, 1.05, 1.45]));
      }
      if (hasLayer('roadglow' + sfx)) {
        safePaint('roadglow' + sfx, 'line-color', rampMatch(hh, day, ramp));
        safePaint('roadglow' + sfx, 'line-width', widthExpr(hh, day, [1.0, 1.4, 1.8, 2.4, 3.2]));
      }
    });
  }

  /* ---------------------------------------------------------------- custom night-lights layer */
  function makeLightsLayer(bytes) {
    const u8 = new Uint8Array(bytes);
    const dv = new DataView(bytes);
    const count = dv.getUint32(0, true);
    const mc = maplibregl.MercatorCoordinate.fromLngLat(CENTER, 0);
    const k = (typeof mc.meterInMercatorCoordinateUnits === 'function')
      ? mc.meterInMercatorCoordinateUnits()
      : 1 / (40075016.686 * Math.cos(CENTER[1] * Math.PI / 180));

    const layer = {
      id: 'citylights',
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (m, gl) {
        this.map = m; this.gl = gl;
        const vs = `
attribute vec2 a_xy;
attribute vec2 a_zt;
uniform mat4 u_m;
uniform float u_size;
uniform float u_time;
varying float v_b;
void main() {
  vec3 p = vec3(a_xy.x * 1.5, a_xy.y * 1.5, a_zt.x);
  gl_Position = u_m * vec4(p, 1.0);
  gl_Position.z -= 0.0016 * gl_Position.w;   // 벽면 z-파이팅 방지
  float r = fract(a_zt.y * 0.0137 + 0.37);
  v_b = 0.42 + 0.80 * r;
  float flick = 0.93 + 0.07 * sin(u_time + r * 61.0);
  gl_PointSize = u_size * (0.6 + 0.9 * r) * flick;
}`;
        const fs = `
precision mediump float;
varying float v_b;
uniform float u_alpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 3.1) * u_alpha * v_b;
  vec3 c = mix(vec3(1.0, 0.68, 0.32), vec3(1.0, 0.95, 0.82), v_b * 0.75);
  gl_FragColor = vec4(c * a, a);
}`;
        const sh = (t, s) => {
          const o = gl.createShader(t);
          gl.shaderSource(o, s); gl.compileShader(o);
          if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o));
          return o;
        };
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(pr));
        this.prog = pr;
        this.u = {
          m: gl.getUniformLocation(pr, 'u_m'), size: gl.getUniformLocation(pr, 'u_size'),
          alpha: gl.getUniformLocation(pr, 'u_alpha'), time: gl.getUniformLocation(pr, 'u_time')
        };
        this.axy = gl.getAttribLocation(pr, 'a_xy');
        this.azt = gl.getAttribLocation(pr, 'a_zt');
        this.buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferData(gl.ARRAY_BUFFER, u8.subarray(4), gl.STATIC_DRAW);
        this.count = count;
        this.k = k;
        this.origin = [mc.x, mc.y];
      },
      render: function (gl, arg) {
        if (nightT < 0.03) return;
        // MapLibre v5: render(gl, {defaultProjectionData:{mainMatrix}}), v4: render(gl, matrix)
        const matrix = arg && arg.defaultProjectionData ? arg.defaultProjectionData.mainMatrix : arg;
        const z = this.map.getZoom();
        const dpr = this.map.getPixelRatio ? this.map.getPixelRatio() : (window.devicePixelRatio || 1);
        const size = Math.min(11, Math.max(1.7, 1.7 + (z - 9.6) * 1.05)) * dpr;

        // 절대 머케이터 좌표: world = origin + k*metres
        const ox = this.origin[0], oy = this.origin[1];
        const TS = new Float64Array([k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k, 0, ox, oy, 0, 1]);
        const M = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let i = 0; i < 4; i++) s += matrix[i * 4 + r] * TS[c * 4 + i];
            M[c * 4 + r] = s;
          }
        }
        gl.useProgram(this.prog);
        gl.uniformMatrix4fv(this.u.m, false, M);
        gl.uniform1f(this.u.size, size);
        const zfade = Math.min(1, Math.max(0, (z - 11.0) / 1.4));   // 도시 전경에서는 창문 불빛을 줄인다
        gl.uniform1f(this.u.alpha, Math.min(0.9, 0.85 * Math.min(1, Math.max(0, (nightT - 0.10) / 0.75)) * zfade));
        // 벽면 불빛 깜빡임은 '지도 시간'에만 연동한다 (일시정지 시 완전히 정지)
        gl.uniform1f(this.u.time, hourF * 520.0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(this.axy);
        gl.vertexAttribPointer(this.axy, 2, gl.SHORT, false, 6, 0);
        gl.enableVertexAttribArray(this.azt);
        gl.vertexAttribPointer(this.azt, 2, gl.UNSIGNED_BYTE, false, 6, 4);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);   // 가산 대신 일반 알파: 밀집 지역이 하얗게 타지 않게
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.drawArrays(gl.POINTS, 0, this.count);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(this.axy);
        gl.disableVertexAttribArray(this.azt);
      },
      onRemove: function (gl) {
        if (this.buf) gl.deleteBuffer(this.buf);
        if (this.prog) gl.deleteProgram(this.prog);
      }
    };
    return layer;
  }

  /* ---------------------------------------------------------------- map set-up */
  function buildMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: {}, layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': DAY.bg } }] },
      center: [126.9875, 37.5645], zoom: 11.05, pitch: 56, bearing: -22,
      maxPitch: 82, minZoom: 9, maxZoom: 17.5,
      renderWorldCopies: false, antialias: !!on('aa'), attributionControl: false,
      preserveDrawingBuffer: !!Q.get('preserve'),
      maxBounds: [[126.55, 37.30], [127.35, 37.78]]
    });
    window.__map = map;
    try { map.setMaxTileCacheSize(12); } catch (e) {}
    map.touchZoomRotate.enableRotation();
    return map;
  }

  function safePaint(id, prop, val) {
    try { map.setPaintProperty(id, prop, val); } catch (e) { /* 미지원 속성 무시 */ }
  }
  function hasLayer(id) { return !!map.getLayer(id); }

  function addBackdrop() {
    try {
      const VEC = on('vec');
      if (VEC) map.addSource('vec', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });

      // 지형 고도 색조 (능선·산맥)
      if (on('dem')) map.addSource('dem', { type: 'raster-dem', encoding: 'terrarium',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256, maxzoom: 11.5, attribution: 'AWS Terrain Tiles' });
      try { if (!on('relief')) throw new Error('off');
        map.addLayer({ id: 'relief', type: 'color-relief', source: 'dem',
          paint: { 'color-relief-opacity': 1,
            'color-relief-color': ['interpolate', ['linear'], ['elevation'],
              0, DAY.relief[0][1], 30, DAY.relief[1][1], 90, DAY.relief[2][1],
              200, DAY.relief[3][1], 420, DAY.relief[4][1], 700, DAY.relief[5][1],
              950, DAY.relief[6][1]] } });
      } catch (e) { console.warn('color-relief 미지원', e); }

      if (on('hill')) map.addLayer({ id: 'hill', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': DAY.hill.exag,
          'hillshade-shadow-color': DAY.hill.shadow,
          'hillshade-highlight-color': DAY.hill.high,
          'hillshade-accent-color': DAY.hill.accent,
          'hillshade-illumination-direction': 315 } });

      if (VEC) map.addLayer({ id: 'b_wood', type: 'fill', source: 'vec', 'source-layer': 'landcover', maxzoom: 12.5,
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest', 'grass']]],
        paint: { 'fill-color': DAY.grass, 'fill-opacity': 0.72 } });
      if (VEC && on('park')) map.addLayer({ id: 'b_park', type: 'fill', source: 'vec', 'source-layer': 'landuse', maxzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['park', 'garden', 'nature_reserve', 'grass']]],
        paint: { 'fill-color': DAY.park, 'fill-opacity': 0.80 } });
      if (VEC && on('vwater')) map.addLayer({ id: 'b_water', type: 'fill', source: 'vec', 'source-layer': 'water',
        paint: { 'fill-color': DAY.water, 'fill-opacity': 1 } });


    } catch (e) { console.warn('배경 레이어', e); }
  }

  function addDataLayers() {
    // 한강·지천 (OSM 추출)
    map.addSource('water', { type: 'geojson', data: { type: 'FeatureCollection',
      features: water.map(p => ({ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [p] } })) } });
    map.addLayer({ id: 'water', type: 'fill', source: 'water',
      paint: { 'fill-color': DAY.water, 'fill-opacity': 0.96 } });

    // 도로: 커스텀 레이어(셰이더) — 시간에 따라 paint 재계산 없이 유니폼/버퍼만 갱신
    const BLD_ON = on('bld');
    if (roadMesh && on('roads')) {
      try {
        roadLayer = makeRoadsLayer(roadMesh);
        map.addLayer(roadLayer);
      } catch (e) {
        console.warn('커스텀 도로 레이어 실패, 기본 도로로 대체', e);
        roadLayer = null;
      }
    }
    if (!roadLayer || !on('rl')) {
      // 폴백: 기존 GeoJSON 라인 레이어
      const ROADS = on('roads');
      if (ROADS) {
        if (!roads) roads = decodeRoads(roadsBuf);
        ROAD_SETS = [{ id: 'A', data: roads.major, minzoom: 0 },
                     { id: 'B', data: roads.minor, minzoom: 12.2 }];
      }
      ROAD_SETS.forEach(function (rs) {
        if (!ROADS) return;
        map.addSource('road' + rs.id, { type: 'geojson', data: rs.data, maxzoom: 15 });
        if (on('glow') && rs.id === 'A') {
          map.addLayer({ id: 'roadglow' + rs.id, type: 'line', source: 'road' + rs.id,
            minzoom: rs.minzoom,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': rampMatch(15, 0, RAMP_DAY),
              'line-width': widthExpr(15, 0, [1.0, 1.4, 1.8, 2.4, 3.2]),
              'line-blur': ['interpolate', ['linear'], ['zoom'], 9, 3, 12, 5, 16, 9],
              'line-opacity': DAY.glowOp } });
        }
        map.addLayer({ id: 'road' + rs.id, type: 'line', source: 'road' + rs.id,
          minzoom: rs.minzoom,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': rampMatch(15, 0, RAMP_DAY),
            'line-width': widthExpr(15, 0, [0.42, 0.58, 0.78, 1.05, 1.45]),
            'line-opacity': DAY.coreOp } });
      });
    }

    const bcol = ['match', ['get', 'c']];
    for (let i = 0; i < 16; i++) bcol.push(i, BLD[i]);
    bcol.push(BLD[3]);
    const bPaint = {
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 1,
      'fill-extrusion-color': bcol
    };
    if (on('vg')) { try { bPaint['fill-extrusion-vertical-gradient'] = true; } catch (e) {} }
    if (BLD_ON) {
      map.addSource('bldA', { type: 'geojson', data: buildings.major, maxzoom: 14 });
      map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'bldA', paint: bPaint });
      map.addSource('bldB', { type: 'geojson', data: buildings.minor, maxzoom: 14 });
      map.addLayer({ id: 'bld2', type: 'fill-extrusion', source: 'bldB', minzoom: 12.2, paint: bPaint });
    }
    if (on('ao')) {
      ['bld', 'bld2'].forEach(function (id) {
        if (!hasLayer(id)) return;
        safePaint(id, 'fill-extrusion-ambient-occlusion-intensity', 0.28);
        safePaint(id, 'fill-extrusion-ambient-occlusion-radius', 3.0);
        safePaint(id, 'fill-extrusion-ambient-occlusion-wall-radius', 2.0);
      });
    }

    // 야간 창문 불빛
    if (on('lights')) map.addLayer(makeLightsLayer(lightPoints));
  }

  /* ---------------------------------------------------------------- theme application */
  // 테마(스타일) 갱신은 양자화해서 — 재생 중 매 프레임 스타일 재계산으로 끊기지 않도록
  function applyTheme(t) {
    const T = themeAt(t);
    window.__theme = T;
    document.body.classList.toggle('is-night', t > 0.52);

    const st = document.documentElement.style;
    st.setProperty('--bg', T.bg);
    st.setProperty('--ink', T.ink);
    st.setProperty('--sub', T.sub);
    st.setProperty('--panel', T.panel);
    st.setProperty('--panel-2', T.panel2);
    st.setProperty('--line', T.line);
    st.setProperty('--accent', T.accent);
    st.setProperty('--accent-soft', T.accentSoft);
    st.setProperty('--thumb', T.thumb);
    st.setProperty('--shadow', T.shadow);
    st.setProperty('--grad', 'linear-gradient(90deg,' + T.ramp.filter((_, i) => i % 4 === 0 || i === 15).join(',') + ')');
    $('lbar').style.background = 'linear-gradient(90deg,' + T.ramp.filter((_, i) => i % 4 === 0 || i === 15).join(',') + ')';
    $('mood').textContent = t > 0.52 ? '밤 · 야간 조명' : (t > 0.15 ? '해 질 녘' : '낮 · 건축 일러스트 톤');
    $('mood2').textContent = t > 0.52 ? '야간 창문 불빛 · 도로 발광' : '도로 유동인구 밀도';

    if (!ready) return;
    if (!on('theme')) return;

    safePaint('bg', 'background-color', T.bg);
    if (hasLayer('relief')) {
      const r = T.relief;
      safePaint('relief', 'color-relief-color', ['interpolate', ['linear'], ['elevation'],
        0, r[0][1], 30, r[1][1], 90, r[2][1], 200, r[3][1], 420, r[4][1], 700, r[5][1], 950, r[6][1]]);
    }
    if (hasLayer('hill')) {
      safePaint('hill', 'hillshade-exaggeration', T.hill.exag);
      safePaint('hill', 'hillshade-shadow-color', T.hill.shadow);
      safePaint('hill', 'hillshade-highlight-color', T.hill.high);
      safePaint('hill', 'hillshade-accent-color', T.hill.accent);
    }
    if (hasLayer('b_wood')) safePaint('b_wood', 'fill-color', T.grass);
    if (hasLayer('b_park')) safePaint('b_park', 'fill-color', T.park);
    if (hasLayer('b_water')) safePaint('b_water', 'fill-color', T.water);
    if (hasLayer('water')) safePaint('water', 'fill-color', T.water);

    if (!roadLayer) {
      ['A', 'B'].forEach(function (sfx) {
        if (hasLayer('roadglow' + sfx)) {
          safePaint('roadglow' + sfx, 'line-opacity', T.glowOp);
          map.setLayoutProperty('roadglow' + sfx, 'visibility', t > 0.32 ? 'visible' : 'none');
        }
      });
      refreshRoads(true);
    }
    if (on('light')) try {
      map.setLight({ anchor: 'viewport', color: T.light.color,
        intensity: T.light.intensity, position: T.light.pos });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- UI */
  const slider = () => $('slider');

  function updateClock() {
    const hh = Math.floor(hourF) % 24;
    const mm = Math.floor((hourF - Math.floor(hourF)) * 60);
    $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    $('daylab').textContent = (day ? '주말 평균' : '평일 평균');
  }

  function moodFactor() {
    if (mode === 'day') return 0;
    if (mode === 'night') return 1;
    return nightFactor(hourF);
  }

  function setMood(force) {
    const t = moodFactor();
    if (!force && Math.abs(t - nightT) < 1e-4) return;
    nightT = t;
    updateRoadStyle();                    // 도로 램프·발광: 유니폼만 (매끄럽게)
    const q = Math.round(t * 24) / 24;    // 스타일 갱신은 1/24 단계로만
    if (force || Math.abs(q - appliedT) > 1e-6) {
      appliedT = q;
      applyTheme(q);
    }
  }

  // 한 프레임의 시간 진행 처리: 값 갱신은 모두 저렴한 경로(유니폼·버퍼·DOM)만 사용
  function frameStep() {
    updateClock();
    setMood(false);
    updateRoadLevels(false);
    if (map && playing) map.triggerRepaint();
  }

  function applyHour(force) {
    updateClock();
    setMood(true);
    updateRoadLevels(true);
    if (map) map.triggerRepaint();
  }

  function bindUI() {
    const sl = slider();
    sl.addEventListener('input', () => {
      hourF = parseFloat(sl.value);
      applyHour(false);
    });
    document.querySelectorAll('#dayseg button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#dayseg button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        day = parseInt(b.dataset.day, 10);
        updateRoadLevels(true);
        updateClock();
        if (map) map.triggerRepaint();
      });
    });
    document.querySelectorAll('#mseg button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#mseg button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        mode = b.dataset.mode;
        setMood(true);
        if (map) map.triggerRepaint();
      });
    });
    const btn = $('play');
    let raf = 0, prev = 0;
    const SPEED = 1.6;                    // 한 바퀴 약 15초
    function tick(ts) {
      if (!playing) { raf = 0; return; }
      if (!prev) prev = ts;
      let dt = (ts - prev) / 1000;
      prev = ts;
      if (!(dt > 0) || dt > 0.25) dt = 1 / 60;   // 탭 전환 등으로 시간이 튀지 않게
      hourF = (hourF + dt * SPEED) % 24;
      sl.value = hourF.toFixed(2);
      frameStep();
      raf = requestAnimationFrame(tick);
    }
    btn.addEventListener('click', () => {
      playing = !playing;
      btn.textContent = playing ? '❚❚' : '▶';
      if (playing) { prev = 0; if (!raf) raf = requestAnimationFrame(tick); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (map) map.triggerRepaint();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); btn.click(); }
    });
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    if (typeof maplibregl === 'undefined') {
      stat('지도 라이브러리(MapLibre)를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', 100);
      return;
    }
    buildMap();
    const prog = (name) => (f) => {
      stat(name + ' 불러오는 중… ' + Math.round(f * 100) + '%', f * 42);
    };

    const dataReady = Promise.all([
      loadBuffer('buildings.bin', prog('건물 데이터')),
      loadBuffer('roads.bin', prog('도로 데이터')),
      loadBuffer('lights.bin'),
      fetch(DATA + 'water.json').then(r => r.json())
    ]).then(([b, r, l, w]) => {
      buildingsBuf = b; roadsBuf = r; lightPoints = l; waterRings = w;
      stat('데이터 준비 완료', 44);
      return true;
    }).catch(err => {
      console.error(err);
      stat('데이터를 불러오지 못했습니다: ' + err.message, 100);
      return false;
    });

    map.on('load', () => {
      addBackdrop();
      stat('건물·도로 데이터를 준비하는 중…', 46);
      dataReady.then(ok => {
        if (!ok) return;
        setTimeout(() => {
          const t0 = performance.now();
          buildings = decodeBuildings(buildingsBuf);
          stat('건물 ' + (buildings.major.features.length + buildings.minor.features.length).toLocaleString() + '동 배치 중…', 64);
          setTimeout(() => {
            roadMesh = buildRoadMesh(roadsBuf);
            window.__roadMesh = roadMesh;
            roadMesh.out32 = new Uint32Array(roadMesh.levels.buffer);
            water = waterRings;
            stat('도로 ' + roadMesh.nSeg.toLocaleString() + '구간 · 한강 배치 중…', 80);
            setTimeout(() => {
              addDataLayers();
              ready = true;
              nightT = moodFactor();
              updateRoadStyle();
              applyTheme(appliedT = Math.round(nightT * 24) / 24);
              updateRoadLevels(true);
              updateClock();
              bindUI();
              window.__view = {
                setHour: function (h) { hourF = ((h % 24) + 24) % 24; slider().value = hourF; applyHour(true); },
                setMode: function (m) {
                  mode = m;
                  document.querySelectorAll('#mseg button').forEach(function (x) {
                    x.classList.toggle('on', x.dataset.mode === m);
                  });
                  setMood(true);
                  if (map) map.triggerRepaint();
                },
                setDay: function (d) {
                  day = d;
                  document.querySelectorAll('#dayseg button').forEach(function (x) {
                    x.classList.toggle('on', +x.dataset.day === d);
                  });
                  updateRoadLevels(true); updateClock();
                  if (map) map.triggerRepaint();
                },
                play: function (v) { if (!!v !== playing) $('play').click(); },
                fly: function (o) { map.easeTo(Object.assign({ duration: 0 }, o)); },
                state: function () { return { hour: hourF, day: day, mode: mode, t: nightT, zoom: map.getZoom(), cooled: lastLevelKey }; }
              };
              stat('완료', 100);
              setTimeout(() => { $('loading').classList.add('gone'); }, 300);
              console.log('ready', ((performance.now() - t0) / 1000).toFixed(1) + 's',
                buildings.major.features.length + buildings.minor.features.length,
                roadMesh.nSeg);
              window.__ready = true;
            }, 40);
          }, 40);
        }, 40);
      });
    });
  }

  let buildingsBuf = null, roadsBuf = null, waterRings = null;

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

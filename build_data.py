"""Build static binary data assets for the Seoul 3D web app.

Reads work/seoul3d/geom.npz (building rings, area, centre, height) and
work/seoul3d/mapdata.json (road polylines + 24h x 2 day congestion nibbles),
and writes compact binaries into work/seoul3d_web/data/.

buildings.bin : [n:u8][h:u8][c:u8] + n*(x:i16,y:i16)      coords = metres / 1.5
lights.bin    : count header + N*(x:i16,y:i16,z:u8,tone:u8)  night window glow points
roads.bin     : straight copy of mapdata.json['r'] decoded
water.json    : [ ring, ... ] lon/lat polygons
meta.json     : centre / scale / counts
"""
import json, base64, os, struct
import numpy as np

SRC = '../seoul3d'
OUT = 'data'
os.makedirs(OUT, exist_ok=True)

SCALE = 1.5
QMAX = 32767
CEN_LAT, CEN_LON = 37.5665, 126.9780


def q(v):
    return np.clip(np.round(np.asarray(v) / SCALE), -QMAX, QMAX).astype('<i2')


def simplify_ring(xy, tol=1.6):
    n = xy.shape[0]
    if n <= 4:
        return xy
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p0 = xy[a]
        p1 = xy[b]
        d = p1 - p0
        L = np.hypot(*d)
        seg = xy[a + 1:b]
        if L < 1e-6:
            dist = np.hypot(*(seg - p0).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p0[1]) - d[1] * (seg[:, 0] - p0[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[a + 1 + k] = True
            stack.append((a, a + 1 + k))
            stack.append((a + 1 + k, b))
    return xy[keep]


def main():
    g = np.load(os.path.join(SRC, 'geom.npz'))
    Vxy, boff, bh, area, cen = g['Vxy'], g['b_off'], g['bheight'], g['area'], g['cen']
    nb = bh.size
    rng = np.random.default_rng(7)

    # deterministic per-building tone jitter
    jitter = rng.random(nb)

    parts = []
    npts = []
    keep_masks = np.zeros(nb, bool)
    for i in range(nb):
        s, e = int(boff[i]), int(boff[i + 1])
        ring = Vxy[s:e]
        ring = simplify_ring(ring, tol=2.3)
        if ring.shape[0] < 3:
            continue
        if ring.shape[0] > 16:
            idx = np.unique(np.linspace(0, ring.shape[0] - 1, 16).round().astype(int))
            ring = ring[idx]
            if ring.shape[0] < 3:
                continue
        h = int(np.clip(round(float(bh[i])), 3, 255))
        a = float(area[i])
        # --- category: height + footprint size + jitter => warm architectural palette
        j = jitter[i]
        if h < 9:                                      # 저층: 벽돌·테라코타
            c = 0 if a < 200 else (1 if a < 700 else 2)
            if j < 0.16:
                c = 6 if a > 500 else 3
        elif h < 20:                                   # 9~20m: 벽돌 + 따뜻한 아이보리
            c = 0 if j < 0.3 else (1 if j < 0.42 else (13 if j < 0.55 else (3 if j < 0.8 else 4)))
        elif h < 40:                                   # 20~40m: 아이보리·모래색 중심
            c = 3 if j < 0.3 else (5 if j < 0.5 else (13 if j < 0.62 else (12 if j < 0.8 else 11)))
            if a > 900:
                c = 13
        elif h < 75:                                   # 40~75m: 슬레이트 + 따뜻한 이웃
            c = 8 if j < 0.26 else (9 if j < 0.4 else (5 if j < 0.62 else (12 if j < 0.8 else 11)))
        else:                                          # 초고층
            c = 10 if j < 0.7 else 9
        parts.append(bytes((ring.shape[0], h, int(c))))
        parts.append(q(ring).tobytes())
        npts.append(ring.shape[0])
        keep_masks[i] = True

    bbin = b''.join(parts)
    open(os.path.join(OUT, 'buildings.bin'), 'wb').write(bbin)
    print('buildings %d  pts %d  %.2f MB' % (keep_masks.sum(), sum(npts), len(bbin) / 1e6))

    # ---------------- night window glow points ----------------
    li = np.flatnonzero(keep_masks & (bh >= 11) & (area >= 70))
    hh = np.clip(bh[li], 0, 255).astype(np.int32)
    aa = np.maximum(area[li], 20.0)
    rr = np.sqrt(aa / np.pi) * 0.92
    cc = cen[li]
    per = np.where(hh < 34, 1, np.where(hh < 70, 2, 3))
    total = int(per.sum())
    print('light points', total)
    bx = np.zeros(total, '<i2')
    by = np.zeros(total, '<i2')
    bz = np.zeros(total, np.uint8)
    bt = np.zeros(total, np.uint8)
    p = 0
    ang = rng.random(total) * (2 * np.pi)
    rf = 0.75 + rng.random(total) * 0.30
    zf = 0.14 + rng.random(total) * 0.80
    tone = rng.random(total)
    for j, i in enumerate(li):
        m = per[j]
        for k in range(m):
            t = p + k
            a_ = ang[t]
            bz[t] = int(np.clip(round(zf[t] * hh[j]), 2, 254))
            bx[t] = int(np.clip(round((cc[j, 0] + np.cos(a_) * rr[j] * rf[t]) / SCALE), -QMAX, QMAX))
            by[t] = int(np.clip(round((cc[j, 1] + np.sin(a_) * rr[j] * rf[t]) / SCALE), -QMAX, QMAX))
            bt[t] = int(tone[t] * 255)
        p += m
    lbin = struct.pack('<I', total) + np.stack([bx.view(np.uint8).reshape(-1, 2).astype(np.uint8)
                                                .reshape(total, 2)[:, 0]], 1).tobytes()[:0]
    # pack tightly: x,y int16 LE then z,tone
    blob = bytearray()
    blob += struct.pack('<I', total)
    xy = np.stack([bx, by], 1).astype('<i2').tobytes()
    zt = np.stack([bz, bt], 1).astype(np.uint8).tobytes()
    # interleave per point: 4 bytes xy + 2 bytes zt
    a1 = np.frombuffer(xy, np.uint8).reshape(total, 4)
    a2 = np.frombuffer(zt, np.uint8).reshape(total, 2)
    blob += np.concatenate([a1, a2], 1).tobytes()
    open(os.path.join(OUT, 'lights.bin'), 'wb').write(bytes(blob))
    print('lights %.2f MB' % (len(blob) / 1e6))

    # ---------------- roads / water from mapdata.json ----------------
    md = json.load(open(os.path.join(SRC, 'mapdata.json')))
    rbin = base64.b64decode(md['r'])
    open(os.path.join(OUT, 'roads.bin'), 'wb').write(rbin)
    print('roads %.2f MB' % (len(rbin) / 1e6))
    json.dump(md['w'], open(os.path.join(OUT, 'water.json'), 'w'), separators=(',', ':'))
    print('water rings', len(md['w']))

    meta = {
        'center': [CEN_LON, CEN_LAT],
        'scale': SCALE,
        'buildings': int(keep_masks.sum()),
        'roadWays': int(md['n'][1]),
        'lights': total,
    }
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
    print(meta)


if __name__ == '__main__':
    main()

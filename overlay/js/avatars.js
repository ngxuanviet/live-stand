import { plainFace, processFaceHi, squashFace, buildHeadLayers, FACE } from './art.js';

/**
 * Nạp avatar qua proxy của server (cùng origin -> không lỗi CORS, có cache).
 * Avatar được vẽ ở độ phân giải thật của canvas (không pixel hoá) nên nét; pixel-art chỉ dùng cho tóc, mũ và thân.
 * Chưa có ảnh / lỗi thì dùng mặt giả vẽ bằng code, có ảnh thật thì tự thay.
 */
export class Avatars {
  constructor({ stageId, token, scale = 4 }) {
    this.stageId = stageId;
    this.token = token;
    this.scale = scale;
    this.faces = new Map(); // userKey -> { url, img, hi, hiLook, tried }
    this.layers = new Map(); // `${userKey}|${look}` -> { back, front }
    this.parts = new Map(); // `${userKey}|${look}|${real}` -> bộ phận đầu để vẽ
    this.plain = new Map();
  }

  /** Hệ số phóng của canvas thay đổi (đổi kích thước Stage) thì dựng lại mặt ở độ phân giải mới. */
  setScale(s) {
    if (s === this.scale) return;
    this.scale = s;
    for (const f of this.faces.values()) {
      f.hiLook = null;
      f.hi = f.img ? processFaceHi(f.img, FACE * s) : null;
    }
    this.parts.clear();
  }

  #proxyUrl(url) {
    const q = new URLSearchParams({ url, stage_id: this.stageId, token: this.token });
    return `/avatar?${q}`;
  }

  #load(key, f) {
    f.tried = true;
    const img = new Image();
    img.onload = () => {
      try {
        f.img = img;
        f.hi = processFaceHi(img, FACE * this.scale);
        this.#invalidate(key);
      } catch {
        /* giữ mặt giả */
      }
    };
    img.src = this.#proxyUrl(f.url);
  }

  #invalidate(key) {
    for (const k of this.parts.keys()) if (k.startsWith(`${key}|`)) this.parts.delete(k);
  }

  /** Các phần của đầu để vẽ: { back, face, front, smooth, look }. `look` = đang ngước lên. */
  head(key, url, look) {
    let f = this.faces.get(key);
    if (!f || f.url !== url) {
      f = { url: url || '', img: null, hi: null, hiLook: null, tried: false };
      this.faces.set(key, f);
      this.#invalidate(key);
    }
    if (f.url && !f.tried) this.#load(key, f);
    const real = !!f.hi;
    const pk = `${key}|${look ? 1 : 0}|${real ? 1 : 0}`;
    let p = this.parts.get(pk);
    if (!p) {
      const lk = `${key}|${look ? 1 : 0}`;
      let layers = this.layers.get(lk);
      if (!layers) {
        layers = buildHeadLayers(key, look);
        this.layers.set(lk, layers);
      }
      let face;
      if (real) {
        if (look) {
          if (!f.hiLook) f.hiLook = squashFace(f.hi);
          face = f.hiLook;
        } else face = f.hi;
      } else {
        if (!this.plain.has(key)) this.plain.set(key, plainFace(key));
        face = this.plain.get(key);
      }
      p = { back: layers.back, front: layers.front, face, smooth: real, look: !!look };
      this.parts.set(pk, p);
    }
    return p;
  }

  forget(key) {
    this.faces.delete(key);
    this.plain.delete(key);
    this.layers.delete(`${key}|0`);
    this.layers.delete(`${key}|1`);
    this.#invalidate(key);
  }
}

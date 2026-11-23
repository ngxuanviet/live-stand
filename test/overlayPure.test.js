import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIM_IDS, ANIM_MS, pose, particles, flightAmp, MAX_PARTICLES, rnd } from '../overlay/js/anims.js';
import { zBoost, sortField, planFocus, degrade, pickBubbles, tierLabel, MAX_FULL, MAX_BIG_ANIMS } from '../overlay/js/focus.js';
import { HEART_EFFECTS } from '../server/core/heartEffects.js';

test('id và thời lượng hiệu ứng ở server khớp với overlay', () => {
  assert.deepEqual(HEART_EFFECTS.map((e) => e.id), ANIM_IDS);
  for (const e of HEART_EFFECTS) assert.equal(ANIM_MS[e.id], e.ms, e.id);
});

test('pose: mọi hiệu ứng hữu hạn trên [0,1], bắt đầu và kết thúc về tư thế gốc', () => {
  for (const id of ANIM_IDS) {
    for (let i = 0; i <= 50; i++) {
      const s = pose(id, i / 50);
      for (const k of ['jump', 'dx', 'sx', 'rot']) assert.ok(Number.isFinite(s[k]), `${id}.${k}`);
      assert.ok(s.jump >= 0, `${id} không chui xuống đất`);
      assert.ok(Math.abs(s.sx) >= 0.1, `${id} không bị co về 0 khi xoay (âm = mặt sau)`);
    }
    const a = pose(id, 0);
    const b = pose(id, 1);
    assert.ok(Math.abs(a.jump) < 1e-6, `${id} p=0`);
    assert.ok(b.jump < 1e-6, `${id} p=1`);
    assert.equal(b.sx === 1 || id === 'spin', true);
    if (id !== 'flip') assert.equal(a.rot, 0);
    assert.ok(Math.abs(Math.cos(b.rot) - 1) < 1e-6 || Math.abs(Math.sin(b.rot)) < 1e-6, `${id} xoay đủ vòng`);
  }
});

test('pose: phóng lên trời không vượt độ cao cho phép', () => {
  const amp = flightAmp(120, 70); // chân y=120, đỉnh đầu không được lên quá y=70
  assert.equal(amp, 12);
  for (let i = 0; i <= 100; i++) assert.ok(pose('rocket', i / 100, { amp }).jump <= amp + 1e-9);
  assert.equal(flightAmp(300, 0), 58, 'có nhiều chỗ thì bay tối đa 58');
  assert.equal(flightAmp(40, 70), 6, 'sát hàng VIP vẫn nảy một chút');
});

test('particles: số hạt có trần, hữu hạn, lod giảm số hạt, cùng seed cho cùng kết quả', () => {
  for (const id of ANIM_IDS) {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const full = particles(id, p, { x: 100, y: 150, jump: 5, seed: 7 });
      const lod = particles(id, p, { x: 100, y: 150, jump: 5, seed: 7, lod: true });
      assert.ok(full.length <= MAX_PARTICLES, id);
      assert.ok(lod.length <= full.length, `${id} lod`);
      for (const h of full) {
        assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y), id);
        assert.ok(h.a >= 0 && h.a <= 1.0001, `${id} alpha ${h.a}`);
      }
      assert.deepEqual(particles(id, p, { x: 100, y: 150, jump: 5, seed: 7 }), full, `${id} xác định`);
    }
  }
  assert.ok(particles('confetti', 0.5, { x: 100, y: 150, seed: 1 }).length > particles('confetti', 0.5, { x: 100, y: 150, seed: 1, lod: true }).length);
});

test('rnd: ổn định theo seed và nằm trong [0,1)', () => {
  assert.equal(rnd(3, 4, 1), rnd(3, 4, 1));
  assert.notEqual(rnd(3, 4, 1), rnd(3, 5, 1));
  for (let i = 0; i < 200; i++) {
    const v = rnd(i, i * 3, 2);
    assert.ok(v >= 0 && v < 1);
  }
});

test('sortField: người đang diễn / lead / mới qua mốc luôn nổi hơn người thường dù đứng xa hơn', () => {
  const normal = { key: 'n', y: 200 };
  const far = { key: 'f', y: 100, anim: {} };
  const pending = { key: 'p', y: 90, pendingAnim: {} };
  const lead = { key: 'l', y: 80, lead: true };
  const boosted = { key: 'b', y: 70, zUntil: 5000 };
  const order = sortField([far, normal, pending, lead, boosted], 1000).map((c) => c.key);
  assert.equal(order[0], 'n', 'người thường vẽ trước (ở dưới)');
  assert.deepEqual(new Set(order.slice(1)), new Set(['f', 'p', 'l', 'b']));
  assert.deepEqual(order.slice(1), ['b', 'l', 'p', 'f'], 'trong nhóm nổi vẫn theo trục Y');
  assert.equal(zBoost({ zUntil: 500 }, 1000), 0, 'zUntil hết hạn thì về thứ tự Y');
  assert.equal(sortField([{ y: 1 }, { y: 2 }], 0)[0].y, 1);
});

test('planFocus: chỉ một owner, tối đa maxFull người đầy đủ, dim không cộng dồn', () => {
  const perf = [
    { key: 'a', kind: 'burst', intensity: 3, t0: 1 },
    { key: 'b', kind: 'total', intensity: 1, t0: 2 },
    { key: 'c', kind: 'total', intensity: 3, t0: 3 },
    { key: 'd', kind: 'preview', intensity: 3, t0: 4 },
  ];
  const plan = planFocus(perf, { mode: 'strong', dim: true });
  assert.equal(plan.owner, 'c', 'mốc tổng, độ mạnh cao nhất');
  assert.equal(plan.full.size, MAX_FULL);
  assert.ok(plan.full.has('c') && plan.full.has('b'));
  assert.ok(!plan.full.has('a') && !plan.full.has('d'));
  assert.equal(plan.dim, true);
  assert.equal(planFocus(perf, { mode: 'strong', dim: false }).dim, false);
  const off = planFocus(perf, { mode: 'off', dim: true });
  assert.equal(off.owner, null);
  assert.equal(off.full.size, 0);
  assert.equal(off.dim, false);
  assert.equal(planFocus([], { mode: 'light', dim: true }).dim, false);
  // hoà thì người bắt đầu muộn hơn thắng
  assert.equal(planFocus([{ key: 'x', kind: 'total', intensity: 2, t0: 1 }, { key: 'y', kind: 'total', intensity: 2, t0: 9 }]).owner, 'y');
});

test('degrade: vượt trần thì chỉ nhảy cẫng nhẹ; đông người thì giảm hạt', () => {
  assert.deepEqual(degrade('fireworks', 0, 5), { id: 'fireworks', lod: false });
  assert.deepEqual(degrade('fireworks', 0, 20), { id: 'fireworks', lod: true });
  assert.deepEqual(degrade('fireworks', MAX_BIG_ANIMS, 5), { id: 'hop3', lod: true });
});

test('pickBubbles: người diễn không bao giờ bị cắt bởi giới hạn bong bóng thường', () => {
  const cands = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, priority: 1, greetUntil: 100 + i })),
    { id: 'p1', priority: 2, greetUntil: 1 },
    { id: 'p2', priority: 2, greetUntil: 2 },
  ];
  const out = pickBubbles(cands, 6).map((c) => c.id);
  assert.deepEqual(out.slice(0, 2), ['p2', 'p1'], 'người diễn đứng đầu');
  assert.equal(out.length, 8, '2 người diễn + 6 bong bóng thường');
  assert.ok(out.includes('n9') && !out.includes('n0'), 'bong bóng thường giữ cái mới nhất');
  assert.equal(pickBubbles([], 6).length, 0);
});

test('tierLabel: nhãn tiêu đề theo loại mốc', () => {
  assert.equal(tierLabel('total', 100), 'x100 tim!');
  assert.equal(tierLabel('burst', 10), 'thả tim liên tục!');
  assert.equal(tierLabel('preview', 0), 'xem thử');
});

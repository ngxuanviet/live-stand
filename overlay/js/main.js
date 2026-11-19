import { Scene } from './scene.js';
import { Avatars } from './avatars.js';

const q = new URLSearchParams(location.search);
const stageId = q.get('stage_id');
const token = q.get('token');
const debug = q.get('debug') === '1';
const showSafe = q.get('safe') === '1'; // vẽ khung Safe Zone (xem trước trong Dashboard)
const FRAME_MS = 1000 / 30; // khoá 30 FPS

const canvas = document.getElementById('c');
const bgMode = q.get('bg'); // chỉ để xem thử ngoài OBS: checker | game | black
if (bgMode) document.body.classList.add(`bg-${bgMode}`);

let scene = null;
let avatars = null;
let size = { W: 0, H: 0 };
let lastSeq = -1;

const socket = io('/overlay', { auth: { stage_id: stageId, token } });

function fit() {
  if (q.get('fit') !== '1' || !size.W) return;
  const k = Math.min(window.innerWidth / size.W, window.innerHeight / size.H);
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = `scale(${k})`;
}

socket.on('init', ({ stage, snapshot }) => {
  const W = Number(q.get('width')) || stage.width;
  const H = Number(q.get('height')) || stage.height;
  if (!scene || size.W !== W || size.H !== H) {
    size = { W, H };
    avatars = new Avatars({ stageId, token });
    scene = new Scene({ main: canvas, W, H, settings: snapshot.settings, avatars, debug, showSafe });
    if (debug) window.__scene = scene; // chỉ để đo hiệu năng / gỡ lỗi
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    scene.applySnapshot(snapshot, true);
    fit();
  } else {
    scene.applySnapshot(snapshot, false); // kết nối lại: giữ nhân vật đang có, đối chiếu với server
  }
  lastSeq = snapshot.seq;
});

socket.on('snapshot', (s) => {
  scene?.applySnapshot(s, false);
  lastSeq = s.seq;
});

socket.on('patch', (p) => {
  if (!scene) return;
  if (lastSeq >= 0 && p.seq !== lastSeq + 1) {
    socket.emit('resync'); // lệch thứ tự: xin snapshot đầy đủ
    return;
  }
  lastSeq = p.seq;
  scene.applyPatch(p);
});

socket.on('connect_error', (e) => console.warn('[overlay] không kết nối được:', e.message));
window.addEventListener('resize', fit);

// ---- vòng lặp 30 FPS ----
let last = 0;
let next = 0; // mốc thời gian của khung kế tiếp (bước cố định -> không lệch nhịp khi màn hình 60/75/90/144Hz)
let fpsAcc = 0;
let fpsN = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!scene) return;
  if (ts + 2 < next) return;
  next = (next || ts) + FRAME_MS;
  if (next < ts) next = ts + FRAME_MS; // bị chậm quá lâu thì bắt nhịp lại
  const dt = Math.min(0.1, last ? (ts - last) / 1000 : 1 / 30);
  last = ts;
  fpsAcc += dt;
  fpsN += 1;
  if (fpsAcc >= 1) {
    scene.fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }
  scene.update(dt);
  scene.render();
}
requestAnimationFrame(loop);

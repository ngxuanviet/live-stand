// Trang quản trị: Nguồn & Sân khấu, Luật & Giá, Điều khiển trực tiếp, Test Panel.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');

const STATE_LABEL = { idle: 'Tắt', connecting: 'Đang kết nối', connected: 'Đã kết nối', offline: 'Chưa live, đang chờ', reconnecting: 'Đang kết nối lại', error: 'Lỗi' };
const PLATFORM_LABEL = { tiktok: 'TikTok', youtube: 'YouTube' };

const RULE_FIELDS = [
  { k: 'heartsPerMove', l: 'Số tim cho mỗi lần di chuyển', h: 'Vượt thêm mỗi N tim thì nhân vật di chuyển và nổi lên', min: 1, max: 100000 },
  { k: 'idleTimeoutSec', l: 'Tự rời sân sau (giây)', h: 'Ngừng tương tác quá lâu thì đi ra mép màn hình', min: 5, max: 86400 },
  { k: 'maxSlots', l: 'Số nhân vật tối đa dưới sân', h: 'VIP không tính vào số này', min: 1, max: 200 },
  { k: 'minStaySec', l: 'Ở lại tối thiểu khi sân đầy (giây)', h: 'Người mới không đẩy được người vừa xuất hiện', min: 0, max: 300 },
  { k: 'zBoostSec', l: 'Nổi lên trên cùng trong (giây)', h: 'Sau mỗi mốc tim', min: 1, max: 120 },
  { k: 'greetSec', l: 'Hiện tên khi xuất hiện (giây)', h: 'Chỉ hiện một lần khi mới xuất hiện', min: 1, max: 30 },
  { k: 'actionGreetSec', l: 'Hiện tên khi follow / share / bình luận (giây)', h: 'Cũng được tính đủ tim để di chuyển và nổi lên', min: 1, max: 60 },
  { k: 'actionCooldownSec', l: 'Nghỉ giữa hai lần thưởng (giây)', h: 'Chống spam bình luận / follow cho cùng một người', min: 0, max: 3600 },
  { k: 'simulatedTtlSec', l: 'Người xem test tự xoá sau (giây)', h: 'Áp dụng cho Test Panel', min: 5, max: 3600 },
];
const VIP_FIELDS = [
  { k: 'vipMinGift', l: 'Quà tối thiểu để xét VIP (diamond)', h: 'Tổng giá trị quà của một người', min: 0, max: 1e9 },
  { k: 'vipAbsentSec', l: 'Hiện "vắng" sau (giây không hoạt động)', h: 'VIP không có sự kiện nào quá lâu', min: 10, max: 86400 },
  { k: 'vipReleaseSec', l: 'Nhả ghế sau (giây vắng)', h: 'Chỉ dùng khi chọn chính sách "Nhả ghế"', min: 10, max: 604800 },
];

const NAMES = ['Minh Anh', 'Bảo Ngọc', 'Tuấn Kiệt', 'Thu Hà', 'Hoàng Long', 'Mai Linh', 'Đức Huy', 'Ngọc Trâm', 'Quốc Bảo', 'Khánh Vy', 'Gia Hân', 'Việt Cường', 'Lan Phương', 'Thanh Tùng', 'Hải Yến', 'Anh Khoa', 'Trúc Quỳnh', 'Nhật Nam', 'Bích Phượng', 'Đăng Khôi'];

const S = { sources: [], stages: [], stageId: localStorage.getItem('stageId') || '', tab: 'routing', vip: [], live: null, gifts: {}, pollTimer: null };

// ------------------------------------------------------------------ tiện ích
async function api(method, path, body) {
  const res = await fetch(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}

/** Chạy một thao tác, báo lỗi bằng toast, trả về kết quả hoặc undefined. */
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (e) {
    toast(e.message, true);
  }
}

const absUrl = (u) => (u.startsWith('/') ? location.origin + u : u);
const stage = () => S.stages.find((s) => s.id === S.stageId);

// ------------------------------------------------------------------ đăng nhập
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#pw').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('POST', '/login', { password: $('#pw').value });
    $('#pw').value = '';
    await start();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/logout').catch(() => {});
  location.reload();
});

// ------------------------------------------------------------------ khởi động
let socket = null;
async function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await reload();
  connectSocket();
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(() => {
    if (S.tab === 'live') refreshLive();
  }, 3000);
  setTab(location.hash.slice(1) || 'routing');
}

async function reload() {
  [S.sources, S.stages] = await Promise.all([api('GET', '/sources'), api('GET', '/stages')]);
  if (!stage()) S.stageId = S.stages[0]?.id || '';
  renderStagePick();
  renderRouting();
}

function connectSocket() {
  if (socket) return;
  socket = io('/admin');
  socket.on('connect', () => $('#rtDot').classList.add('ok'));
  socket.on('disconnect', () => $('#rtDot').classList.remove('ok'));
  socket.on('connect_error', () => $('#rtDot').classList.remove('ok'));
  const apply = (st) => {
    const src = S.sources.find((s) => s.id === st.sourceId);
    if (!src) return;
    src.status = st;
    if (S.tab === 'routing') renderSources();
    if (S.tab === 'live') renderLiveNote();
  };
  socket.on('statuses', (list) => list.forEach(apply));
  socket.on('status', apply);
  socket.on('vip', ({ stageId, vip }) => {
    if (stageId !== S.stageId) return;
    S.vip = vip;
    if (S.tab === 'live') renderVip();
  });
}

// ------------------------------------------------------------------ điều hướng
function setTab(tab) {
  if (!['routing', 'rules', 'live', 'test'].includes(tab)) tab = 'routing';
  S.tab = tab;
  location.hash = tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const needsStage = tab !== 'routing';
  $('#stagePickWrap').classList.toggle('hidden', !needsStage);
  $('#tab-routing').classList.toggle('hidden', needsStage);
  $('#stageTabs').classList.toggle('hidden', !needsStage);
  for (const t of ['rules', 'live', 'test']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
  if (!needsStage) return renderRouting();
  if (!stage()) {
    $('#stageTabs').classList.add('hidden');
    $('#tab-routing').classList.remove('hidden');
    toast('Hãy tạo một sân khấu trước', true);
    S.tab = 'routing';
    return;
  }
  renderPreview();
  if (tab === 'rules') renderRules();
  if (tab === 'live') refreshLive();
  if (tab === 'test') renderTest();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});

function renderStagePick() {
  const sel = $('#stagePick');
  sel.innerHTML = S.stages.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.width}×${s.height})</option>`).join('');
  sel.value = S.stageId;
}

$('#stagePick').addEventListener('change', (e) => {
  S.stageId = e.target.value;
  localStorage.setItem('stageId', S.stageId);
  S.vip = [];
  S.live = null;
  setTab(S.tab);
});

// ------------------------------------------------------------------ xem trước
let pvKey = '';
function renderPreview() {
  const st = stage();
  const box = $('#pv');
  if (!st) return;
  const safe = $('#pvSafe').checked ? 1 : 0;
  const key = `${st.id}|${st.token}|${safe}|${st.width}x${st.height}`;
  box.style.height = `${Math.round((box.clientWidth || 296) * (st.height / st.width))}px`;
  if (key === pvKey) return;
  pvKey = key;
  box.src = `/overlay/?stage_id=${encodeURIComponent(st.id)}&token=${encodeURIComponent(st.token)}&bg=checker&fit=1${safe ? '&safe=1' : ''}`;
}
$('#pvSafe').addEventListener('change', renderPreview);

// ------------------------------------------------------------------ 1. Nguồn & Sân khấu
function renderRouting() {
  renderSources();
  renderStages();
}

function statusChip(st) {
  if (!st) return '<span class="chip idle">Tắt</span>';
  const label = STATE_LABEL[st.state] || st.state;
  const warn = st.silent ? ' <span class="badge warn" title="Đã kết nối nhưng lâu không có event">im lặng</span>' : '';
  const detail = st.detail ? `<div class="mut" style="font-size:12px;margin-top:3px;max-width:340px">${esc(st.detail)}</div>` : '';
  return `<span class="chip ${esc(st.state)}">${esc(label)}</span>${warn}${detail}`;
}

function renderSources() {
  const rows = S.sources.map((s) => {
    const routes = S.stages.length
      ? S.stages.map((g) => `<label class="chk" style="margin-right:12px"><input type="checkbox" data-route="${esc(s.id)}" value="${esc(g.id)}" ${s.stageIds.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')
      : '<span class="mut">Chưa có sân khấu</span>';
    return `<tr>
      <td><span class="badge">${esc(PLATFORM_LABEL[s.platform] || s.platform)}</span></td>
      <td><b>${esc(s.handle)}</b></td>
      <td>${statusChip(s.status)}</td>
      <td><label class="switch"><input type="checkbox" data-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''}><span></span></label></td>
      <td>${routes}</td>
      <td><div class="row"><button class="btn sm" data-edit-src="${esc(s.id)}">Sửa</button><button class="btn sm dan" data-del-src="${esc(s.id)}">Xoá</button></div></td>
    </tr>`;
  });
  $('#srcTable').innerHTML = `<tr><th>Nền tảng</th><th>Username / ID</th><th>Trạng thái</th><th>Bật</th><th>Đổ vào sân khấu</th><th></th></tr>${rows.join('') || '<tr><td class="empty" colspan="6">Chưa có nguồn nào</td></tr>'}`;
}

function renderStages() {
  const rows = S.stages.map((g) => `<tr>
      <td><b>${esc(g.name)}</b><div class="mut mono">${esc(g.id)}</div></td>
      <td>${g.width}×${g.height}</td>
      <td><div class="copybox"><input readonly value="${esc(absUrl(g.overlayUrl))}" data-select><button class="btn sm" data-copy="${esc(g.id)}">Copy</button></div></td>
      <td><div class="row"><button class="btn sm" data-open-stage="${esc(g.id)}">Cấu hình</button><button class="btn sm" data-edit-stage="${esc(g.id)}">Sửa</button><button class="btn sm" data-token-stage="${esc(g.id)}" title="Đổi token: link cũ ngừng hoạt động">Token mới</button><button class="btn sm dan" data-del-stage="${esc(g.id)}">Xoá</button></div></td>
    </tr>`);
  $('#stageTable').innerHTML = `<tr><th>Sân khấu</th><th>Kích thước</th><th>Link Browser Source (OBS)</th><th></th></tr>${rows.join('') || '<tr><td class="empty" colspan="4">Chưa có sân khấu nào</td></tr>'}`;
}

$('#srcTable').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.toggle) {
    const ok = await act(() => api('PUT', `/sources/${t.dataset.toggle}`, { enabled: t.checked }));
    if (ok) await reload();
  } else if (t.dataset.route) {
    const id = t.dataset.route;
    const ids = $$(`input[data-route="${id}"]:checked`).map((c) => c.value);
    await act(() => api('PUT', `/sources/${id}/routes`, { stageIds: ids }), 'Đã cập nhật định tuyến');
    await reload();
  }
});

$('#srcTable').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit-src]');
  const del = e.target.closest('[data-del-src]');
  if (edit) {
    const src = S.sources.find((s) => s.id === edit.dataset.editSrc);
    const h = prompt('Username / ID mới:', src.handle);
    if (h && h !== src.handle && (await act(() => api('PUT', `/sources/${src.id}`, { handle: h }), 'Đã lưu'))) await reload();
  } else if (del) {
    const src = S.sources.find((s) => s.id === del.dataset.delSrc);
    if (confirm(`Xoá nguồn "${src.handle}"?`) && (await act(() => api('DELETE', `/sources/${src.id}`), 'Đã xoá nguồn'))) await reload();
  }
});

$('#srcAdd').addEventListener('click', async () => {
  const handle = $('#srcHandle').value.trim();
  if (!handle) return toast('Nhập username / ID', true);
  if (await act(() => api('POST', '/sources', { platform: $('#srcPlatform').value, handle }), 'Đã thêm nguồn')) {
    $('#srcHandle').value = '';
    await reload();
  }
});

$('#srcPlatform').addEventListener('change', (e) => {
  $('#srcHandle').placeholder = e.target.value === 'tiktok' ? 'Username TikTok (không cần @)' : 'ID video / kênh YouTube';
});

$('#stPreset').addEventListener('change', (e) => $('#stCustom').classList.toggle('hidden', e.target.value !== 'custom'));

$('#stAdd').addEventListener('click', async () => {
  const name = $('#stName').value.trim();
  if (!name) return toast('Nhập tên sân khấu', true);
  let [width, height] = $('#stPreset').value === 'custom' ? [+$('#stW').value, +$('#stH').value] : $('#stPreset').value.split('x').map(Number);
  const created = await act(() => api('POST', '/stages', { name, width, height }), 'Đã tạo sân khấu');
  if (created && created.id) {
    $('#stName').value = '';
    S.stageId = created.id;
    localStorage.setItem('stageId', S.stageId);
    await reload();
  }
});

$('#stageTable').addEventListener('click', async (e) => {
  const q = (a) => e.target.closest(`[${a}]`)?.getAttribute(a);
  const copy = q('data-copy');
  if (copy) {
    const url = absUrl(S.stages.find((s) => s.id === copy).overlayUrl);
    try {
      await navigator.clipboard.writeText(url);
      toast('Đã copy link');
    } catch {
      toast('Không copy được, hãy chọn và Ctrl+C', true);
    }
  }
  const open = q('data-open-stage');
  if (open) {
    S.stageId = open;
    localStorage.setItem('stageId', open);
    renderStagePick();
    setTab('rules');
  }
  const ed = q('data-edit-stage');
  if (ed) {
    const g = S.stages.find((s) => s.id === ed);
    $('#dName').value = g.name;
    $('#dW').value = g.width;
    $('#dH').value = g.height;
    $('#stageDlg').dataset.id = g.id;
    $('#stageDlg').showModal();
  }
  const tk = q('data-token-stage');
  if (tk && confirm('Đổi token? Link hiện tại trong OBS sẽ ngừng hoạt động và cần dán link mới.')) {
    if (await act(() => api('POST', `/stages/${tk}/token`), 'Đã tạo token mới')) await reload();
  }
  const del = q('data-del-stage');
  if (del) {
    const g = S.stages.find((s) => s.id === del);
    if (confirm(`Xoá sân khấu "${g.name}" và toàn bộ dữ liệu của nó?`) && (await act(() => api('DELETE', `/stages/${del}`), 'Đã xoá sân khấu'))) await reload();
  }
});
$('#stageTable').addEventListener('focusin', (e) => e.target.matches('[data-select]') && e.target.select());

$('#stageDlgForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  const id = $('#stageDlg').dataset.id;
  if (await act(() => api('PUT', `/stages/${id}`, { name: $('#dName').value, width: +$('#dW').value, height: +$('#dH').value }), 'Đã lưu')) await reload();
});

// ------------------------------------------------------------------ 2. Luật & Giá
function fieldHtml(f, v) {
  return `<label class="f">${esc(f.l)}<input type="number" data-k="${f.k}" min="${f.min}" max="${f.max}" value="${esc(v)}"><small>${esc(f.h)}</small></label>`;
}

function renderRules() {
  const st = stage();
  const set = st.settings;
  $('#ruleFields').innerHTML = RULE_FIELDS.map((f) => fieldHtml(f, set[f.k])).join('');
  $('#vipFields').innerHTML =
    VIP_FIELDS.map((f) => fieldHtml(f, set[f.k])).join('') +
    `<label class="f">Chính sách khi VIP vắng lâu<select data-k="vipAbsentPolicy"><option value="keep">Giữ ghế (chỉ hiện "vắng")</option><option value="release">Nhả ghế cho người kế tiếp</option></select><small>TikTok không có sự kiện rời phòng đáng tin, nên dùng thời gian không hoạt động</small></label>`;
  $('#vipFields [data-k=vipAbsentPolicy]').value = set.vipAbsentPolicy;
  S.gifts = { ...(set.giftValueOverrides || {}) };
  renderGifts();
  $('#fieldH').value = set.fieldHeightPx || 0;
  $('#safe').value = set.safeBottomPct;
  $('#safeVal').textContent = `${set.safeBottomPct}%`;
}

function renderGifts() {
  const rows = Object.entries(S.gifts).map(([id, v]) => `<tr><td class="mono">${esc(id)}</td><td>${fmt(v)} diamond</td><td><button class="btn sm dan" data-del-gift="${esc(id)}">Xoá</button></td></tr>`);
  $('#giftTable').innerHTML = rows.length ? `<tr><th>ID quà</th><th>Giá trị</th><th></th></tr>${rows.join('')}` : '<tr><td class="empty">Chưa có ghi đè nào</td></tr>';
}

$('#giftAdd').addEventListener('click', () => {
  const id = $('#giftId').value.trim();
  const v = Number($('#giftVal').value);
  if (!id || !Number.isFinite(v) || v < 0) return toast('Nhập ID quà và giá trị hợp lệ', true);
  S.gifts[id] = v;
  $('#giftId').value = '';
  $('#giftVal').value = '';
  renderGifts();
});
$('#giftTable').addEventListener('click', (e) => {
  const id = e.target.closest('[data-del-gift]')?.dataset.delGift;
  if (id) {
    delete S.gifts[id];
    renderGifts();
  }
});

$('#saveRules').addEventListener('click', async () => {
  const settings = {};
  $$('#tab-rules [data-k]').forEach((el) => (settings[el.dataset.k] = el.tagName === 'SELECT' ? el.value : Number(el.value)));
  settings.giftValueOverrides = S.gifts;
  settings.safeBottomPct = Number($('#safe').value);
  settings.fieldHeightPx = Math.max(0, Number($('#fieldH').value) || 0);
  const g = await act(() => api('PUT', `/stages/${S.stageId}`, { settings }), 'Đã lưu cấu hình');
  if (g && g.id) {
    S.stages = S.stages.map((s) => (s.id === g.id ? g : s));
    renderRules();
  }
});

let fieldTimer = 0;
$('#fieldH').addEventListener('input', (e) => {
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(async () => {
    const g = await act(() => api('PUT', `/stages/${S.stageId}`, { settings: { fieldHeightPx: Math.max(0, Number(e.target.value) || 0) } }));
    if (g && g.id) S.stages = S.stages.map((s) => (s.id === g.id ? g : s));
  }, 350);
});

let safeTimer = 0;
$('#safe').addEventListener('input', (e) => {
  $('#safeVal').textContent = `${e.target.value}%`;
  clearTimeout(safeTimer);
  safeTimer = setTimeout(async () => {
    const g = await act(() => api('PUT', `/stages/${S.stageId}`, { settings: { safeBottomPct: Number(e.target.value) } }));
    if (g && g.id) S.stages = S.stages.map((s) => (s.id === g.id ? g : s));
  }, 250);
});

// ------------------------------------------------------------------ 3. Điều khiển trực tiếp
async function refreshLive() {
  if (!S.stageId) return;
  try {
    S.live = await api('GET', `/stages/${S.stageId}/state`);
    S.vip = S.live.vip;
    if (S.tab === 'live') {
      renderPollStat();
      renderLiveStat();
      renderVip();
      renderLiveNote();
    }
  } catch {
    /* im lặng: lần poll sau sẽ thử lại */
  }
}

function renderLiveStat() {
  const l = S.live;
  $('#liveStat').innerHTML = `<div><b>${l.fieldCount}</b><span>nhân vật dưới sân</span></div><div><b>${l.vip.length}/5</b><span>ghế VIP có người</span></div><div><b>${l.userCount}</b><span>người dùng trong phiên</span></div>`;
}

function renderLiveNote() {
  const linked = S.sources.filter((s) => s.stageIds.includes(S.stageId));
  const html = !linked.length
    ? '<div class="note">Sân khấu này chưa nhận dữ liệu từ nguồn nào. Ghép nguồn ở tab "Nguồn &amp; Sân khấu", hoặc dùng Test Panel.</div>'
    : linked.map((s) => `<span class="row" style="margin-right:14px">${esc(PLATFORM_LABEL[s.platform])} <b>${esc(s.handle)}</b> ${statusChip(s.status)}</span>`).join('');
  $('#liveNote').innerHTML = html;
}

function renderVip() {
  const rows = S.vip.map((v) => `<tr>
    <td><b>#${v.rank}</b></td>
    <td>${esc(v.name)} ${v.simulated ? '<span class="badge sim">test</span>' : ''}${v.absent ? ' <span class="badge warn">vắng</span>' : ''}<div class="mut mono">${esc(v.key)}</div></td>
    <td>${fmt(v.giftTotal)} ◆</td>
    <td><button class="btn sm dan" data-kick="${esc(v.key)}">Kick</button></td></tr>`);
  $('#vipTable').innerHTML = `<tr><th>Hạng</th><th>Người xem</th><th>Tổng quà</th><th></th></tr>${rows.join('') || '<tr><td class="empty" colspan="4">Chưa có ai trên ghế VIP</td></tr>'}`;
}

$('#vipTable').addEventListener('click', async (e) => {
  const key = e.target.closest('[data-kick]')?.dataset.kick;
  if (!key) return;
  const v = S.vip.find((x) => x.key === key);
  if (confirm(`Đá "${v?.name}" khỏi ghế VIP? (Họ được xét lại khi tặng quà mới.)`) && (await act(() => api('POST', `/stages/${S.stageId}/kick`, { userKey: key }), 'Đã Kick'))) refreshLive();
});

// ---- Bình chọn
function renderPollStat() {
  const p = S.live?.poll;
  if (!p) {
    $('#pStat').innerHTML = '<span class="mut">Chưa có bình chọn nào đang chạy.</span>';
  } else if (p.status === 'active') {
    const left = Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000));
    $('#pStat').innerHTML = `<div class="note">Đang bình chọn${p.question ? `: <b>${esc(p.question)}</b>` : ''} · còn <b>${left}</b> giây<br>${esc(p.labels[0])}: <b>${p.counts[0]}</b> phiếu · ${esc(p.labels[1])}: <b>${p.counts[1]}</b> phiếu</div>`;
  } else {
    const r = p.result === 'tie' ? 'Hoà' : `${esc(p.labels[p.result])} thắng`;
    $('#pStat').innerHTML = `<div class="note">Đã kết thúc: <b>${r}</b> (${p.counts[0]} – ${p.counts[1]}). Đang hiện kết quả trên overlay.</div>`;
  }
}

$('#pStart').addEventListener('click', async () => {
  const body = {
    question: $('#pQ').value,
    labelA: $('#pLA').value,
    labelB: $('#pLB').value,
    keywordA: $('#pKA').value,
    keywordB: $('#pKB').value,
    durationSec: $('#pDur').value,
    resultSec: $('#pRes').value,
  };
  if (S.live?.poll?.status === 'active' && !confirm('Đang có bình chọn chạy. Bắt đầu cái mới sẽ xoá phiếu hiện tại. Tiếp tục?')) return;
  if (await act(() => api('POST', `/stages/${S.stageId}/poll`, body), 'Đã bắt đầu bình chọn')) refreshLive();
});
$('#pEnd').addEventListener('click', async () => {
  if (await act(() => api('POST', `/stages/${S.stageId}/poll/end`, {}), 'Đã chốt kết quả')) refreshLive();
});
$('#pCancel').addEventListener('click', async () => {
  if (await act(() => api('DELETE', `/stages/${S.stageId}/poll`), 'Đã huỷ bình chọn')) refreshLive();
});
setInterval(() => S.tab === 'live' && S.live && renderPollStat(), 1000); // đồng hồ đếm ngược mượt giữa hai lần poll

const resetBtn = (sel, path, msg, ok, body) =>
  $(sel).addEventListener('click', async () => {
    if (confirm(msg) && (await act(() => api('POST', `/stages/${S.stageId}/${path}`, body ? body() : {}), ok))) refreshLive();
  });
resetBtn('#resetStage', 'reset', 'Xoá sạch nhân vật đang chạy trên sân khấu? (VIP được giữ)', 'Đã reset sân khấu', () => ({ hearts: $('#resetHearts').checked }));
resetBtn('#resetVip', 'reset-vip', 'Xoá trắng bảng Top 5 VIP và điểm quà?', 'Đã reset bảng VIP');
resetBtn('#resetAll', 'reset-all', 'Xoá TOÀN BỘ dữ liệu sân khấu (nhân vật, tim, quà, VIP)? Không thể hoàn tác.', 'Đã xoá toàn bộ dữ liệu');

// ------------------------------------------------------------------ 4. Test Panel
function renderTest() {
  $('#ttl').textContent = stage().settings.simulatedTtlSec;
  const linked = S.sources.filter((s) => s.stageIds.includes(S.stageId) && s.enabled);
  $('#testNote').innerHTML = linked.length
    ? `<div class="note">Sân khấu này đang nhận dữ liệu thật từ ${linked.map((s) => esc(s.handle)).join(', ')}. Sự kiện giả lập sẽ hiện lẫn trên màn hình đang live.</div>`
    : '';
}

function log(msg) {
  const d = document.createElement('div');
  d.textContent = `${new Date().toLocaleTimeString('vi-VN')}  ${msg}`;
  $('#tLog').prepend(d);
  while ($('#tLog').children.length > 80) $('#tLog').lastChild.remove();
}

const avatarFor = (name) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `https://i.pravatar.cc/96?img=${(h % 70) + 1}`;
};

async function sim(extra, label) {
  const name = extra.username || $('#tName').value.trim() || 'Tester';
  const body = { username: name, avatar: avatarFor(name), ...extra };
  if (await act(() => api('POST', `/stages/${S.stageId}/simulate`, body))) log(`${label} · ${name}`);
}

$('#tJoin').addEventListener('click', () => sim({ type: 'join' }, 'Join'));
$('#tLeave').addEventListener('click', () => sim({ type: 'leave' }, 'Leave'));
$('#tFollow').addEventListener('click', () => sim({ type: 'follow' }, 'Follow'));
$('#tShare').addEventListener('click', () => sim({ type: 'share' }, 'Share'));
$('#tChat').addEventListener('click', () => sim({ type: 'chat' }, 'Bình luận'));
$('#tLike').addEventListener('click', () => sim({ type: 'like', value: Math.max(1, +$('#tLikes').value || 1) }, `+${$('#tLikes').value} tim`));
$('#tGift').addEventListener('click', () =>
  sim(
    {
      type: 'gift',
      giftName: $('#tGiftName').value || 'Quà test',
      giftId: `test-${$('#tGiftName').value || 'gift'}`,
      diamondValue: +$('#tGiftVal').value || 0,
      repeatCount: Math.max(1, +$('#tGiftRep').value || 1),
      combo: $('#tCombo').checked,
      streakEnded: !$('#tCombo').checked,
    },
    `Quà ${$('#tGiftName').value} x${$('#tGiftRep').value} (${$('#tGiftVal').value}◆)`,
  ),
);

const voteWord = (side) => ($(side ? '#pKB' : '#pKA').value || (side ? '2' : '1')).trim();
$('#tVoteA').addEventListener('click', () => sim({ type: 'chat', text: voteWord(0) }, 'Bầu A'));
$('#tVoteB').addEventListener('click', () => sim({ type: 'chat', text: voteWord(1) }, 'Bầu B'));
$('#tVoteBulk').addEventListener('click', async () => {
  const n = Math.min(60, Math.max(1, +$('#tVoteN').value || 1));
  const pool = [...NAMES].sort(() => Math.random() - 0.5);
  await Promise.all(Array.from({ length: n }, (_, i) => {
    const name = pool[i % pool.length] + (i >= pool.length ? ` ${i}` : '');
    return api('POST', `/stages/${S.stageId}/simulate`, { type: 'chat', username: name, avatar: avatarFor(name), text: voteWord(Math.random() < 0.5 ? 0 : 1) }).catch((e) => toast(e.message, true));
  }));
  log(`${n} người bầu ngẫu nhiên`);
});

$('#tBulkGo').addEventListener('click', async () => {
  const n = Math.min(60, Math.max(1, +$('#tBulk').value || 1));
  const pool = [...NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i += 6) {
    await Promise.all(Array.from({ length: Math.min(6, n - i) }, (_, j) => {
      const name = pool[(i + j) % pool.length] + (i + j >= pool.length ? ` ${i + j}` : '');
      return api('POST', `/stages/${S.stageId}/simulate`, { type: 'like', username: name, avatar: avatarFor(name), value: 1 + Math.floor(Math.random() * 14) }).catch((e) => toast(e.message, true));
    }));
  }
  log(`Thả tim ngẫu nhiên cho ${n} người`);
});

$('#tBulkGift').addEventListener('click', async () => {
  const pool = [...NAMES].sort(() => Math.random() - 0.5).slice(0, 5);
  await Promise.all(pool.map((name, i) => api('POST', `/stages/${S.stageId}/simulate`, { type: 'gift', username: name, avatar: avatarFor(name), giftName: 'Quà test', diamondValue: (i + 1) * 500 }).catch((e) => toast(e.message, true))));
  log('Tặng quà ngẫu nhiên cho 5 người');
});

// ------------------------------------------------------------------ vào trang
(async () => {
  try {
    await api('GET', '/me');
    await start();
  } catch {
    showLogin();
  }
})();

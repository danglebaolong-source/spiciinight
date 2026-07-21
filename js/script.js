// ─── CARD POOLS đã tách sang cards.js (load trước script.js) ──

// ─── UI STRINGS ─────────────────────────────────────────────────
// Tập trung các chuỗi text dùng trên UI để dễ chỉnh và i18n sau này.
// LƯU Ý: Phải khai báo TRƯỚC mọi hàm có reference tới UI_STRINGS để
// tránh ReferenceError (đặc biệt ở showEndScreen → màn kết thúc).
const UI_STRINGS = {
  cardFooter:        'Hoàn thành xong nhấn Tiếp theo',
  rulesContent:
    '• Thay vì những lá bài vật lý ngẫu nhiên dễ làm đứt gãy mạch cảm xúc, chúng tôi thiết kế một session game đặc biệt giúp giữ cho nhiệt độ và mạch cảm xúc của bạn luôn đi lên một cách tự nhiên, có sắp xếp.<br><br>'
  + '• Bộ bài sẽ chỉ gồm các câu hỏi và yêu cầu trực diện. Bạn có toàn quyền tự thiết kế Dare (hình phạt) riêng sao cho phù hợp với không gian và độ thân mật.',
};

// Tên hiển thị của mỗi Level — khớp với text trên #screen-level, dùng lại
// cho nút "Nâng nhiệt" ở màn kết thúc.
const LEVEL_NAMES = {
  1: 'Nhẹ nhàng và gắn kết',
  2: 'Riêng tư và tinh tế',
  3: 'Táo bạo và cuồng nhiệt',
};

// ─── RULES MODAL ────────────────────────────────────────────────
// HTML chỉ giữ placeholder text; nội dung thật được inject từ
// UI_STRINGS.rulesContent (dùng innerHTML để hỗ trợ <br>).
function openRules() {
  const modal = document.getElementById('modal-rules');
  const content = document.getElementById('modal-rules-content');
  if (content) content.innerHTML = UI_STRINGS.rulesContent;
  if (modal) modal.classList.remove('hidden');
}

function closeRules() {
  const modal = document.getElementById('modal-rules');
  if (modal) modal.classList.add('hidden');
}

// ─── TOAST (safety net cho các thông báo ngắn, vd goBackCard) ────
let _toastTimer = null;
function showToast(message, duration) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration || 1500);
}

// No-op fallback — flow history navigation gọi updateNextButtonText()
// nhưng hàm chưa được implement đầy đủ. Định nghĩa stub để tránh
// ReferenceError chặn flow. Có thể nâng cấp sau nếu muốn đổi label nút
// Tiếp theo theo ngữ cảnh.
function updateNextButtonText() {
  try {
    const _script = window._activeSession || currentSession;
    const isLast = scriptIndex >= _script.length - 1;
    const nextBtn = document.querySelector('#action-row .next-btn');
    if (nextBtn) nextBtn.textContent = isLast ? 'Kết thúc 🏁' : 'Tiếp theo';
  } catch (_) { /* no-op */ }
}


// ─── SESSION STATE ──────────────────────────────────────────────
// Mảng card cho session hiện tại. Populated bởi window.generateSession
// (xem engine.js). UI script chỉ đọc, không tự pick.
let currentSession = [];

// Sinh mảng card cho session — delegate qua engine.js (window.generateSession).
// Trả về ARRAY OF CARD OBJECTS (không còn array heat numbers như cũ).
// Engine đã handle: tag routing N, nearest-rank heat sampling, mutex,
// duplicate guard, cooldown adjacency, level=3→wild override.
function generateDynamicScript(level, totalCards) {
  if (typeof window.generateSession !== 'function') {
    console.error('[script] window.generateSession not loaded — engine.js missing?');
    return [];
  }
  return window.generateSession(selectedMode, level, players.length, totalCards);
}

// Tính tổng số lá session dựa trên số người chơi.
// 2 người (Dating/Couple/Friend-s-2) → 7 lá cố định.
// Friend-s >2 người → 7 + 3 lá cho mỗi người thêm (N=3→10, N=4→13, ...).
function computeTotalCards(nPlayers) {
  if (nPlayers === 2) return 7;
  return 7 + 3 * (nPlayers - 2);
}


// Stage labels theo heat
function getStage(heat) {
  if (heat <= 20)  return { label: 'Ice Breaker', color: '#4caf7d', bg: 'rgba(76,175,125,0.15)' };
  if (heat <= 40)  return { label: 'Personal',    color: '#e09a3a', bg: 'rgba(224,154,58,0.15)' };
  if (heat <= 60)  return { label: 'Flirty',      color: '#d4537e', bg: 'rgba(212,83,126,0.15)' };
  if (heat <= 80)  return { label: 'Intimate',    color: '#c07040', bg: 'rgba(192,112,64,0.15)' };
  return                  { label: 'Dangerous',   color: '#c0392b', bg: 'rgba(192,57,43,0.15)' };
}

// ─── STATE ───────────────────────────────────────────────────────
let selectedMode = '';
let numPlayers = 0;
let selectedLevel = 0;
let players = [];
let scriptIndex = 0;
let currentPlayer = 0;
let flipped = false;
let cardHistory = [];    // stack lá đã hiện, hỗ trợ Quay lại / Tiếp theo
let cardHistoryIdx = -1; // vị trí hiện tại trong history

// ─── SETUP ───────────────────────────────────────────────────────
function selectMode(mode, el) {
  selectedMode = mode;
  document.querySelectorAll('.level-card').forEach(b => b.classList.remove('selected','mode-selected'));
  el.classList.add('selected');

  const sectionPlayers = document.getElementById('section-players');
  const grid = document.getElementById('player-grid');

  if (mode === 'group') {
    // Friend-s (group): cho user chọn từ 2 → 8 người chơi (cap tối đa).
    // Số 2 nay là option hợp lệ — kéo theo level 3 sẽ bị ẩn ở màn Level
    // (xem goToLevelScreen).
    sectionPlayers.style.display = 'block';
    grid.innerHTML = [2,3,4,5,6,8].map(n =>
      `<button class="option-btn" onclick="selectPlayers(${n},this)">${n} người</button>`
    ).join('');
    numPlayers = 0;
  } else {
    sectionPlayers.style.display = 'none';
    numPlayers = 2;
  }
  selectedLevel = 0;
  const levelBtn = document.getElementById('level-next-btn');
  if (levelBtn) { levelBtn.disabled = true; }
  document.querySelectorAll('#screen-level .level-card').forEach(b => b.classList.remove('selected'));
  checkReady();
}

function selectPlayers(n, el) {
  numPlayers = n;
  document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  checkReady();
}

// ─── ROUTING TỪ SETUP → LEVEL ────────────────────────────────────
// mode === 'group' && numPlayers === 2 → Level 3 (Wild) bị ẩn/chặn.
// Dùng chung cho cả màn chọn Level lẫn nút "Nâng nhiệt" ở màn kết thúc.
function isLevel3Hidden() {
  return selectedMode === 'group' && numPlayers === 2;
}

// Bọc showScreen('screen-level') để gài điều kiện ẩn/hiện Level 3 ở
// thời điểm chuyển màn. Quy tắc:
//   • mode === 'group' && numPlayers === 2 → ẨN Level 3.
//   • mode === 'group' && numPlayers >  2 → HIỆN cả 3 level.
//   • mode !== 'group' (couple / firstdate) → HIỆN cả 3 level (giữ
//     hành vi cũ — couple/dating vẫn full quyền chọn Wild Habanero).
function applyLevelVisibility() {
  const level3 = document.getElementById('level-card-3')
              || document.querySelector('#screen-level .level-card.l3');
  if (!level3) return;
  const hide = isLevel3Hidden();
  level3.style.display = hide ? 'none' : '';
  // Nếu Level 3 đang được chọn nhưng vừa bị ẩn → reset selection để
  // tránh trạng thái "đã chọn nhưng không thấy".
  if (hide && selectedLevel === 3) {
    selectedLevel = 0;
    document.querySelectorAll('#screen-level .level-card').forEach(b => b.classList.remove('selected'));
    const levelBtn = document.getElementById('level-next-btn');
    if (levelBtn) levelBtn.disabled = true;
  }
}

function goToLevelScreen() {
  applyLevelVisibility();
  showScreen('screen-level');
}
function selectLevel(l, el) {
  selectedLevel = l;
  document.querySelectorAll('#screen-level .level-card').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('level-next-btn').disabled = false;
}
function checkReady() {
  // Setup: chỉ cần mode + numPlayers
  const ready = selectedMode !== '' && numPlayers > 0;
  document.getElementById('start-btn').disabled = !ready;
}
function pickGender(el) {
  const group = el.closest('.gender-pick-group');
  if (!group) return;
  group.querySelectorAll('.gender-static').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
}

function goToNames() {
  const list = document.getElementById('name-list');
  list.innerHTML = '';
  const count = Math.min(numPlayers, 8);

  // Label placeholder theo mode
  const placeholders = {
    firstdate: ['Bạn là...', 'Đối phương là...'],
    couple: ['Bạn là...', 'Đối phương là...'],
    group: Array.from({length:8}, (_,i) => 'Người chơi ' + (i+1)),
  };
  const ph = placeholders[selectedMode] || placeholders.group;

  for (let i = 1; i <= count; i++) {
    list.innerHTML += `
      <div class="name-row">
        <div class="player-num">${i}</div>
        <input class="name-input" id="pname-${i}" type="text" placeholder="${ph[i-1] || 'Người '+i}" maxlength="16">
        <div class="gender-pick-group" data-player="${i}">
          <div class="gender-static active" data-gender="nu"  onclick="pickGender(this)">Nữ</div>
          <div class="gender-static"        data-gender="nam" onclick="pickGender(this)">Nam</div>
        </div>
      </div>`;
  }
  // namesSubtitle giờ rỗng — clear element
  const subEl = document.getElementById('names-sub');
  if (subEl) subEl.textContent = '';
  showScreen('screen-names');
}
function startGame() {
  players = [];
  const count = Math.min(numPlayers, 8);
  for (let i = 1; i <= count; i++) {
    const name = document.getElementById('pname-' + i)?.value.trim() || 'Người ' + i;
    const activeEl = document.querySelector('.gender-pick-group[data-player="' + i + '"] .gender-static.active');
    const gender = activeEl ? activeEl.dataset.gender : 'nu';
    players.push({ name, gender });
  }
  scriptIndex = 0;
  currentPlayer = 0;
  cardHistory = [];
  cardHistoryIdx = -1;
  // ─── Tính tổng số lá bài + sinh kịch bản động ───────────────
  // totalCards = 7 nếu 2 người (couple/firstdate/group-2),
  // ngược lại 7 + 3 × (players.length - 2) (group ≥3).
  const totalCards = computeTotalCards(players.length);
  currentSession = generateDynamicScript(selectedLevel, totalCards);
  window._activeSession = currentSession;
  showScreen('screen-game');
  _pickAndPushCard();
  renderTurn();
  showBack();
}

// ─── VERTICAL NEON THERMOMETER ───────────────────────────────────
// Cập nhật nhiệt kế dọc: set height % cho .heat-filler, đổi gradient
// + glow theo zone nhiệt, toggle class .heat-fever khi > 70%.
//
// Bảng zone:
//   targetHeat <30%      → tím → xanh dương (cold)
//   targetHeat 30-60%    → xanh dương → cam (warm)
//   targetHeat >60%      → cam → đỏ rực (hot)
//
//   targetHeat >70%      → kích hoạt .heat-fever (pulse breathing)
function updateProgressBar(targetHeat, isCooldown) {
  const filler = document.getElementById('heat-filler-el');
  const bulb = document.querySelector('.thermometer-bulb');
  if (!filler) return;

  // Cooldown: tụt về 25% và giữ vibe xanh dịu để nhấn mạnh cảm giác hạ nhiệt
  const heatPct = Math.max(0, Math.min(100, isCooldown ? 25 : targetHeat));

  // Chọn gradient + glow theo zone
  let gradient, glow, bulbBg;
  if (heatPct < 30) {
    gradient = 'linear-gradient(0deg, #9b51e0, #2d9cdb)';
    glow = '0 0 12px #2d9cdb, 0 0 20px rgba(155,81,224,0.45)';
    bulbBg = 'linear-gradient(135deg, #9b51e0, #2d9cdb)';
  } else if (heatPct < 60) {
    gradient = 'linear-gradient(0deg, #2d9cdb, #f2994a)';
    glow = '0 0 14px #f2994a, 0 0 22px rgba(45,156,219,0.45)';
    bulbBg = 'linear-gradient(135deg, #2d9cdb, #f2994a)';
  } else {
    gradient = 'linear-gradient(0deg, #f2994a, #eb5757)';
    glow = '0 0 18px #eb5757, 0 0 28px rgba(242,153,74,0.55)';
    bulbBg = 'linear-gradient(135deg, #f2994a, #eb5757)';
  }

  filler.style.height = heatPct + '%';
  filler.style.background = gradient;
  filler.style.boxShadow = glow;

  if (bulb) {
    bulb.style.background = bulbBg;
    bulb.style.boxShadow = glow + ', inset 0 -2px 4px rgba(0,0,0,0.3)';
  }

  // Pulse "thở" khi cực nóng
  if (heatPct > 70 && !isCooldown) {
    filler.classList.add('heat-fever');
  } else {
    filler.classList.remove('heat-fever');
  }
}

// ─── RENDER ──────────────────────────────────────────────────────
function renderTurn() {
  const nameEl = document.getElementById('turn-name');
  nameEl.classList.remove('name-anim');
  void nameEl.offsetWidth;
  nameEl.classList.add('name-anim');
  nameEl.textContent = players[currentPlayer].name;
  // Ưu tiên window._currentCard (lá THẬT SỰ đã qua pickCard()); fallback về
  // slot card nếu _pickAndPushCard() chưa chạy (race hiếm).
  const card = window._currentCard || (window._activeSession || currentSession)[scriptIndex];
  const heat = (card && typeof card.heat === 'number') ? card.heat : 50;
  const isCooldown = !!(card && card.type === 'cooldown');
  const stage = getStage(heat);
  // Cập nhật nhiệt kế dọc (Vertical Neon Thermometer)
  updateProgressBar(heat, isCooldown);
  const topBar = document.getElementById('heat-bar-top');
  if (topBar) {
    const displayHeat = selectedLevel === 3 ? Math.max(heat, 50) : heat;
    topBar.style.width = displayHeat + '%';
  }
  const sb = document.getElementById('stage-badge');
  sb.textContent = isCooldown ? '✦ Cooldown' : stage.label;
  sb.style.background = isCooldown ? 'rgba(58,142,212,0.15)' : stage.bg;
  sb.style.color = isCooldown ? '#3a8ed4' : stage.color;
  sb.style.border = '1px solid ' + (isCooldown ? '#3a8ed488' : stage.color + '44');

  // Update app background theo heat stage
  const appEl = document.getElementById('app-root');
  if (appEl) {
    appEl.className = appEl.className.replace(/heat-\w+/g, '').trim();
    const bgClass = heat <= 20 ? 'heat-ice' :
                    heat <= 40 ? 'heat-personal' :
                    heat <= 60 ? 'heat-flirty' :
                    heat <= 80 ? 'heat-intimate' : 'heat-danger';
    appEl.classList.add(bgClass);
  }
}

function showBack() {
  flipped = false;
  const flipper = document.getElementById('card-flipper');
  flipper.classList.remove('flipped');
  const front = document.getElementById('card-front');
  front.className = 'card-face-3d card-face-front';
  (function(){const _ar=document.getElementById('action-row');_ar.classList.add('hidden');_ar.style.display='none';})();
  // Reset consent overlay
  const consentEl = document.getElementById('consent-overlay');
  if (consentEl) consentEl.classList.add('hidden');
  window._pendingCard = null;
  const el2 = document.getElementById('card-badge-el');
  if (el2) el2.style.cssText = '';
  const skipB = document.getElementById('skip-btn-el');
  if (skipB) skipB.style.display = '';
  const ft = document.getElementById('card-footer-text');
  if (ft) { ft.style.display = ''; ft.textContent = 'Hoàn thành xong nhấn Tiếp theo'; }
  const cd = document.getElementById('card-content');
  if (cd) cd.style.display = '';
}

function flipCard() {
  if (flipped) return;
  flipped = true;
  // Card đã được pick + push từ startGame/replayGame/nextCard standard advance.
  // Safety fallback: nếu chưa pick (race hoặc legacy), pick ngay.
  if (!window._currentCard) _pickAndPushCard();
  const card = window._currentCard;

  const typeLabel = { truth:'Truth', dare:'Dare', cooldown:'Cooldown', dark:'Dark' };
  const typeClass  = { truth:'badge-truth', dare:'badge-dare', cooldown:'badge-cooldown', dark:'badge-dark' };
  const glowClass  = { truth:'glow-green', dare:'glow-pink', cooldown:'glow-amber', dark:'glow-dark' };

  const el = document.getElementById('card-badge-el');
  const front = document.getElementById('card-front');
  const contentEl = document.getElementById('card-content');
  const footerEl = document.getElementById('card-footer-text');

  el.style.cssText = '';

  // Dark card với intensity 3 — consent check trước (giữ nguyên flow này)
  const consentEl = document.getElementById('consent-overlay');
  if (card.type === 'dark' && card.intensity >= 3 && consentEl) {
    consentEl.classList.remove('hidden');
    contentEl.style.display = 'none';
    footerEl.style.display = 'none';
    front.className = 'card-face-3d card-face-front is-dark';
    el.textContent = 'Dark';
    el.className = 'card-type-badge badge-dark';
    window._pendingCard = card;
    document.getElementById('card-flipper').classList.add('flipped');
    playSound('flip');
    hapticVibrate(3);
    return;
  }
  if (consentEl) consentEl.classList.add('hidden');

  contentEl.style.display = '';
  footerEl.style.display = '';
  footerEl.textContent = 'Hoàn thành xong nhấn Tiếp theo';

  el.textContent = typeLabel[card.type] || card.type || 'Truth';
  el.className = 'card-type-badge ' + (typeClass[card.type] || '');
  contentEl.textContent = renderText(card.text);

  // Style card theo type + intensity glow
  let cardClass = 'card-face-3d card-face-front';
  if (card.type === 'dark')     cardClass += ' is-dark';
  if (card.type === 'cooldown') cardClass += ' is-cooldown';
  if (card.intensity)           cardClass += ' intensity-' + card.intensity;
  front.className = cardClass;

  (function(){const _ar=document.getElementById('action-row');_ar.classList.remove('hidden');_ar.style.display='flex';})();

  // Haptic cho intensity cao + heat 100
  if (card.intensity >= 3 || card.heat >= 100) hapticVibrate(card.intensity || 3);
  if (card.heat >= 100 && 'vibrate' in navigator) navigator.vibrate([200]);

  document.getElementById('card-flipper').classList.add('flipped');
  playSound('flip');
}

// ─── CARD PICKING ─────────────────────────────────────────────────

function pickCard() {
  // ENGINE-DRIVEN PICK: session đã được window.generateSession pre-build
  // sẵn toàn bộ card. Hàm này chỉ trả card kế tiếp trong currentSession
  // theo scriptIndex — mọi logic phức tạp (tag filter, mutex, heat floor,
  // finale, fallback) đã được engine.js xử lý gọn ở phía generateSession.
  const session = window._activeSession || currentSession;
  const card = session[scriptIndex];
  if (!card) {
    console.warn('[pickCard] scriptIndex out of range:', scriptIndex);
    return { type:'truth', heat:0, text:'Kho bài đã hết — cảm ơn các bạn đã chơi tới giờ này 🌶️' };
  }
  return card;
}

// ─── TEXT RENDERING ───────────────────────────────────────────────
// Delegate {ME}/{RANDOM}/{ALL} sang engine.js (window.renderCardText).
// Giữ legacy {P1}/{P2}/{anh_chi_P1}/{anh_chi_P2} cho card cũ nếu có.
// {RANDOM_AC} sau migration đã được replace thành {RANDOM} hết → defensive
// fallback bằng 'bạn' nếu sót.
function renderText(tpl) {
  if (!tpl) return '';
  const p1 = players[0] || { name: 'Người 1', gender: 'khac' };
  const p2 = players[1] || players[0] || { name: 'Người 2', gender: 'khac' };
  function ac(p) {
    if (!p) return 'bạn';
    if (p.gender === 'nam') return 'anh';
    if (p.gender === 'nu') return 'cô';
    return 'bạn';
  }
  const currentName = (players[currentPlayer] && players[currentPlayer].name) || p1.name;
  const playerNames = players.map(p => p.name);

  // Tokens mới ({ME}, {RANDOM}, {ALL}) — qua engine
  let out = tpl;
  if (typeof window.renderCardText === 'function') {
    out = window.renderCardText(out, currentName, playerNames);
  }

  // Legacy tokens cho backward compat
  out = out
    .replace(/{P1}/g, p1.name)
    .replace(/{P2}/g, p2.name)
    .replace(/{anh_chi_P1}/g, ac(p1))
    .replace(/{anh_chi_P2}/g, ac(p2))
    .replace(/{RANDOM_AC}/g, 'bạn');
  return out;
}

// ─── ACTIONS ──────────────────────────────────────────────────────

// Render lá cũ từ history. KHÔNG advance state, KHÔNG kích lại gate.
// Accept history item ({card, player, slotIdx}) hoặc card object trực tiếp.
//   - Truth/Dare/Cooldown/Dark: hiện nội dung, ẩn mọi overlay
//   - Dark (đã consent): KHÔNG hiện lại consent gate
function renderCardSimple(item) {
  const card = item && item.card ? item.card : item;

  // Defensive: mark card front đang hiện (gate flag cho mọi handler khác)
  flipped = true;
  document.getElementById('card-flipper').classList.add('flipped');

  const typeLabel = { truth:'Truth', dare:'Dare', cooldown:'Cooldown', dark:'Dark' };
  const typeClass = { truth:'badge-truth', dare:'badge-dare', cooldown:'badge-cooldown', dark:'badge-dark' };
  const el = document.getElementById('card-badge-el');
  const front = document.getElementById('card-front');
  const contentEl = document.getElementById('card-content');
  const footerEl = document.getElementById('card-footer-text');
  const consentEl = document.getElementById('consent-overlay');

  // LUÔN ẩn consent gate (lá Dangerous đã được consent rồi)
  if (consentEl) consentEl.classList.add('hidden');

  // Reset badge inline style
  el.style.cssText = '';

  el.textContent = typeLabel[card.type] || card.type || 'Truth';
  el.className = 'card-type-badge ' + (typeClass[card.type] || '');
  let cardClass = 'card-face-3d card-face-front';
  if (card.type === 'dark')     cardClass += ' is-dark';
  if (card.type === 'cooldown') cardClass += ' is-cooldown';
  if (card.intensity)           cardClass += ' intensity-' + card.intensity;
  front.className = cardClass;
  contentEl.style.display = '';
  contentEl.textContent = renderText(card.text);
  footerEl.style.display = '';
  footerEl.textContent = UI_STRINGS.cardFooter || 'Hoàn thành xong nhấn Tiếp theo';

  // Action row luôn hiện (Quay lại + Tiếp theo)
  (function(){const _ar=document.getElementById('action-row');_ar.classList.remove('hidden');_ar.style.display='flex';})();

  updateNextButtonText();
}

// Helper — pick card mới cho slot hiện tại + push vào history.
// Gọi từ startGame, replayGame, và nextCard standard advance.
// Đảm bảo cardHistoryIdx luôn sync với lá đang hiển thị (úp/mở).
function _pickAndPushCard() {
  const card = pickCard();
  window._currentCard = card;
  cardHistory.push({ card, player: currentPlayer, slotIdx: scriptIndex });
  cardHistoryIdx = cardHistory.length - 1;
}

// Helper — render history item tại idx mà KHÔNG advance game state.
// Temp override scriptIndex + currentPlayer cho renderTurn() đúng visual,
// sau đó restore để pickCard/scriptIndex thực không bị ảnh hưởng.
function _renderHistoryAt(idx) {
  const item = cardHistory[idx];
  if (!item) return;
  window._currentCard = item.card;
  const _savedIdx = scriptIndex, _savedPlayer = currentPlayer;
  scriptIndex = item.slotIdx;
  currentPlayer = item.player;
  renderTurn();
  scriptIndex = _savedIdx;
  currentPlayer = _savedPlayer;
  playSound('swipe');
  renderCardSimple(item);
}

// Quay lại lá bài trước. Logic chia theo trạng thái lật:
//   - flipped=false (card-back đang hiện hoặc pre-reveal gate):
//     cardHistoryIdx vẫn trỏ vào lá đã đọc trước đó. GIỮ NGUYÊN idx, render thẳng.
//   - flipped=true (front đang hiện):
//     idx trỏ vào chính lá đang xem. Decrement rồi render.
// Quay lại lá trước. cardHistoryIdx luôn trỏ vào lá đang hiển thị
// (push at pick time → idx sync với visible slot dù úp hay mở).
function goBackCard() {
  if (cardHistoryIdx <= 0) {
    showToast('Đây là lá bài đầu tiên', 1200);
    return;
  }
  cardHistoryIdx--;
  _renderHistoryAt(cardHistoryIdx);
}

function nextCard() {
  // Nếu user đã Quay lại — Tiếp theo = forward navigation trong history.
  // renderCardSimple() trong helper sẽ set flipped=true cho lá history mới.
  if (cardHistoryIdx < cardHistory.length - 1) {
    cardHistoryIdx++;
    _renderHistoryAt(cardHistoryIdx);
    return;
  }
  // Ngược lại: standard advance flow
  playSound('swipe');
  const scene = document.getElementById('card-scene');
  scene.classList.add('slide-out');
  setTimeout(() => {
    scene.classList.remove('slide-out');
    scriptIndex++;
    const _script = window._activeSession || currentSession;
  if (scriptIndex >= _script.length) {
      showEndScreen();
      return;
    }
    // Haptic cho intensity 3
    const upcoming = _script[scriptIndex];
    const upcomingIsCooldown = !!(upcoming && upcoming.type === 'cooldown');
    if (!upcomingIsCooldown && selectedLevel === 3) {
      hapticVibrate(3);
    }
    currentPlayer = (currentPlayer + 1) % players.length;
    // prevStage/newStage lấy từ cardHistory / window._currentCard thay vì
    // session[scriptIndex] trực tiếp, để luôn khớp với lá thật sự hiển thị.
    const prevItem = cardHistory[cardHistory.length - 1];
    const prevStage = getStage(prevItem && prevItem.card ? prevItem.card.heat : 0).label;
    _pickAndPushCard();
    renderTurn();
    const newStage = getStage(window._currentCard ? window._currentCard.heat : 0).label;
    if (prevStage !== newStage) triggerStageFlash(newStage);
    showBack();
    scene.classList.add('slide-in');
    setTimeout(() => scene.classList.remove('slide-in'), 350);
  }, 260);
}

function triggerStageFlash(stageName) {
  const colorMap = {
    'Ice Breaker': 'rgba(76,175,125,0.25)',
    'Personal':    'rgba(224,154,58,0.25)',
    'Flirty':      'rgba(212,83,126,0.25)',
    'Intimate':    'rgba(192,112,64,0.3)',
    'Dangerous':   'rgba(192,57,43,0.35)',
  };
  const flash = document.getElementById('stage-flash');
  flash.style.background = colorMap[stageName] || 'rgba(255,255,255,0.1)';
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 650);
}

function consentReveal() {
  const consentEl = document.getElementById('consent-overlay');
  if (consentEl) consentEl.classList.add('hidden');
  const card = window._pendingCard;
  if (!card) return;
  const contentEl = document.getElementById('card-content');
  const footerEl = document.getElementById('card-footer-text');
  contentEl.style.display = '';
  contentEl.textContent = renderText(card.text);
  footerEl.style.display = '';
  footerEl.textContent = 'Hoàn thành xong nhấn Tiếp theo';
  (function(){const _ar=document.getElementById('action-row');_ar.classList.remove('hidden');_ar.style.display='flex';})();
  hapticVibrate(3);
}

function hapticVibrate(intensity) {
  // Haptic feedback qua Vibration API
  if ('vibrate' in navigator) {
    if (intensity >= 3) {
      navigator.vibrate([40, 30, 40]);
    } else if (intensity === 2) {
      navigator.vibrate(20);
    }
  }
  // Visual flash cho intensity 3
  if (intensity >= 3) {
    const flash = document.getElementById('haptic-flash');
    if (flash) {
      flash.classList.remove('flash');
      void flash.offsetWidth;
      flash.classList.add('flash');
    }
  }
}

function showEndScreen() {
  const modeLabel = { firstdate:'Dating', couple:'Couple', group:'Friend-s' };
  const heatEmoji = selectedLevel === 1 ? '🌿' : selectedLevel === 2 ? '🔥' : '💋';

  document.getElementById('end-stat-rounds').textContent = currentSession.length;
  document.getElementById('end-stat-mode').textContent = modeLabel[selectedMode] || selectedMode;
  document.getElementById('end-stat-heat').textContent = heatEmoji;

  const titleEl   = document.getElementById('end-title');
  const subEl     = document.getElementById('end-sub');
  const replayBtn = document.getElementById('end-btn-replay');
  const spiceBlock= document.getElementById('spice-rating-block');
  const labelEl   = document.getElementById('spice-rating-label');
  const wrapper   = document.getElementById('rating-icons-wrapper');
  const statusEl  = document.getElementById('spice-status-el');

  // ─── Khởi tạo: reset trạng thái để không bị "dính" giữa các ván ───
  // Reset text status + clear wrapper rating
  if (statusEl) statusEl.textContent = '';
  if (wrapper)  wrapper.innerHTML = '';

  // Helper: inject 5 ô rating với emoji tuỳ chỉnh
  const injectRatingIcons = (emoji) => {
    if (!wrapper) return;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<div class="chili-box" data-value="${i}" onclick="rateSpice(${i})"><span class="chili-emoji">${emoji}</span></div>`;
    }
    wrapper.innerHTML = html;
  };

  if (subEl) subEl.textContent = '';

  if (selectedLevel === 1) {
    if (titleEl)   titleEl.innerHTML = 'Tuyệt vời';
    injectRatingIcons('❤️');
    if (spiceBlock) spiceBlock.style.display = '';
  } else if (selectedLevel === 2) {
    if (titleEl)   titleEl.innerHTML = 'Quá đã!';
    injectRatingIcons('🌶');
    if (spiceBlock) spiceBlock.style.display = '';
  } else {
    if (titleEl)   titleEl.innerHTML = 'BANGGG! 💥';
    injectRatingIcons('🌶');
    if (spiceBlock) spiceBlock.style.display = '';
  }

  // ─── CTA: mời nâng level thay vì chỉ chơi lại y hệt ───────────────
  // selectedLevel < 3 và tổ hợp mode/numPlayers không bị chặn Level 3
  // (xem isLevel3Hidden) → đổi nút thành "Nâng nhiệt lên [Level kế]".
  // Ngược lại (đã ở Level 3, hoặc combo group+2 không thể lên Wild) →
  // giữ nút chơi lại bình thường.
  const nextLevel = selectedLevel + 1;
  const canEscalate = selectedLevel < 3 && !(nextLevel === 3 && isLevel3Hidden());
  if (replayBtn) {
    if (canEscalate) {
      replayBtn.textContent = 'Nâng nhiệt lên ' + LEVEL_NAMES[nextLevel] + ' →';
      replayBtn.onclick = () => replayGame(nextLevel);
    } else {
      replayBtn.textContent = 'Chơi lại';
      replayBtn.onclick = () => replayGame();
    }
  }

  if (labelEl) labelEl.textContent = 'Để lại cảm nhận để Spicii Night cải tiến tốt hơn nhé';

  showScreen('screen-end');
}

// ─── Spice rating ─────────────────────────────────────────────────
// Click ô N → toggle active cho 1..N, clear N+1..5.
// Inject text phản hồi theo level vào #spice-status-el.
function rateSpice(score) {
  const wrapper = document.getElementById('rating-icons-wrapper');
  if (!wrapper) return;
  wrapper.querySelectorAll('.chili-box').forEach(c => {
    const v = parseInt(c.dataset.value, 10);
    c.classList.toggle('active', v <= score);
  });
  if ('vibrate' in navigator) navigator.vibrate(15);
}

// nextLevel (optional) — dùng khi user bấm "Nâng nhiệt" ở màn kết thúc
// thay vì chơi lại đúng level cũ.
function replayGame(nextLevel) {
  if (nextLevel != null) selectedLevel = nextLevel;
  scriptIndex = 0;
  currentPlayer = 0;
  cardHistory = [];
  cardHistoryIdx = -1;
  // Mirror logic cua startGame — recompute totalCards + new script
  const totalCards = computeTotalCards(players.length);
  currentSession = generateDynamicScript(selectedLevel, totalCards);
  window._activeSession = currentSession;
  showScreen('screen-game');
  _pickAndPushCard();
  renderTurn();
  showBack();
}

function showScreen(id) {
  const current = document.querySelector('.screen.active');
  if (current && current.id !== id) {
    current.classList.add('screen-exit');
    setTimeout(() => {
      current.classList.remove('active','screen-exit');
      const next = document.getElementById(id);
      next.classList.add('active','screen-enter');
      setTimeout(() => next.classList.remove('screen-enter'), 420);
    }, 230);
  } else {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
}

// ─── SOUND ENGINE (Web Audio API - no external files) ────────────
let audioCtx = null;
let audioUnlocked = false;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// iOS Safari yêu cầu resume + play silent buffer trong user gesture đầu tiên.
// Gọi trong handler tương tác (nút bấm, tap card…) — không await, không async.
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    // Silent buffer để chính thức unlock pipeline trên iOS
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    audioUnlocked = true;
  } catch(e) {}
}

// Auto-unlock trên user gesture đầu tiên (mọi tap/click/touch trên doc)
if (typeof document !== 'undefined') {
  const _firstGestureUnlock = () => {
    unlockAudio();
    document.removeEventListener('touchstart', _firstGestureUnlock, true);
    document.removeEventListener('mousedown', _firstGestureUnlock, true);
    document.removeEventListener('keydown', _firstGestureUnlock, true);
  };
  document.addEventListener('touchstart', _firstGestureUnlock, true);
  document.addEventListener('mousedown', _firstGestureUnlock, true);
  document.addEventListener('keydown', _firstGestureUnlock, true);
}

function playSound(type) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (type === 'flip') {
      // Card flip: soft whoosh
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2) * 0.25;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.5;
      src.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      src.start();

    } else if (type === 'swipe') {
      // Swipe next: quick soft tick
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch(e) {}
}

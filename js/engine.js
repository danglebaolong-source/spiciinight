// ─── SPICII NIGHT — SESSION BUILDER ENGINE ─────────────────────────
// Vanilla browser JS — chạy <script src="engine.js"> sau khi 4 file pool_*.js
// đã nạp xong. Expose 2 hàm ra window:
//   - window.generateSession(poolType, currentLevel, playerCount, overrideTotalCards?)
//   - window.renderCardText(text, currentPlayer, players)
//   - window.currentSession (gán sau mỗi lần generate, cho script.js đọc)
//
// Logic: Filter → Tag routing → Nearest-rank heat sampling (mutex-aware)
// → Cooldown adjacency → String replacement.

(function () {
  'use strict';

  // ─── CONSTANTS ───────────────────────────────────────────────────
  var HARD_GROUP_TAGS = ['group_only', 'audience', 'chain'];
  var SOLO_TAG = 'intimate_2p';
  var ALL_LABEL = 'cả nhóm';

  // ─── UTILITIES ───────────────────────────────────────────────────
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function hasAny(tags, list) {
    if (!tags || !tags.length) return false;
    for (var i = 0; i < tags.length; i++) {
      if (list.indexOf(tags[i]) !== -1) return true;
    }
    return false;
  }

  // Dark card thiếu `intensity` (chưa gán tay) → suy ra từ heat đã có sẵn
  // (heat do content author tự canh chỉnh độ "gắt" của từng lá rồi, dùng
  // lại luôn thay vì cần chấm điểm nội dung thủ công). Ngưỡng 66/80 chọn
  // theo phân phối heat thật của 57 lá dark hiện có, chia đều ~1/3 mỗi mức.
  function inferIntensity(card) {
    if (card.type !== 'dark' || card.intensity != null) return card.intensity;
    if (card.heat >= 80) return 3;
    if (card.heat >= 66) return 2;
    return 1;
  }

  function getDatabase() {
    var db = []
      .concat(window.POOL_FIRSTDATE || [])
      .concat(window.POOL_COUPLE || [])
      .concat(window.POOL_GROUP || [])
      .concat(window.POOL_WILD || []);
    for (var i = 0; i < db.length; i++) {
      if (db[i].type === 'dark' && db[i].intensity == null) db[i].intensity = inferIntensity(db[i]);
    }
    return db;
  }

  // ─── STEP 1: LEVEL + POOL FILTER ─────────────────────────────────
  // Level 3 → effective pool = "wild" (bất kể poolType gốc).
  function filterByLevelAndPool(db, poolType, level) {
    var effective = (level === 3) ? 'wild' : poolType;
    var out = [];
    for (var i = 0; i < db.length; i++) {
      var c = db[i];
      if (c.pool === effective && c.level === level) out.push(c);
    }
    return out;
  }

  // ─── STEP 2: TAG ROUTING ─────────────────────────────────────────
  // N == 2 → reject card có bất kỳ tag {group_only, audience, chain}.
  // N > 2  → reject card có tag "intimate_2p".
  function applyTagRouting(subPool, playerCount) {
    var out = [];
    for (var i = 0; i < subPool.length; i++) {
      var c = subPool[i];
      var tags = c.tags || [];
      if (playerCount === 2) {
        if (hasAny(tags, HARD_GROUP_TAGS)) continue;
      } else {
        if (tags.indexOf(SOLO_TAG) !== -1) continue;
      }
      out.push(c);
    }
    return out;
  }

  // ─── STEP 3: NEAREST-RANK HEAT SAMPLING ──────────────────────────
  // Thay cho cách chia 3 "phase" cứng + quota + fallback mượn phase kề:
  // sort subPool theo heat, rồi rải `totalCards` điểm chọn ĐỀU trên toàn
  // bộ dải rank đó (targetRank tuyến tính từ 0 → cuối pool). Mỗi điểm
  // chọn lá GẦN rank đó nhất còn khả dụng — tự động "mượn" từ rank lân
  // cận khi rank đích đã hết, không cần bước fallback riêng.
  //
  // Vẫn giữ đúng tinh thần "30/40/30" cũ: vì cả pool lẫn quota trước đây
  // dùng chung tỉ lệ đó, mật độ chọn theo rank vốn đã đều — rải đều tuyến
  // tính ở đây cho ra đúng kết quả đó, chỉ gọn hơn và không có ranh giới
  // cứng giữa các phase.
  function findNearestAvailable(sorted, targetRank, pickedIds, lockedMutex, enforceMutex) {
    var L = sorted.length;
    for (var d = 0; d < L; d++) {
      var lo = targetRank - d;
      if (lo >= 0 && lo < L) {
        var c1 = sorted[lo];
        if (!pickedIds[c1.id] && (!enforceMutex || !c1.mutexGroup || !lockedMutex[c1.mutexGroup])) return c1;
      }
      var hi = targetRank + d;
      if (d !== 0 && hi >= 0 && hi < L) {
        var c2 = sorted[hi];
        if (!pickedIds[c2.id] && (!enforceMutex || !c2.mutexGroup || !lockedMutex[c2.mutexGroup])) return c2;
      }
    }
    return null;
  }

  // Đảm bảo session luôn có ít nhất 1 lá mỗi type trong `requiredTypes`
  // (vd truth + dare) — thay lá dư thừa nhất (type đang chiếm nhiều slot
  // nhất) bằng 1 lá đúng type còn thiếu, rồi sort lại heat cho mượt.
  function ensureTypeCoverage(session, sorted, pickedIds, requiredTypes) {
    for (var t = 0; t < requiredTypes.length; t++) {
      var type = requiredTypes[t];
      var hasType = session.some(function (c) { return c.type === type; });
      if (hasType) continue;

      var candidate = null;
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].type === type && !pickedIds[sorted[i].id]) { candidate = sorted[i]; break; }
      }
      if (!candidate) continue; // subPool không có type này — bỏ qua, không ép được

      var typeCounts = {};
      session.forEach(function (c) { typeCounts[c.type] = (typeCounts[c.type] || 0) + 1; });
      var worstIdx = -1, worstCount = 1;
      for (var j = 0; j < session.length; j++) {
        var count = typeCounts[session[j].type];
        if (count > worstCount) { worstCount = count; worstIdx = j; }
      }
      if (worstIdx === -1) continue; // không có lá dư để thay

      pickedIds[session[worstIdx].id] = false;
      session[worstIdx] = candidate;
      pickedIds[candidate.id] = true;
    }
    session.sort(function (a, b) { return a.heat - b.heat; });
  }

  function buildSession(subPool, totalCards) {
    // Shuffle trước khi sort (stable sort) → random hoá thứ tự các lá
    // cùng mức heat, tránh thiên vị theo thứ tự khai báo trong file pool.
    var sorted = shuffle(subPool).sort(function (a, b) { return a.heat - b.heat; });
    var L = sorted.length;
    var pickedIds = {};
    var lockedMutex = {};
    var session = [];
    var mutexDropped = 0;

    for (var i = 0; i < totalCards; i++) {
      var targetRank = totalCards <= 1 ? 0 : Math.round((i / (totalCards - 1)) * (L - 1));
      var card = findNearestAvailable(sorted, targetRank, pickedIds, lockedMutex, true);
      if (!card) {
        card = findNearestAvailable(sorted, targetRank, pickedIds, lockedMutex, false);
        if (card) mutexDropped++;
      }
      if (!card) break; // subPool đã cạn hoàn toàn — để injectDuplicates xử lý phần còn thiếu
      session.push(card);
      pickedIds[card.id] = true;
      if (card.mutexGroup) lockedMutex[card.mutexGroup] = true;
    }

    if (mutexDropped > 0) {
      console.warn('[Engine] Bỏ enforce mutexGroup cho ' + mutexDropped + ' lá (pool cạn lá cùng mutex-free ở rank đích).');
    }
    // Đảm bảo tối thiểu 1 truth + 1 dare/session (session cần ≥2 lá mới đủ chỗ)
    if (session.length >= 2) {
      ensureTypeCoverage(session, sorted, pickedIds, ['truth', 'dare']);
    }
    if (session.length < totalCards) {
      session = injectDuplicates(session, totalCards - session.length, sorted);
    }
    return session;
  }

  // ─── ABSOLUTE EXHAUSTION (DUPLICATE INJECTION) ───────────────────
  // Rải deficit qua nhiều lá khác nhau (round-robin trên bản shuffle) thay
  // vì random độc lập từng lần — tránh lặp draining vào đúng 1 lá nếu
  // deficit ≥ 2 trong khi vẫn còn nhiều lá khác để thay phiên.
  function injectDuplicates(session, deficit, sourceCandidates) {
    if (sourceCandidates.length === 0) {
      console.error('[Engine CRITICAL] Zero candidates. Cannot duplicate.');
      return session;
    }
    console.error('[Engine CRITICAL] Pool cạn — duplicate ' + deficit + ' lá vào session.');
    var pool = shuffle(sourceCandidates);
    for (var i = 0; i < deficit; i++) {
      var pick = pool[i % pool.length];
      session.push(Object.assign({}, pick, { _duplicate: true }));
    }
    return session;
  }

  // ─── COOLDOWN ADJACENCY POST-PROCESSING ──────────────────────────
  function fixCooldownAdjacency(session) {
    var swapsMade = 0;
    for (var i = 0; i < session.length - 1; i++) {
      if (session[i].type === 'cooldown' && session[i + 1].type === 'cooldown') {
        var swapTarget = -1;
        for (var j = i + 2; j < session.length; j++) {
          if (session[j].type !== 'cooldown') { swapTarget = j; break; }
        }
        if (swapTarget !== -1) {
          var tmp = session[i + 1];
          session[i + 1] = session[swapTarget];
          session[swapTarget] = tmp;
          swapsMade++;
        }
      }
    }
    if (swapsMade > 0) {
      console.log('[Engine] Cooldown adjacency fix: ' + swapsMade + ' swap(s) made.');
    }
    return session;
  }

  // ─── MAIN: generateSession ───────────────────────────────────────
  function generateSession(poolType, currentLevel, playerCount, overrideTotalCards) {
    // 0) Compute totalCards
    var totalCards;
    if (overrideTotalCards != null) {
      totalCards = overrideTotalCards;
    } else if (playerCount === 2) {
      totalCards = 7;
    } else {
      totalCards = 7 + 3 * (playerCount - 2);
    }

    // 1) Level + Pool
    var db = getDatabase();
    var step1 = filterByLevelAndPool(db, poolType, currentLevel);

    // 2) Tag routing
    var subPool = applyTagRouting(step1, playerCount);

    if (subPool.length === 0) {
      console.error('[Engine CRITICAL] Sub-pool rỗng (poolType=' + poolType +
                    ', level=' + currentLevel + ', N=' + playerCount + ').');
      window.currentSession = [];
      return [];
    }

    // 3) Nearest-rank heat sampling + mutex + duplicate guard
    var session = buildSession(subPool, totalCards);

    // 4) Cooldown adjacency
    session = fixCooldownAdjacency(session);

    window.currentSession = session;
    return session;
  }

  // ─── STRING REPLACEMENT ENGINE ───────────────────────────────────
  // Tokens: {ME}, {RANDOM}, {ALL}
  //   {ME}     → currentPlayer name
  //   {RANDOM} → random player ≠ currentPlayer; nếu N==2 thì lock = opponent
  //   {ALL}    → "cả nhóm"
  // Mỗi {RANDOM} occurrence là 1 lần roll độc lập.
  function renderCardText(text, currentPlayer, players) {
    if (!text) return '';
    var safePlayers = Array.isArray(players) ? players : [];
    var meName = currentPlayer || '';
    var others = [];
    for (var i = 0; i < safePlayers.length; i++) {
      if (safePlayers[i] !== currentPlayer) others.push(safePlayers[i]);
    }

    var out = text.replace(/\{ALL\}/g, ALL_LABEL);
    out = out.replace(/\{ME\}/g, meName);
    if (safePlayers.length === 2) {
      var opponent = others[0] || '';
      out = out.replace(/\{RANDOM\}/g, opponent);
    } else {
      out = out.replace(/\{RANDOM\}/g, function () {
        if (others.length === 0) return '';
        return others[Math.floor(Math.random() * others.length)];
      });
    }
    return out;
  }

  // ─── EXPOSE ──────────────────────────────────────────────────────
  window.generateSession = generateSession;
  window.renderCardText = renderCardText;
})();

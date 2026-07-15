// ─── SPICII NIGHT — SESSION BUILDER ENGINE ─────────────────────────
// Vanilla browser JS — chạy <script src="engine.js"> sau khi 4 file pool_*.js
// đã nạp xong. Expose 3 hàm ra window:
//   - window.generateSession(poolType, currentLevel, playerCount, overrideTotalCards?)
//   - window.renderCardText(text, currentPlayer, players)
//   - window.currentSession (gán sau mỗi lần generate, cho script.js đọc)
//
// Logic 4 bước + Fallback 3 tầng + Cooldown adjacency + String replacement.

(function () {
  'use strict';

  // ─── CONSTANTS ───────────────────────────────────────────────────
  var HARD_GROUP_TAGS = ['group_only', 'audience', 'chain'];
  var SOLO_TAG = 'intimate_2p';
  var PHASE_RATIOS = [0.30, 0.40, 0.30];
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

  function getDatabase() {
    return []
      .concat(window.POOL_FIRSTDATE || [])
      .concat(window.POOL_COUPLE || [])
      .concat(window.POOL_GROUP || [])
      .concat(window.POOL_WILD || []);
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

  // ─── STEP 3: HEAT PHASING (30/40/30 split của sub-pool) ──────────
  function splitIntoPhases(subPool) {
    var sorted = subPool.slice().sort(function (a, b) { return a.heat - b.heat; });
    var L = sorted.length;
    var n1 = Math.floor(L * PHASE_RATIOS[0]);
    var n2 = Math.floor(L * PHASE_RATIOS[1]);
    return [
      sorted.slice(0, n1),
      sorted.slice(n1, n1 + n2),
      sorted.slice(n1 + n2)
    ];
  }

  function computeQuotas(totalCards) {
    var q1 = Math.round(totalCards * PHASE_RATIOS[0]);
    var q2 = Math.round(totalCards * PHASE_RATIOS[1]);
    var q3 = totalCards - q1 - q2;
    return [q1, q2, q3];
  }

  // ─── STEP 4: PICK ────────────────────────────────────────────────
  // Pick `quota` cards từ sourcePool. Bỏ qua card đã pickedIds.
  // enforceMutex=false → bỏ qua mutexGroup check (Tier 2 fallback).
  function pickFromPool(sourcePool, quota, pickedIds, lockedMutex, enforceMutex) {
    var picked = [];
    if (quota <= 0) return picked;
    var shuffled = shuffle(sourcePool);
    for (var i = 0; i < shuffled.length && picked.length < quota; i++) {
      var c = shuffled[i];
      if (pickedIds[c.id]) continue;
      // mutexGroup nhận cả string ("kiss_position") lẫn integer (1, 2…) —
      // truthy check, JS tự stringify key khi index vào object.
      // (mutexGroup === 0 hoặc '' = không thuộc nhóm nào, luôn pass)
      if (enforceMutex && c.mutexGroup && lockedMutex[c.mutexGroup]) continue;
      picked.push(c);
      pickedIds[c.id] = true;
      if (c.mutexGroup) lockedMutex[c.mutexGroup] = true;
    }
    return picked;
  }

  // ─── FALLBACK 3 TIER ─────────────────────────────────────────────
  function fillShortfall(phasePools, fullSubPool, phaseIdx, needed, pickedIds, lockedMutex) {
    var extras = [];

    // TIER 1: borrow adjacent phase (giữ mutex + tags)
    var adjacentOrder;
    if (phaseIdx === 0)      adjacentOrder = [1];
    else if (phaseIdx === 2) adjacentOrder = [1];
    else                     adjacentOrder = [0, 2];

    for (var i = 0; i < adjacentOrder.length && extras.length < needed; i++) {
      var t1 = pickFromPool(phasePools[adjacentOrder[i]], needed - extras.length,
                            pickedIds, lockedMutex, true);
      if (t1.length) {
        console.warn('[Engine] Tier 1 Fallback: Borrowed ' + t1.length +
                     ' card(s) from phase ' + (adjacentOrder[i] + 1) +
                     ' for phase ' + (phaseIdx + 1) + '.');
      }
      extras = extras.concat(t1);
    }

    // TIER 2: drop mutexGroup (hard routing tags vẫn giữ vì subPool đã filter rồi)
    if (extras.length < needed) {
      var t2 = pickFromPool(fullSubPool, needed - extras.length, pickedIds, lockedMutex, false);
      if (t2.length) {
        console.warn('[Engine] Tier 2 Fallback: Dropped mutexGroup, picked ' +
                     t2.length + ' card(s) for phase ' + (phaseIdx + 1) + '.');
      }
      extras = extras.concat(t2);
    }

    // TIER 3: expand heat bracket — đã bao trùm bởi fullSubPool ở Tier 2.
    if (extras.length < needed) {
      console.warn('[Engine] Tier 3: Sub-pool exhausted. Short ' +
                   (needed - extras.length) + ' card(s) — handing off to duplicate guard.');
    }

    return extras;
  }

  // ─── ABSOLUTE EXHAUSTION (DUPLICATE INJECTION) ───────────────────
  function injectDuplicates(session, deficit, sourceCandidates) {
    if (sourceCandidates.length === 0) {
      console.error('[Engine CRITICAL] Zero candidates. Cannot duplicate.');
      return session;
    }
    console.error('[Engine CRITICAL] Pool fully exhausted. Duplicate cards injected (' +
                  deficit + ' card(s)) into the session.');
    for (var i = 0; i < deficit; i++) {
      var pick = sourceCandidates[Math.floor(Math.random() * sourceCandidates.length)];
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
      totalCards = 20;
    } else {
      totalCards = Math.min(6 * playerCount, 36);
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

    // 3) Heat phasing
    var phasePools = splitIntoPhases(subPool);
    var quotas = computeQuotas(totalCards);

    // 4) Pick per phase with mutex + fallback
    var pickedIds = {};
    var lockedMutex = {};
    var phasePicks = [[], [], []];

    for (var p = 0; p < 3; p++) {
      var primary = pickFromPool(phasePools[p], quotas[p], pickedIds, lockedMutex, true);
      phasePicks[p] = primary;
      if (primary.length < quotas[p]) {
        var extras = fillShortfall(phasePools, subPool, p, quotas[p] - primary.length,
                                   pickedIds, lockedMutex);
        phasePicks[p] = phasePicks[p].concat(extras);
      }
    }

    var session = phasePicks[0].concat(phasePicks[1]).concat(phasePicks[2]);

    if (session.length < totalCards) {
      session = injectDuplicates(session, totalCards - session.length, subPool);
    }

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

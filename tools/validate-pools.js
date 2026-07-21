// ─── SPICII NIGHT — POOL VALIDATOR ─────────────────────────────────
// Chạy độc lập qua tools/validate.html — không cần Node/build tool, chỉ
// cần dev server đang chạy. Kiểm tra schema của 4 pool_*.js theo đúng quy
// tắc trong CLAUDE.md, cộng với capacity check dùng chính
// window.generateSession thật (không tự implement lại logic riêng, tránh
// lệch pha với engine.js khi engine đổi thuật toán sau này).
//
// Thêm câu hỏi mới xong → mở tools/validate.html để kiểm tra ngay, trước
// khi commit/deploy.

(function () {
  'use strict';

  var RANGES = { firstdate: [1001, 1999], couple: [2001, 2999], group: [3001, 3999], wild: [9001, 9999] };
  var VALID_TYPES = ['truth', 'dare', 'cooldown', 'dark'];
  var VALID_TAGS = ['group_only', 'audience', 'chain', 'intimate_2p'];

  // Khớp với computeTotalCards() trong script.js — 2 người cố định 7 lá,
  // group >2 người cộng thêm 3 lá/người.
  function computeTotalCards(n) {
    return n === 2 ? 7 : 7 + 3 * (n - 2);
  }

  function checkSchema() {
    var pools = {
      firstdate: window.POOL_FIRSTDATE,
      couple: window.POOL_COUPLE,
      group: window.POOL_GROUP,
      wild: window.POOL_WILD,
    };
    var issues = [];
    var infos = [];
    var allIds = {};
    var summary = {};

    Object.keys(pools).forEach(function (name) {
      var arr = pools[name];
      if (!arr) { issues.push('MISSING POOL: window.POOL_' + name.toUpperCase()); return; }

      var levelCounts = {}, typeCounts = {}, uninferredIntensity = 0;
      arr.forEach(function (c) {
        if (allIds[c.id]) issues.push('DUP ID ' + c.id + ' (' + name + ' vs ' + allIds[c.id] + ')');
        else allIds[c.id] = name;

        var range = RANGES[name];
        if (c.id < range[0] || c.id > range[1]) {
          issues.push('ID NGOÀI RANGE: id=' + c.id + ' pool=' + name + ' (cần ' + range[0] + '-' + range[1] + ')');
        }
        if (c.pool !== name) issues.push('POOL FIELD SAI: id=' + c.id + ' pool="' + c.pool + '" nhưng nằm trong file ' + name);
        if ([1, 2, 3].indexOf(c.level) === -1) issues.push('LEVEL SAI: id=' + c.id + ' level=' + c.level);
        if (name !== 'wild' && c.level === 3) {
          issues.push('LEVEL 3 TRONG POOL KHÔNG PHẢI WILD (chết — engine chỉ query wild ở level 3): id=' + c.id + ' pool=' + name);
        }
        if (name === 'wild' && c.level !== 3) {
          issues.push('WILD CARD LEVEL != 3 (chết — engine chỉ query wild ở level 3): id=' + c.id + ' level=' + c.level);
        }
        if (c.type === 'cooldown' && name !== 'firstdate') {
          issues.push('COOLDOWN NGOÀI FIRSTDATE (chỉ firstdate được có cooldown): id=' + c.id + ' pool=' + name);
        }
        if (VALID_TYPES.indexOf(c.type) === -1) issues.push('TYPE KHÔNG HỢP LỆ: id=' + c.id + ' type="' + c.type + '"');
        if (typeof c.heat !== 'number' || c.heat < 0 || c.heat > 100) issues.push('HEAT SAI: id=' + c.id + ' heat=' + c.heat);
        if (typeof c.text !== 'string' || !c.text.trim()) issues.push('TEXT RỖNG: id=' + c.id);
        if (c.mutexGroup === undefined) issues.push('THIẾU FIELD mutexGroup: id=' + c.id);
        if (c.tags === undefined) issues.push('THIẾU FIELD tags: id=' + c.id);
        (c.tags || []).forEach(function (t) {
          if (VALID_TAGS.indexOf(t) === -1) issues.push('TAG LẠ (kiểm tra có gõ nhầm không): id=' + c.id + ' tag="' + t + '"');
        });
        if (c.type === 'dark' && c.intensity == null) uninferredIntensity++;

        levelCounts[c.level] = (levelCounts[c.level] || 0) + 1;
        typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
      });

      if (uninferredIntensity > 0) {
        infos.push(name + ': ' + uninferredIntensity + ' lá dark chưa gán intensity tay — engine tự suy từ heat (không phải lỗi).');
      }
      summary[name] = { count: arr.length, levelCounts: levelCounts, typeCounts: typeCounts };
    });

    return { issues: issues, infos: infos, summary: summary };
  }

  // Dùng chính window.generateSession thật để kiểm tra mỗi tổ hợp
  // mode/level/N có đủ lá không, thay vì tự tính lại subPool — luôn khớp
  // với hành vi thật của engine dù thuật toán chọn lá có đổi sau này.
  function checkCapacity() {
    var combos = [
      { mode: 'firstdate', n: 2 },
      { mode: 'couple', n: 2 },
      { mode: 'group', n: 2 },
      { mode: 'group', n: 3 },
      { mode: 'group', n: 4 },
      { mode: 'group', n: 5 },
      { mode: 'group', n: 6 },
      { mode: 'group', n: 8 },
    ];
    var levels = [1, 2, 3];
    var issues = [];

    combos.forEach(function (combo) {
      levels.forEach(function (level) {
        if (combo.mode === 'group' && combo.n === 2 && level === 3) return; // bị chặn ở UI, bỏ qua
        var total = computeTotalCards(combo.n);
        var trials = 15, dupTrials = 0;
        var origError = console.error;
        for (var t = 0; t < trials; t++) {
          var errored = false;
          console.error = function (msg) { if (String(msg).indexOf('CRITICAL') !== -1) errored = true; };
          window.generateSession(combo.mode, level, combo.n, total);
          console.error = origError;
          if (errored) dupTrials++;
        }
        if (dupTrials > 0) {
          issues.push('THIẾU LÁ: mode=' + combo.mode + ' level=' + level + ' N=' + combo.n +
                      ' (cần ' + total + ' lá) — duplicate xảy ra ' + dupTrials + '/' + trials + ' lần thử.');
        }
      });
    });
    return issues;
  }

  function render() {
    var schema = checkSchema();
    var capacityIssues = checkCapacity();
    var out = document.getElementById('output');
    var html = '';

    html += '<div class="section"><h2>1. Schema (' + schema.issues.length + ' lỗi)</h2>';
    html += (schema.issues.length === 0)
      ? '<p class="ok">✓ Không có lỗi schema.</p>'
      : '<pre class="fail">' + schema.issues.join('\n') + '</pre>';
    if (schema.infos.length) html += '<pre class="warn">' + schema.infos.join('\n') + '</pre>';
    html += '</div>';

    html += '<div class="section"><h2>2. Sức chứa pool theo mode/level/N (' + capacityIssues.length + ' vấn đề)</h2>';
    html += (capacityIssues.length === 0)
      ? '<p class="ok">✓ Mọi tổ hợp mode/level/N đều đủ lá, không cần duplicate.</p>'
      : '<pre class="fail">' + capacityIssues.join('\n') + '</pre>';
    html += '</div>';

    html += '<div class="section"><h2>3. Tổng quan pool</h2><pre>' + JSON.stringify(schema.summary, null, 2) + '</pre></div>';

    out.innerHTML = html;
  }

  render();
})();

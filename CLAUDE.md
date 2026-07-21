# CLAUDE.md — Spicii Night 🌶

## Tổng quan dự án
Web app game thẻ bài 18+ dành cho các buổi hẹn hò / cặp đôi / nhóm bạn.
Vanilla HTML/CSS/JS thuần — không framework, không build tool, không bundler.
Chạy trực tiếp trên trình duyệt (mở file hoặc deploy tĩnh).

---

## Cấu trúc file

```
index.html                    ← Layout + 5 màn hình (screen) + khai báo thứ tự script
css/
  style.css                    ← Toàn bộ CSS, CSS variables, dark theme
js/
  engine.js                    ← Session builder — IIFE, expose window.generateSession + window.renderCardText
  script.js                    ← UI logic, game state, event handlers
  pools/
    pool_firstdate.js          ← window.POOL_FIRSTDATE  (ID range: 1001-1085, 85 cards)
    pool_couple.js             ← window.POOL_COUPLE
    pool_group.js              ← window.POOL_GROUP
    pool_wild.js               ← window.POOL_WILD
tools/
  dev-server.ps1               ← Static file server cho local dev (không có build tool/npm ở máy này)
.claude/
  launch.json                  ← Config cho preview_start — trỏ tới tools/dev-server.ps1
```

index.html PHẢI nằm ở project root (Vercel static deploy zero-config đọc index.html từ root — không di chuyển file này).

**Thứ tự load script BẮT BUỘC:**
`js/pools/pool_*.js` → `js/engine.js` → `js/script.js`
(engine.js đọc window.POOL_* được set bởi pool files; script.js gọi window.generateSession từ engine)

---

## Game Modes & Levels

| Mode | poolType | numPlayers mặc định |
|------|----------|----------------------|
| Dating | `firstdate` | 2 |
| Couple | `couple` | 2 |
| Friend-s | `group` | 2–8 (user chọn) |

| Level | Tên | Ghi chú |
|-------|-----|---------|
| 1 | Non Spice | Nhẹ nhàng |
| 2 | Medium Chili | Riêng tư, tinh tế |
| 3 | Wild Habanero | Level 3 → engine override pool thành `wild` |

**Quy tắc ẩn level:** `mode=group && numPlayers=2` → ẩn Level 3.

---

## Schema thẻ bài (card)

```js
{
  id: 1001,              // unique integer
  pool: 'firstdate',     // 'firstdate' | 'couple' | 'group' | 'wild'
  type: 'truth',         // 'truth' | 'dare' | 'cooldown' | 'dark'
  level: 1,              // 1 | 2 | 3
  heat: 25,              // 0–100, điều chỉnh nhiệt độ session
  tags: [],              // mảng string, xem Tag Routing bên dưới
  mutexGroup: 'crazy_love', // string | number | 0 — chỉ pick 1 card trong nhóm
  text: '...',           // nội dung, hỗ trợ tokens {ME} {RANDOM} {ALL}
  note: '...',           // tuỳ chọn, chỉ editorial — engine bỏ qua
  intensity: 3,          // 1–3, dark card — intensity 3 trigger consent overlay.
                         // Nếu không set tay, engine tự suy ra từ heat
                         // (heat>=80→3, heat>=66→2, còn lại→1).
}
```

---

## Engine Logic (engine.js)

### Các bước chính
1. **Level + Pool filter** — Level 3 → effective pool = `wild` bất kể mode
2. **Tag routing** — 2 người: loại tag `group_only`, `audience`, `chain` | >2 người: loại tag `intimate_2p`
3. **Nearest-rank heat sampling** — sort subPool theo heat, rải đều `totalCards` điểm chọn trên toàn dải rank (không chia phase cứng); mỗi điểm chọn lá GẦN rank đích nhất còn khả dụng — tự "mượn" rank lân cận khi rank đích đã hết, không cần bước fallback riêng
4. **Mutex** — mỗi mutexGroup chỉ xuất hiện 1 lần/session; enforce trước, chỉ bỏ enforce (log warn) khi không còn lá mutex-free nào trong toàn subPool
5. **Duplicate guard** — subPool cạn hoàn toàn vẫn thiếu → duplicate injection (log CRITICAL), rải qua nhiều lá khác nhau (round-robin) thay vì lặp 1 lá

### Cooldown adjacency
Sau khi pick, tự động swap nếu 2 cooldown liền kề nhau.

### Tổng số thẻ/session
- 2 người → 7 thẻ
- >2 người → `7 + 3 × (N - 2)` thẻ (N=3→10, N=4→13, N=5→16, N=6→19, N=8→25)

### String tokens trong card text
| Token | Thay bằng |
|-------|-----------|
| `{ME}` | Tên người chơi hiện tại |
| `{RANDOM}` | Tên người chơi ngẫu nhiên khác |
| `{ALL}` | "cả nhóm" |
| `{P1}` / `{P2}` | Legacy — tên player 1/2 |
| `{anh_chi_P1}` | Legacy — "anh"/"cô" theo giới tính |

---

## State variables (script.js)

```js
selectedMode       // 'firstdate' | 'couple' | 'group'
numPlayers         // số nguyên
selectedLevel      // 1 | 2 | 3
players            // [{ name: string, gender: 'nu'|'nam' }]
scriptIndex        // index thẻ hiện tại trong currentSession
currentPlayer      // index player hiện tại trong players[]
flipped            // bool — card đã lật chưa
cardHistory        // stack lịch sử thẻ đã hiện
cardHistoryIdx     // vị trí hiện tại trong history (hỗ trợ Quay lại/Tiếp theo)
currentSession     // mảng card objects của session hiện tại
window._activeSession  // mirror của currentSession (dùng khi cần safe ref)
window._currentCard    // card đang hiển thị
window._pendingCard    // card chờ consent (dark intensity 3+)
```

---

## Luồng chính (flow)

```
Setup (chọn mode + số người)
  → Level (chọn độ khó)
    → Names (nhập tên + giới tính)
      → startGame() → generateSession() → renderTurn() → showBack()
        → flipCard() [user tap]
          → nextCard() [advance] → scriptIndex++
            → showEndScreen() [hết thẻ]
              → replayGame() [chơi lại cùng người]
```

---

## UI / Screens

| ID | Màn hình |
|----|----------|
| `screen-setup` | Chọn mode + số người |
| `screen-level` | Chọn level |
| `screen-names` | Nhập tên + giới tính |
| `screen-game` | Màn chơi chính |
| `screen-end` | Kết thúc session |

**Chuyển màn:** dùng `showScreen(id)` — có animation fade/slide.

### Heat system (nhiệt kế dọc)
- `updateProgressBar(heat, isCooldown)` — update CSS gradient + glow
- `getStage(heat)` → label: `Ice Breaker` / `Personal` / `Flirty` / `Intimate` / `Dangerous`
- Background app thay đổi theo class: `heat-ice`, `heat-personal`, `heat-flirty`, `heat-intimate`, `heat-danger`

### Card types & visual
- `truth` → badge xanh lá
- `dare` → badge hồng
- `cooldown` → badge amber, nhiệt kế tụt về 25%
- `dark` → badge đỏ đậm, class `is-dark`; intensity 3+ → hiện consent overlay trước

---

## CSS Design System

```css
/* CSS Variables chính */
--bg: #0f0a0a          /* nền app */
--surface: #2a1a1a     /* card surface */
--accent: #e85d4a      /* đỏ cam chủ đạo */
--text: #f5ede8        /* text sáng */
--text2: #c4a49a       /* text mờ */
--green: #4caf7d       /* truth / Ice Breaker */
--amber: #e09a3a       /* cooldown / Personal */
--pink: #d4537e        /* dare / Flirty */
--red: #c0392b         /* dark / Dangerous */
--blue: #3a8ed4        /* cooldown badge */
```

Font: `DM Sans` (Google Fonts), fallback serif: `Palatino Linotype` (logo).
Max width: 480px (mobile-first).

---

## Deploy & Source

- **Source:** GitHub repo
- **Hosting:** Vercel (auto-deploy khi push lên main)
- **Deploy:** push lên GitHub → Vercel tự build & deploy (không cần build step vì là static HTML)

---

## Sound & Haptic

```js
playSound('flip')   // Card flip — soft whoosh (Web Audio API, no external file)
playSound('swipe')  // Next card — quick tick
hapticVibrate(intensity)  // Vibration API — intensity 1/2/3
```

iOS unlock: `unlockAudio()` phải gọi trong gesture đầu tiên.

---

## Conventions

- **Không dùng framework** — vanilla JS ES6, const/let, arrow functions ở script.js; var ở engine.js (IE compat cũ, có thể giữ nguyên)
- **Không import/export** — dùng window globals để share giữa các file
- **Card ID** theo range: firstdate 1001–1999, couple 2001–2999, group 3001–3999, wild 9001–9999
- **ID tiếp theo hiện tại:** firstdate → 1086, couple → 2101, group → 3091, wild → 9081
- **Nội dung thẻ khác nhau theo pool** — pool_firstdate, couple, group, wild có nội dung riêng biệt, không dùng chung. Schema (id, pool, type, level, heat, tags...) là giống nhau.
- **Cooldown card chỉ tồn tại trong pool_firstdate** — couple và group không có cooldown, đây là thiết kế có chủ đích (firstdate cần nhịp thở vì 2 người còn xa lạ).
- **Thêm thẻ mới:** chỉ edit file `pool_*.js`, không đụng engine/script
- **UI text tập trung** tại `UI_STRINGS` trong script.js
- **Không inline style quan trọng** — dùng CSS class; inline style chỉ dùng khi toggle dynamic value (width%, gradient)

---

## Những thứ cần chú ý khi chỉnh sửa

1. **Thứ tự script trong index.html** — đừng đổi, sẽ crash ngay
2. **engine.js là IIFE** — không expose var ra ngoài, chỉ qua `window.*`
3. **cardHistory + cardHistoryIdx** phải sync — Quay lại/Tiếp theo phụ thuộc vào đây
4. **Level 3 luôn dùng pool `wild`** — không phụ thuộc mode đang chọn
5. **`showScreen()` có animation** — không gọi trực tiếp classList nếu cần transition

---

## Workflow thêm thẻ bài mới

Đây là task phổ biến nhất. Chỉ cần edit đúng file pool:

```js
// Thêm vào cuối mảng window.POOL_FIRSTDATE (hoặc COUPLE / GROUP / WILD)
{
  id: 1086,              // ID tiếp theo trong range, KHÔNG được trùng
  pool: 'firstdate',
  type: 'truth',         // truth | dare | cooldown | dark
  level: 1,              // 1 | 2 (firstdate không có level 3)
  heat: 30,              // 0–100
  tags: [],
  mutexGroup: 0,         // 0 = không thuộc nhóm mutex nào
  text: 'Nội dung với {ME} và {RANDOM}...',
}
```

**Checklist khi thêm thẻ:**
- ID unique trong toàn bộ 4 pool
- `pool` field phải khớp với file đang edit
- `level` 3 chỉ tồn tại trong `pool_wild.js`
- Dùng token `{ME}`, `{RANDOM}`, `{ALL}` — KHÔNG dùng tên cứng
- `mutexGroup` đặt string có nghĩa nếu muốn chỉ pick 1 trong nhóm (vd: `'first_impression'`)
- Cooldown card nên có heat thấp (5–20) và mutexGroup = 0

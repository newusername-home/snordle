/* Snake + Wordle (robust boot + unlimited lives + auto 3s countdown + pocket + mobile fix + next-letter guarantee + win flag)
   - Loads words.js if missing (no modules/exports).
   - Unlimited lives: on crash, auto 3s countdown then resume on same word.
   - Crash counter on panel; live pocket preview.
   - Mobile canvas stabilisation (visualViewport).
   - Guarantees the next correct-by-position letter is always present.
   - Win flag freezes play and shows a clear message.
*/

console.log("[Game] Starting game.js…");

(function boot() {
  const hasWordList = () =>
    (typeof WORD_LIST !== 'undefined') && Array.isArray(WORD_LIST);

  if (hasWordList()) {
    console.log(`[Game] WORD_LIST present (${WORD_LIST.length} words). Booting…`);
    startGame();
    return;
  }

  console.warn("[Game] WORD_LIST not found, injecting words.js dynamically…");

  if (!document.getElementById('words-loader')) {
    const s = document.createElement('script');
    s.id = 'words-loader';
    s.src = 'words.js?v=14';   // cache-bust to avoid stale caches
    s.async = false;           // preserve order
    s.onload = () => {
      if (hasWordList()) {
        console.log(`[Game] words.js loaded (${WORD_LIST.length} words). Booting…`);
        startGame();
      } else {
        fail("words.js loaded but WORD_LIST still missing. Ensure it has `const WORD_LIST = [...]` (no export/module).");
      }
    };
    s.onerror = () => fail("Failed to load words.js (404 or blocked). Ensure words.js exists in the repo root.");
    document.head.appendChild(s);
  } else {
    const t0 = Date.now();
    (function poll() {
      if (hasWordList()) { startGame(); return; }
      if (Date.now() - t0 > 3000) { fail("Timeout waiting for WORD_LIST after injection."); return; }
      setTimeout(poll, 100);
    })();
  }
  function fail(msg) { console.error("[Game] " + msg); alert("Startup error: " + msg); }
})();

function startGame() {
  console.log("[Game] Booting main…");

  // Required DOM ids (btnContinue optional and unused now)
  const requiredIds = ['board','status','guesses','pocket','deaths','btnNew','btnPause'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length) {
    const msg = `Missing DOM ids: ${missing.join(', ')}. Check index.html matches the provided version.`;
    console.error(msg);
    const fallback = document.getElementById('status') || document.body;
    (fallback.textContent !== undefined) ? (fallback.textContent = msg) : (fallback.innerText = msg);
    return;
  }

  // Elements
  const canvas         = document.getElementById('board');
  const ctx            = canvas.getContext('2d');
  const statusEl       = document.getElementById('status');
  const guessesEl      = document.getElementById('guesses');
  const pocketEl       = document.getElementById('pocket');
  const deathsEl       = document.getElementById('deaths');
  const btnNew         = document.getElementById('btnNew');
  const btnPause       = document.getElementById('btnPause');
  const controlButtons = document.querySelectorAll('#controls [data-dir]');

  // Grid
  const COLS = 12, ROWS = 16;
  let cell = 0, offsetX = 0, offsetY = 0;

  // Game state
  const MAX_GUESSES = 6;
  let rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32)(Date.now() >>> 0);
  let target, snake, dir, queuedDir, letters, guessLetters, guesses, paused, lastTime, speedMs, deaths, won;

  // Countdown state
  let countdownActive = false;
  let countdownSeconds = 0;
  let countdownTimerId = null;
  let countdownPrefix = "Starting in";

  // ---- SAFE INITIALISATION BEFORE FIRST fitCanvas() ----
  letters = [];
  snake   = [{ x: Math.floor(COLS/2), y: Math.floor(ROWS/2) }];
  guessLetters = [];
  guesses = [];
  paused = true;                 // paused until initial countdown completes
  lastTime = performance.now();
  speedMs = 140;
  deaths = 0;
  won = false;
  // ------------------------------------------------------

  function pickTarget() {
    if (!Array.isArray(WORD_LIST) || WORD_LIST.length < 10) return 'APPLE';
    const idx = Math.floor(rng() * (WORD_LIST.length/2)); // mild bias to first half
    return WORD_LIST[idx].toUpperCase();
  }
  function coordsEqual(a,b){ return a.x===b.x && a.y===b.y; }
  function randomEmptyCell() {
    let guard = 0;
    while (guard++ < 2000) {
      const p = {x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS)};
      if (!snake.some(s => coordsEqual(s,p)) && !letters.some(l => l.x===p.x && l.y===p.y)) return p;
    }
    return {x:0,y:0};
  }

  // --- Spawning helpers ---
  function spawnLetter(ch) {
    const p = randomEmptyCell();
    letters.push({ x: p.x, y: p.y, ch });
  }
  function ensureNextCorrectLetterAvailable() {
    if (guessLetters.length >= 5) return;
    const need = target[guessLetters.length];
    if (!need) return;
    if (!letters.some(l => l.ch === need)) spawnLetter(need);
  }
  function spawnLetters(n = 1) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < n; i++) {
      const p = randomEmptyCell();
      const needed = target.split('').filter(ch => !guessLetters.includes(ch));
      const ch = (rng() < 0.5 && needed.length > 0)
        ? needed[Math.floor(rng() * needed.length)]
        : alphabet[Math.floor(rng() * alphabet.length)];
      letters.push({ x: p.x, y: p.y, ch });
    }
    ensureNextCorrectLetterAvailable();
  }
  // ------------------------

  // --- Countdown helpers ---
  function clearCountdown() {
    countdownActive = false;
    if (countdownTimerId) { clearInterval(countdownTimerId); countdownTimerId = null; }
  }
  function startCountdown(prefix = "Starting in", seconds = 3) {
    clearCountdown();
    countdownPrefix = prefix;
    countdownSeconds = seconds;
    countdownActive = true;
    paused = true;            // block movement during countdown
    statusEl.textContent = `${countdownPrefix} ${countdownSeconds}…`;
    countdownTimerId = setInterval(() => {
      countdownSeconds -= 1;
      if (countdownSeconds > 0) {
        statusEl.textContent = `${countdownPrefix} ${countdownSeconds}…`;
      } else {
        clearCountdown();
        statusEl.textContent = 'Go!';
        if (!won) paused = false;
      }
    }, 1000);
  }
  // -------------------------

  function reset() {
    console.log("[Game] Resetting state…");
    target = pickTarget();
    console.log(`[Game] Target word: ${target}`);

    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;
    letters = [];
    guessLetters = [];
    guesses = [];
    deaths = 0;
    paused = true;        // paused until countdown finishes
    lastTime = performance.now();
    speedMs = 140;
    won = false;
    clearCountdown();

    statusEl.textContent = 'Collect letters to form a guess.';

    // Guess grid
    guessesEl.innerHTML = '';
    for (let i=0;i<MAX_GUESSES*5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.textContent = '';
      guessesEl.appendChild(d);
    }
    // Pocket
    pocketEl.innerHTML = '';
    for (let i=0;i<5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.textContent = '';
      pocketEl.appendChild(d);
    }
    updatePocket();
    updateStats();

    spawnLetters(7);
    ensureNextCorrectLetterAvailable();
    draw();

    // 3s autostart
    startCountdown("Starting in", 3);
  }

  function tick(dt) {
    if (paused || won || countdownActive) return;
    if (dt < speedMs) return;

    if (queuedDir) { dir = queuedDir; queuedDir = null; }
    const nextHead = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    // Collisions → unlimited lives: auto 3s countdown then resume
    const hitWall = nextHead.x<0 || nextHead.y<0 || nextHead.x>=COLS || nextHead.y>=ROWS;
    const hitSelf = snake.some(s=>coordsEqual(s,nextHead));
    if (hitWall || hitSelf) {
      crashAutoResume(hitWall ? 'Wall' : 'Self');
      draw();
      return;
    }

    // Move
    snake.unshift(nextHead);

    // Eat letter?
    const idx = letters.findIndex(l => l.x===nextHead.x && l.y===nextHead.y);
    if (idx>=0) {
      const ch = letters[idx].ch;
      letters.splice(idx,1);
      guessLetters.push(ch);
      spawnLetters(1);
      updatePocket();
      ensureNextCorrectLetterAvailable();
      if (guessLetters.length===5) commitGuess();
    } else {
      snake.pop();
    }
    draw();
  }

  // Crash: increment counter; reset snake; auto 3s countdown; resume same word
  function crashAutoResume(reason) {
    deaths++;
    updateStats();
    statusEl.textContent = `Crash (${deaths}).`;
    // Reset snake to centre, facing right; keep letters, guesses, and pocket
    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;
    ensureNextCorrectLetterAvailable();
    paused = true;
    startCountdown("Resuming in", 3);
  }

  function commitGuess() {
    const guess = guessLetters.join('');
    const row = guesses.length;
    const startIdx = row*5;

    for (let i=0;i<5;i++) {
      const tile = guessesEl.children[startIdx+i];
      if (tile) tile.textContent = guessLetters[i];
    }

    const res = scoreGuess(guess, target);
    const isWin = res.every(r => r === 'correct');

    for (let i=0;i<5;i++) {
      const tile = guessesEl.children[startIdx+i];
      if (tile) tile.classList.add(res[i]);
    }
    guesses.push({word:guess, res});
    guessLetters = [];
    updatePocket();

    if (isWin) {
      won = true;
      paused = true;
      statusEl.textContent = `You solved it! Crashes: ${deaths}`;
      clearCountdown();
      return;
    } else if (guesses.length>=MAX_GUESSES) {
      statusEl.textContent = `Out of guesses. Word: ${target}. Crashes: ${deaths}`;
      paused = true;
      clearCountdown();
    } else {
      statusEl.textContent = 'Keep going.';
      ensureNextCorrectLetterAvailable();
    }
  }

  function scoreGuess(guess, target) {
    const res = Array(5).fill('absent');
    const t = target.split('');
    const g = guess.split('');
    for (let i=0;i<5;i++) if (g[i]===t[i]) { res[i]='correct'; t[i]=null; g[i]=null; }
    for (let i=0;i<5;i++) if (g[i]) {
      const j = t.indexOf(g[i]);
      if (j>-1) { res[i]='present'; t[j]=null; }
    }
    return res;
  }

  function updatePocket() {
    for (let i=0;i<5;i++) {
      const tile = pocketEl.children[i];
      if (tile) {
        tile.textContent = guessLetters[i] || '';
        tile.classList.remove('correct','present','absent');
      }
    }
  }
  function updateStats() { if (deathsEl) deathsEl.textContent = String(deaths); }

  // Rendering
  function draw() {
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.strokeStyle = '#2a2a2a';
    for (let x=0;x<=COLS;x++) {
      ctx.beginPath(); ctx.moveTo(offsetX + x*cell, offsetY); ctx.lineTo(offsetX + x*cell, offsetY+ROWS*cell); ctx.stroke();
    }
    for (let y=0;y<=ROWS;y++) {
      ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y*cell); ctx.lineTo(offsetX+COLS*cell, offsetY + y*cell); ctx.stroke();
    }

    // letters
    const _letters = Array.isArray(letters) ? letters : [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(cell*0.6)+'px system-ui';
    _letters.forEach(l => {
      ctx.fillStyle = '#355';
      ctx.fillRect(offsetX + l.x*cell+2, offsetY + l.y*cell+2, cell-4, cell-4);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.ch, offsetX + l.x*cell + cell/2, offsetY + l.y*cell + cell/2 + 1);
    });

    // snake
    const _snake = Array.isArray(snake) ? snake : [];
    ctx.fillStyle = '#3a6';
    _snake.forEach(s=>{
      ctx.fillRect(offsetX + s.x*cell+2, offsetY + s.y*cell+2, cell-4, cell-4);
    });
  }

  // Loop
  function loop(ts) {
    const dt = ts - lastTime;
    if (!paused && !won && !countdownActive) tick(dt);
    if (ts - lastTime >= speedMs) lastTime = ts;
    requestAnimationFrame(loop);
  }

  // Controls
  controlButtons.forEach(b => b.addEventListener('click', () => setDir(b.dataset.dir)));

  // Swipe
  let touchStart = null;
  canvas.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    touchStart = {x:t.clientX, y:t.clientY};
  }, {passive:true});
  canvas.addEventListener('touchend', e => {
    if(!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx>0?'right':'left'); else setDir(dy>0?'down':'up');
    touchStart = null;
  }, {passive:true});

  // Keyboard (desktop testing)
  window.addEventListener('keydown', e => {
    const k = e.key;
    if (k==='ArrowUp'||k==='w') setDir('up');
    if (k==='ArrowDown'||k==='s') setDir('down');
    if (k==='ArrowLeft'||k==='a') setDir('left');
    if (k==='ArrowRight'||k==='d') setDir('right');
  });

  function setDir(d) {
    const nd = d==='up'?{x:0,y:-1}:d==='down'?{x:0,y:1}:d==='left'?{x:-1,y:0}:{x:1,y:0};
    if (snake.length>1 && snake[0].x+nd.x===snake[1].x && snake[0].y+nd.y===snake[1].y) return;
    queuedDir = nd;
  }

  // Canvas sizing
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const zoom = (window.visualViewport && typeof window.visualViewport.scale === 'number')
      ? window.visualViewport.scale : 1;
    const dpr = (window.devicePixelRatio || 1) * zoom;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.floor(Math.min(rect.width / COLS, rect.height / ROWS));
    offsetX = Math.floor((rect.width  - cell * COLS) / 2);
    offsetY = Math.floor((rect.height - cell * ROWS) / 2);
    draw();
  }

  let _t; function scheduleFit(){ clearTimeout(_t); _t = setTimeout(fitCanvas, 50); }
  const ro = new ResizeObserver(scheduleFit); ro.observe(canvas);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleFit, { passive: true });
    window.visualViewport.addEventListener('scroll',  scheduleFit, { passive: true });
  }

  // Init
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  fitCanvas();
  reset();
  requestAnimationFrame(loop);

  console.log("[Game] Setup complete.");
}

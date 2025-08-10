/* Word Snake
   - Unlimited lives, 3s countdown on start/continue
   - Reset button starts a new game
   - Pause button toggles between Pause/Resume
   - Pocket preview
   - Guaranteed next letter spawn
   - Win detection stops the game
*/

console.log("[Word Snake] Starting game.js…");

(function boot() {
  const hasWordList = () =>
    (typeof WORD_LIST !== 'undefined') && Array.isArray(WORD_LIST);

  if (hasWordList()) {
    console.log(`[Word Snake] WORD_LIST present (${WORD_LIST.length} words). Booting…`);
    startGame();
    return;
  }

  console.warn("[Word Snake] WORD_LIST not found, injecting words.js dynamically…");

  if (!document.getElementById('words-loader')) {
    const s = document.createElement('script');
    s.id = 'words-loader';
    s.src = 'words.js?v=14';
    s.async = false;
    s.onload = () => {
      if (hasWordList()) {
        console.log(`[Word Snake] words.js loaded (${WORD_LIST.length} words). Booting…`);
        startGame();
      } else {
        fail("words.js loaded but WORD_LIST still missing. Ensure it has `const WORD_LIST = [...]`.");
      }
    };
    s.onerror = () => fail("Failed to load words.js.");
    document.head.appendChild(s);
  } else {
    const t0 = Date.now();
    (function poll() {
      if (hasWordList()) { startGame(); return; }
      if (Date.now() - t0 > 3000) { fail("Timeout waiting for WORD_LIST after injection."); return; }
      setTimeout(poll, 100);
    })();
  }
  function fail(msg) { console.error("[Word Snake] " + msg); alert("Startup error: " + msg); }
})();

function startGame() {
  console.log("[Word Snake] Booting main…");

  const requiredIds = ['board','status','guesses','pocket','deaths','btnNew','btnPause'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length) {
    const msg = `Missing DOM ids: ${missing.join(', ')}.`;
    console.error(msg);
    (document.getElementById('status') || document.body).textContent = msg;
    return;
  }

  const canvas    = document.getElementById('board');
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('status');
  const guessesEl = document.getElementById('guesses');
  const pocketEl  = document.getElementById('pocket');
  const deathsEl  = document.getElementById('deaths');
  const btnNew    = document.getElementById('btnNew');
  const btnPause  = document.getElementById('btnPause');
  const controlButtons = document.querySelectorAll('#controls [data-dir]');

  const COLS = 12, ROWS = 16;
  let cell = 0, offsetX = 0, offsetY = 0;

  const MAX_GUESSES = 6;
  let rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32)(Date.now() >>> 0);
  let target, snake, dir, queuedDir, letters, guessLetters, guesses, paused, lastTime, speedMs, deaths, won;

  let countdownActive = false;
  let countdownSeconds = 0;
  let countdownTimerId = null;
  let countdownPrefix = "Starting in";

  letters = [];
  snake   = [{ x: Math.floor(COLS/2), y: Math.floor(ROWS/2) }];
  guessLetters = [];
  guesses = [];
  paused = true;
  lastTime = performance.now();
  speedMs = 140;
  deaths = 0;
  won = false;

  function pickTarget() {
    if (!Array.isArray(WORD_LIST) || WORD_LIST.length < 10) return 'APPLE';
    return WORD_LIST[Math.floor(rng() * WORD_LIST.length)].toUpperCase();
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
      const needed = target.split('').filter(ch => !guessLetters.includes(ch));
      const ch = (rng() < 0.5 && needed.length > 0)
        ? needed[Math.floor(rng() * needed.length)]
        : alphabet[Math.floor(rng() * alphabet.length)];
      letters.push({ ...randomEmptyCell(), ch });
    }
    ensureNextCorrectLetterAvailable();
  }

  function clearCountdown() {
    countdownActive = false;
    if (countdownTimerId) { clearInterval(countdownTimerId); countdownTimerId = null; }
  }
  function startCountdown(prefix = "Starting in", seconds = 3) {
    clearCountdown();
    countdownPrefix = prefix;
    countdownSeconds = seconds;
    countdownActive = true;
    paused = true;
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

  function reset() {
    console.log("[Word Snake] Resetting state…");
    target = pickTarget();
    console.log(`[Word Snake] Target word: ${target}`);

    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;
    letters = [];
    guessLetters = [];
    guesses = [];
    deaths = 0;
    paused = true;
    lastTime = performance.now();
    speedMs = 140;
    won = false;
    clearCountdown();

    if (btnPause) btnPause.textContent = 'Pause';
    statusEl.textContent = 'Collect letters to form a guess.';

    guessesEl.innerHTML = '';
    for (let i=0;i<MAX_GUESSES*5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      guessesEl.appendChild(d);
    }
    pocketEl.innerHTML = '';
    for (let i=0;i<5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      pocketEl.appendChild(d);
    }
    updatePocket();
    updateStats();

    spawnLetters(7);
    ensureNextCorrectLetterAvailable();
    draw();
    startCountdown("Starting in", 3);
  }

  function tick(dt) {
    if (paused || won || countdownActive) return;
    if (dt < speedMs) return;

    if (queuedDir) { dir = queuedDir; queuedDir = null; }
    const nextHead = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    const hitWall = nextHead.x<0 || nextHead.y<0 || nextHead.x>=COLS || nextHead.y>=ROWS;
    const hitSelf = snake.some(s=>coordsEqual(s,nextHead));
    if (hitWall || hitSelf) {
      crashAutoResume();
      draw();
      return;
    }

    snake.unshift(nextHead);

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

  function crashAutoResume() {
    deaths++;
    updateStats();
    statusEl.textContent = `Crash (${deaths}).`;
    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;
    ensureNextCorrectLetterAvailable();
    paused = true;
    startCountdown("Resuming in", 3);
  }

  function commitGuess() {
    const guess = guessLetters.join('');
    const startIdx = guesses.length*5;
    for (let i=0;i<5;i++) guessesEl.children[startIdx+i].textContent = guessLetters[i];

    const res = scoreGuess(guess, target);
    const isWin = res.every(r => r === 'correct');
    for (let i=0;i<5;i++) guessesEl.children[startIdx+i].classList.add(res[i]);

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
      pocketEl.children[i].textContent = guessLetters[i] || '';
      pocketEl.children[i].classList.remove('correct','present','absent');
    }
  }
  function updateStats() { deathsEl.textContent = String(deaths); }

  function draw() {
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.strokeStyle = '#2a2a2a';
    for (let x=0;x<=COLS;x++) { ctx.beginPath(); ctx.moveTo(offsetX + x*cell, offsetY); ctx.lineTo(offsetX + x*cell, offsetY+ROWS*cell); ctx.stroke(); }
    for (let y=0;y<=ROWS;y++) { ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y*cell); ctx.lineTo(offsetX+COLS*cell, offsetY + y*cell); ctx.stroke(); }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(cell*0.6)+'px system-ui';
    letters.forEach(l => {
      ctx.fillStyle = '#355';
      ctx.fillRect(offsetX + l.x*cell+2, offsetY + l.y*cell+2, cell-4, cell-4);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.ch, offsetX + l.x*cell + cell/2, offsetY + l.y*cell + cell/2 + 1);
    });

    ctx.fillStyle = '#3a6';
    snake.forEach(s=>{
      ctx.fillRect(offsetX + s.x*cell+2, offsetY + s.y*cell+2, cell-4, cell-4);
    });
  }

  function loop(ts) {
    const dt = ts - lastTime;
    if (!paused && !won && !countdownActive) tick(dt);
    if (ts - lastTime >= speedMs) lastTime = ts;
    requestAnimationFrame(loop);
  }

  controlButtons.forEach(b => b.addEventListener('click', () => setDir(b.dataset.dir)));
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

  btnNew.addEventListener('click', () => reset());
  btnPause.addEventListener('click', () => {
    if (countdownActive || won) return;
    paused = !paused;
    btnPause.textContent = paused ? 'Resume' : 'Pause';
    statusEl.textContent = paused ? 'Paused' : 'Go!';
  });

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

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  fitCanvas();
  reset();
  requestAnimationFrame(loop);
}

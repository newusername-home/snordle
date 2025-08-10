/* Snake + Wordle (robust boot + unlimited lives + Continue + pocket + mobile fix)
   - Auto-loads words.js if WORD_LIST is missing.
   - Unlimited lives: crash pauses; press "Continue" to resume on same word.
   - Crash counter on panel; live pocket preview.
   - Uses visualViewport to stabilise canvas size on mobile browsers.
*/

console.log("[Game] Starting game.js…");

(function boot() {
  // If WORD_LIST is already present, start immediately
  if (Array.isArray(window.WORD_LIST)) {
    console.log(`[Game] WORD_LIST present (${WORD_LIST.length} words). Booting…`);
    startGame();
    return;
  }

  console.warn("[Game] WORD_LIST not found, injecting words.js dynamically…");

  // Avoid double-injection
  if (!document.getElementById('words-loader')) {
    const s = document.createElement('script');
    s.id = 'words-loader';
    s.src = 'words.js?v=10';      // cache-bust to avoid stale SW/HTTP cache
    s.async = false;              // keep execution ordering consistent
    s.onload = () => {
      if (Array.isArray(window.WORD_LIST)) {
        console.log(`[Game] words.js loaded (${WORD_LIST.length} words). Booting…`);
        startGame();
      } else {
        fail("words.js loaded but WORD_LIST still missing. Ensure it defines `const WORD_LIST = [...]`.");
      }
    };
    s.onerror = () => fail("Failed to load words.js (404 or blocked). Ensure words.js exists in the repo root.");
    document.head.appendChild(s);
  } else {
    // Someone else is loading it; poll briefly
    const t0 = Date.now();
    (function poll() {
      if (Array.isArray(window.WORD_LIST)) { startGame(); return; }
      if (Date.now() - t0 > 3000) { fail("Timeout waiting for WORD_LIST after script injection."); return; }
      setTimeout(poll, 100);
    })();
  }

  function fail(msg) {
    console.error("[Game] " + msg);
    alert("Startup error: " + msg);
  }
})();

function startGame() {
  console.log("[Game] Booting main…");

  // Verify required DOM elements exist
  const requiredIds = ['board','status','guesses','pocket','deaths','btnNew','btnPause','btnContinue'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length) {
    const msg = `Missing DOM ids: ${missing.join(', ')}. Check index.html matches the provided version.`;
    console.error(msg);
    const fallback = document.getElementById('status') || document.body;
    (fallback.textContent !== undefined) ? (fallback.textContent = msg) : (fallback.innerText = msg);
    return;
  }

  // Elements
  const canvas       = document.getElementById('board');
  const ctx          = canvas.getContext('2d');
  const statusEl     = document.getElementById('status');
  const guessesEl    = document.getElementById('guesses');
  const pocketEl     = document.getElementById('pocket');
  const deathsEl     = document.getElementById('deaths');
  const btnNew       = document.getElementById('btnNew');
  const btnPause     = document.getElementById('btnPause');
  const btnContinue  = document.getElementById('btnContinue');
  const controlButtons = document.querySelectorAll('#controls [data-dir]');

  // Grid
  const COLS = 12, ROWS = 16;
  let cell = 0, offsetX = 0, offsetY = 0;

  // Game state
  const MAX_GUESSES = 6;
  let rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32)(Date.now() >>> 0);
  let target, snake, dir, queuedDir, letters, guessLetters, guesses, paused, lastTime, speedMs, deaths;
  let awaitingContinue = false; // After crash, require Continue

  function pickTarget() {
    if (!Array.isArray(window.WORD_LIST) || WORD_LIST.length < 10) {
      console.warn("[Game] WORD_LIST is small/missing; using fallback word.");
      return 'APPLE';
    }
    const idx = Math.floor(rng() * (WORD_LIST.length/2)); // mild bias to first half
    return WORD_LIST[idx].toUpperCase();
  }

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
    paused = false;
    awaitingContinue = false;
    lastTime = performance.now();
    speedMs = 140;

    statusEl.textContent = 'Collect letters to form a guess.';
    // Build guesses grid (6 rows × 5)
    guessesEl.innerHTML = '';
    for (let i=0;i<MAX_GUESSES*5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.textContent = '';
      guessesEl.appendChild(d);
    }
    // Pocket (always 5 slots)
    pocketEl.innerHTML = '';
    for (let i=0;i<5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.textContent = '';
      pocketEl.appendChild(d);
    }
    updatePocket();
    updateStats();
    hideContinue();

    spawnLetters(7);
    draw();
  }

  function coordsEqual(a,b){ return a.x===b.x && a.y===b.y; }

  function randomEmptyCell() {
    let guard = 0;
    while (guard++ < 1000) {
      const p = {x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS)};
      if (!snake.some(s => coordsEqual(s,p)) && !letters.some(l => l.x===p.x && l.y===p.y)) return p;
    }
    return {x:0,y:0}; // extremely unlikely fallback
  }

  function spawnLetters(n=1) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i=0;i<n;i++) {
      const p = randomEmptyCell();
      // mild bias to letters in target not yet in pocket
      const needed = target.split('').filter(ch => !guessLetters.includes(ch));
      const ch = (rng()<0.6 && needed.length>0)
        ? needed[Math.floor(rng()*needed.length)]
        : alphabet[Math.floor(rng()*alphabet.length)];
      letters.push({x:p.x, y:p.y, ch});
    }
  }

  function tick(dt) {
    if (paused || awaitingContinue) return;
    if (dt < speedMs) return;

    // Direction update
    if (queuedDir) { dir = queuedDir; queuedDir = null; }
    const nextHead = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    // Collisions → unlimited lives: pause and require Continue
    const hitWall = nextHead.x<0 || nextHead.y<0 || nextHead.x>=COLS || nextHead.y>=ROWS;
    const hitSelf = snake.some(s=>coordsEqual(s,nextHead));
    if (hitWall || hitSelf) {
      crashPause(hitWall ? 'Wall' : 'Self');
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
      spawnLetters(1); // maintain density
      updatePocket();
      if (guessLetters.length===5) commitGuess();
    } else {
      snake.pop(); // no growth
    }
    draw();
  }

  // Crash handling: increment counter; reset snake; pause until Continue
  function crashPause(reason) {
    deaths++;
    updateStats();
    statusEl.textContent = `Crash (${deaths}). Press Continue to resume.`;
    awaitingContinue = true;

    // Reset snake to centre, facing right; keep letters, guesses, and pocket
    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;

    showContinue();
  }

  function commitGuess() {
    const guess = guessLetters.join('');
    const row = guesses.length;
    const startIdx = row*5;

    // Show letters in guess grid
    for (let i=0;i<5;i++) {
      const tile = guessesEl.children[startIdx+i];
      if (tile) tile.textContent = guessLetters[i];
    }

    // Score like Wordle
    const res = scoreGuess(guess, target);
    for (let i=0;i<5;i++) {
      const tile = guessesEl.children[startIdx+i];
      if (tile) tile.classList.add(res[i]);
    }
    guesses.push({word:guess, res});
    guessLetters = [];
    updatePocket();

    if (guess===target) {
      statusEl.textContent = `You solved it! Crashes: ${deaths}`;
    } else if (guesses.length>=MAX_GUESSES) {
      statusEl.textContent = `Out of guesses. Word: ${target}. Crashes: ${deaths}`;
    } else {
      statusEl.textContent = 'Keep going.';
    }
  }

  function scoreGuess(guess, target) {
    const res = Array(5).fill('absent');
    const t = target.split('');
    const g = guess.split('');
    // Greens
    for (let i=0;i<5;i++) if (g[i]===t[i]) { res[i]='correct'; t[i]=null; g[i]=null; }
    // Yellows
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
    // background
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    // grid
    ctx.strokeStyle = '#2a2a2a';
    for (let x=0;x<=COLS;x++) {
      ctx.beginPath(); ctx.moveTo(offsetX + x*cell, offsetY); ctx.lineTo(offsetX + x*cell, offsetY+ROWS*cell); ctx.stroke();
    }
    for (let y=0;y<=ROWS;y++) {
      ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y*cell); ctx.lineTo(offsetX+COLS*cell, offsetY + y*cell); ctx.stroke();
    }
    // letters
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(cell*0.6)+'px system-ui';
    letters.forEach(l => {
      ctx.fillStyle = '#355';
      ctx.fillRect(offsetX + l.x*cell+2, offsetY + l.y*cell+2, cell-4, cell-4);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.ch, offsetX + l.x*cell + cell/2, offsetY + l.y*cell + cell/2 + 1);
    });
    // snake
    ctx.fillStyle = '#3a6';
    snake.forEach(s=>{
      ctx.fillRect(offsetX + s.x*cell+2, offsetY + s.y*cell+2, cell-4, cell-4);
    });
  }

  // Loop
  function loop(ts) {
    const dt = ts - lastTime;
    if (!paused && !awaitingContinue) tick(dt);
    if (ts - lastTime >= speedMs) lastTime = ts;
    requestAnimationFrame(loop);
  }

  // Controls
  controlButtons.forEach(b => b.addEventListener('click', () => setDir(b.dataset.dir)));

  // Swipe controls
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
    if (k==='Enter' && awaitingContinue) doContinue();
  });

  function setDir(d) {
    const nd = d==='up'?{x:0,y:-1}:d==='down'?{x:0,y:1}:d==='left'?{x:-1,y:0}:{x:1,y:0};
    // prevent reversing
    if (snake.length>1 && snake[0].x+nd.x===snake[1].x && snake[0].y+nd.y===snake[1].y) return;
    queuedDir = nd;
  }

  // Continue / Pause / New
  function showContinue(){ btnContinue.hidden = false; }
  function hideContinue(){ btnContinue.hidden = true; }
  function doContinue() {
    awaitingContinue = false;
    statusEl.textContent = 'Continue… collect letters.';
    hideContinue();
  }
  btnContinue.addEventListener('click', doContinue);

  btnNew.addEventListener('click', () => reset());
  btnPause.addEventListener('click', () => {
    if (awaitingContinue) return;
    paused = !paused; btnPause.textContent = paused ? '▶' : '⏸';
  });

  // Canvas sizing with visual viewport & page zoom
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const zoom = (window.visualViewport && typeof window.visualViewport.scale === 'number')
      ? window.visualViewport.scale : 1;
    const dpr = (window.devicePixelRatio || 1) * zoom;

    // Backing store in device pixels
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    // Draw in CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Layout in CSS pixels
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

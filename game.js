/* Hardened Snake + Wordle (unlimited lives + Continue + pocket) */

(() => {
  // Require these IDs to exist:
  const requiredIds = ['board','status','guesses','pocket','deaths','btnNew','btnPause','btnContinue'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length) {
    const msg = `Missing DOM ids: ${missing.join(', ')}. Check index.html matches the provided version.`;
    console.error(msg);
    const fallback = document.getElementById('status') || document.body;
    (fallback.textContent !== undefined) ? (fallback.textContent = msg) : (fallback.innerText = msg);
    return; // stop: cannot boot safely
  }

  const canvas    = document.getElementById('board');
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('status');
  const guessesEl = document.getElementById('guesses');
  const pocketEl  = document.getElementById('pocket');
  const deathsEl  = document.getElementById('deaths');
  const btnNew    = document.getElementById('btnNew');
  const btnPause  = document.getElementById('btnPause');
  const btnContinue = document.getElementById('btnContinue');
  const controlButtons = document.querySelectorAll('#controls [data-dir]');

  // Grid
  const COLS = 12, ROWS = 16;
  let cell = 0, offsetX = 0, offsetY = 0;

  // Game state
  const MAX_GUESSES = 6;
  let rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32)(Date.now() >>> 0);
  let target = pickTarget();
  let snake, dir, queuedDir, letters, guessLetters, guesses, paused, lastTime, speedMs, deaths;
  let awaitingContinue = false;

  function reset() {
    target = pickTarget();
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
    // Guesses grid
    guessesEl.innerHTML = '';
    for (let i=0;i<MAX_GUESSES*5;i++) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.textContent = '';
      guessesEl.appendChild(d);
    }
    // Pocket (5 slots)
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

  function pickTarget() {
    if (!window.WORD_LIST || !Array.isArray(window.WORD_LIST) || window.WORD_LIST.length < 10) {
      console.error('WORD_LIST not loaded. Ensure words.js is present and loaded before game.js.');
      statusEl.textContent = 'words.js not loaded — check filename and script order.';
      return 'APPLE'; // fallback
    }
    const idx = Math.floor(rng() * (WORD_LIST.length/2));
    return WORD_LIST[idx].toUpperCase();
  }

  function coordsEqual(a,b){ return a.x===b.x && a.y===b.y; }

  function randomEmptyCell() {
    let guard = 0;
    while (guard++ < 1000) {
      const p = {x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS)};
      if (!snake.some(s => coordsEqual(s,p)) && !letters.some(l => l.x===p.x && l.y===p.y)) return p;
    }
    return {x:0,y:0}; // very unlikely
  }

  function spawnLetters(n=1) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i=0;i<n;i++) {
      const p = randomEmptyCell();
      const needed = target.split('').filter(ch => !guessLetters.includes(ch));
      const ch = (rng()<0.6 && needed.length>0) ? needed[Math.floor(rng()*needed.length)] : alphabet[Math.floor(rng()*alphabet.length)];
      letters.push({x:p.x, y:p.y, ch});
    }
  }

  function tick(dt) {
    if (paused || awaitingContinue) return;
    if (dt < speedMs) return;

    if (queuedDir) { dir = queuedDir; queuedDir = null; }
    const nextHead = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    const hitWall = nextHead.x<0 || nextHead.y<0 || nextHead.x>=COLS || nextHead.y>=ROWS;
    const hitSelf = snake.some(s=>coordsEqual(s,nextHead));
    if (hitWall || hitSelf) {
      crashPause(hitWall ? 'Wall' : 'Self');
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
      if (guessLetters.length===5) commitGuess();
    } else {
      snake.pop();
    }
    draw();
  }

  function crashPause(reason) {
    deaths++;
    updateStats();
    statusEl.textContent = `Crash (${deaths}). Press Continue to resume.`;
    awaitingContinue = true;
    snake = [{x: Math.floor(COLS/2), y: Math.floor(ROWS/2)}];
    dir = {x:1,y:0};
    queuedDir = null;
    showContinue();
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

  function updateStats() {
    if (deathsEl) deathsEl.textContent = String(deaths);
  }

  function draw() {
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#2a2a2a';
    for (let x=0;x<=COLS;x++) {
      ctx.beginPath(); ctx.moveTo(offsetX + x*cell, offsetY); ctx.lineTo(offsetX + x*cell, offsetY+ROWS*cell); ctx.stroke();
    }
    for (let y=0;y<=ROWS;y++) {
      ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y*cell); ctx.lineTo(off*

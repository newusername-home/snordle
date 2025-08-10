/* Snake + Wordle (diagnostic) */

console.log("[Game] Starting game.js load…");

(() => {
  console.log("[Game] Checking for WORD_LIST…");
  if (!window.WORD_LIST || !Array.isArray(window.WORD_LIST)) {
    console.error("[Game] WORD_LIST missing or not an array — words.js may not have loaded first.");
    alert("Error: WORD_LIST is missing. Check that words.js is loaded before game.js.");
    return;
  }
  console.log(`[Game] WORD_LIST loaded with ${WORD_LIST.length} words.`);

  // Grab elements
  console.log("[Game] Grabbing DOM elements…");
  const ids = ['board','status','guesses','pocket','deaths','btnNew','btnPause','btnContinue'];
  for (const id of ids) {
    if (!document.getElementById(id)) {
      console.error(`[Game] Missing DOM element: #${id}`);
      alert(`Error: Missing DOM element #${id} — check index.html matches the provided version.`);
      return;
    }
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

  console.log("[Game] DOM elements OK. Initialising state…");

  // Grid
  const COLS = 12, ROWS = 16;
  let cell = 0, offsetX = 0, offsetY = 0;

  // Game state
  const MAX_GUESSES = 6;
  let rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32)(Date.now() >>> 0);
  let target, snake, dir, queuedDir, letters, guessLetters, guesses, paused, lastTime, speedMs, deaths;
  let awaitingContinue = false;

  function pickTarget() {
    const idx = Math.floor(rng() * (WORD_LIST.length/2));
    return WORD_LIST[idx].toUpperCase();
  }

  function reset() {
    console.log("[Game] Resetting game state…");
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
    hideContinue();

    spawnLetters(7);
    draw();
  }

  function updatePocket() {
    for (let i=0;i<5;i++) {
      pocketEl.children[i].textContent = guessLetters[i] || '';
    }
  }

  function updateStats() {
    deathsEl.textContent = String(deaths);
  }

  function spawnLetters(n=1) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i=0;i<n;i++) {
      letters.push({
        ...randomEmptyCell(),
        ch: alphabet[Math.floor(rng()*alphabet.length)]
      });
    }
  }

  function randomEmptyCell() {
    while (true) {
      const p = {x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS)};
      if (!snake.some(s => s.x===p.x && s.y===p.y) && !letters.some(l => l.x===p.x && l.y===p.y)) return p;
    }
  }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#3a6';
    snake.forEach(s=>{
      ctx.fillRect(offsetX + s.x*cell+2, offsetY + s.y*cell+2, cell-4, cell-4);
    });
  }

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const zoom = (window.visualViewport && typeof window.visualViewport.scale === 'number')
      ? window.visualViewport.scale : 1;
    const dpr = (window.devicePixelRatio || 1) * zoom;
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    cell = Math.floor(Math.min(rect.width / COLS, rect.height / ROWS));
    offsetX = Math.floor((rect.width  - cell * COLS)/2);
    offsetY = Math.floor((rect.height - cell * ROWS)/2);
    draw();
  }

  // Buttons
  btnNew.addEventListener('click', reset);

  console.log("[Game] Setting up canvas…");
  fitCanvas();

  console.log("[Game] Calling reset()…");
  reset();

  console.log("[Game] Setup complete.");
})();

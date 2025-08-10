/* Word Snake — Mobile swipe support, D-pad hidden on phones, compact layout support
   - Unlimited lives with auto 3s countdown after start and each crash (until max crashes).
   - Cap crashes at 10; on reaching cap, stop and prompt to Reset.
   - On win, show stats: number of guesses, max snake length, crashes.
   - Guarantees next correct-by-position letter is present.
   - Mobile viewport stabilisation; swipe gestures drive movement.
*/

console.log("[Word Snake] Starting game.js…");

(function boot() {
  const hasWordList = () =>
    (typeof WORD_LIST !== 'undefined') && Array.isArray(WORD_LIST);

  if (hasWordList()) {
    startGame(); return;
  }
  if (!document.getElementById('words-loader')) {
    const s = document.createElement('script');
    s.id = 'words-loader';
    s.src = 'words.js?v=16';
    s.async = false;
    s.onload = () => hasWordList() ? startGame() : fail("words.js loaded but WORD_LIST missing");
    s.onerror = () => fail("Failed to load words.js (404?)");
    document.head.appendChild(s);
  } else {
    const t0 = Date.now();
    (function poll(){
      if (hasWordList()) { startGame(); return; }
      if (Date.now()-t0>3000) { fail("Timeout waiting for WORD_LIST"); return; }
      setTimeout(poll,100);
    })();
  }
  function fail(msg){ console.error("[Word Snake] "+msg); alert("Startup error: "+msg); }
})();

function startGame(){
  const requiredIds = ['board','status','guesses','pocket','deaths','btnNew'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length){
    const msg = `Missing DOM ids: ${missing.join(', ')}`;
    (document.getElementById('status')||document.body).textContent = msg;
    console.error(msg);
    return;
  }

  // Elements
  const canvas    = document.getElementById('board');
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('status');
  const guessesEl = document.getElementById('guesses');
  const pocketEl  = document.getElementById('pocket');
  const deathsEl  = document.getElementById('deaths');
  const btnNew    = document.getElementById('btnNew');
  const controlButtons = document.querySelectorAll('#controls [data-dir]');

  // Grid
  const COLS=12, ROWS=16;
  let cell=0, offsetX=0, offsetY=0;

  // Game constants/state
  const MAX_GUESSES = 6;
  const MAX_CRASHES = 10;
  let rng = (seed=>()=> (seed=(seed*1664525+1013904223)>>>0)/2**32)(Date.now()>>>0);

  let target, snake, dir, queuedDir, letters, guessLetters, guesses;
  let countdownActive=false, countdownSeconds=0, countdownTimerId=null;
  let lastTime=performance.now(), speedMs=140;
  let deaths=0, won=false, gameOver=false;
  let maxSnakeLen = 1; // for stats

  // Safe init
  letters=[]; snake=[{x:Math.floor(COLS/2), y:Math.floor(ROWS/2)}];
  dir={x:1,y:0}; queuedDir=null;
  guessLetters=[]; guesses=[];
  updateStats();

  // Helpers
  function pickTarget(){
    if (!Array.isArray(WORD_LIST) || WORD_LIST.length<10) return 'APPLE';
    return WORD_LIST[Math.floor(rng()*WORD_LIST.length)].toUpperCase();
  }
  function coordsEqual(a,b){ return a.x===b.x && a.y===b.y; }
  function randomEmptyCell(){
    let guard=0;
    while(guard++<2000){
      const p={x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS)};
      if (!snake.some(s=>coordsEqual(s,p)) && !letters.some(l=>l.x===p.x&&l.y===p.y)) return p;
    }
    return {x:0,y:0};
  }

  // Spawning
  function spawnLetter(ch){
    const p=randomEmptyCell();
    letters.push({x:p.x,y:p.y,ch});
  }
  function ensureNextCorrectLetterAvailable(){
    if (guessLetters.length>=5) return;
    const need = target[guessLetters.length];
    if (!need) return;
    if (!letters.some(l=>l.ch===need)) spawnLetter(need);
  }
  function spawnLetters(n=1){
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for(let i=0;i<n;i++){
      const needed = target.split('').filter(ch=>!guessLetters.includes(ch));
      const ch = (rng()<0.5 && needed.length>0)
        ? needed[Math.floor(rng()*needed.length)]
        : alphabet[Math.floor(rng()*alphabet.length)];
      letters.push({ ...randomEmptyCell(), ch });
    }
    ensureNextCorrectLetterAvailable();
  }

  // Countdown
  function clearCountdown(){ countdownActive=false; if(countdownTimerId){clearInterval(countdownTimerId); countdownTimerId=null;} }
  function startCountdown(prefix="Starting in", seconds=3){
    clearCountdown();
    countdownActive=true; countdownSeconds=seconds;
    statusEl.textContent = `${prefix} ${countdownSeconds}…`;
    countdownTimerId = setInterval(()=>{
      countdownSeconds -= 1;
      if (countdownSeconds>0){
        statusEl.textContent = `${prefix} ${countdownSeconds}…`;
      } else {
        clearCountdown();
        statusEl.textContent = 'Go!';
        if (!won && !gameOver) requestAnimationFrame(loop);
      }
    },1000);
  }

  // Reset (full new game)
  function reset(){
    target = pickTarget();
    snake=[{x:Math.floor(COLS/2), y:Math.floor(ROWS/2)}];
    dir={x:1,y:0}; queuedDir=null;
    letters=[]; guessLetters=[]; guesses=[];
    deaths=0; won=false; gameOver=false; maxSnakeLen=1;
    lastTime=performance.now(); speedMs=140;
    clearCountdown();

    statusEl.textContent='Collect letters to form a guess.';

    // Build guesses grid (6×5)
    guessesEl.innerHTML='';
    for(let i=0;i<MAX_GUESSES*5;i++){
      const d=document.createElement('div'); d.className='tile'; d.textContent=''; guessesEl.appendChild(d);
    }
    // Current (5)
    pocketEl.innerHTML='';
    for(let i=0;i<5;i++){
      const d=document.createElement('div'); d.className='tile'; d.textContent=''; pocketEl.appendChild(d);
    }
    updatePocket(); updateStats();

    spawnLetters(7);
    ensureNextCorrectLetterAvailable();
    draw();

    // 3s autostart
    startCountdown("Starting in",3);
  }

  // Tick
  function tick(dt){
    if (countdownActive || won || gameOver) return;
    if (dt < speedMs) return;

    if (queuedDir){ dir=queuedDir; queuedDir=null; }
    const nextHead = {x:snake[0].x+dir.x, y:snake[0].y+dir.y};

    const hitWall = nextHead.x<0 || nextHead.y<0 || nextHead.x>=COLS || nextHead.y>=ROWS;
    const hitSelf = snake.some(s=>coordsEqual(s,nextHead));
    if (hitWall || hitSelf){
      onCrash();
      draw();
      return;
    }

    // Move
    snake.unshift(nextHead);

    // Eat?
    const idx = letters.findIndex(l=>l.x===nextHead.x && l.y===nextHead.y);
    if (idx>=0){
      const ch=letters[idx].ch;
      letters.splice(idx,1);
      guessLetters.push(ch);
      spawnLetters(1);
      updatePocket();
      ensureNextCorrectLetterAvailable();
      if (snake.length > maxSnakeLen) maxSnakeLen = snake.length;

      if (guessLetters.length===5) commitGuess();
    } else {
      snake.pop(); // no growth
    }
    draw();
  }

  // Crash handling (auto resume until MAX_CRASHES)
  function onCrash(){
    deaths++; updateStats();
    if (deaths >= MAX_CRASHES){
      gameOver = true;
      statusEl.textContent = `Max crashes reached (${MAX_CRASHES}). Start again with Reset.`;
      clearCountdown();
      return;
    }
    statusEl.textContent = `Crash (${deaths}/${MAX_CRASHES}).`;
    snake=[{x:Math.floor(COLS/2), y:Math.floor(ROWS/2)}];
    dir={x:1,y:0}; queuedDir=null;
    ensureNextCorrectLetterAvailable();
    startCountdown("Resuming in",3);
  }

  // Guess commit
  function commitGuess(){
    const guess = guessLetters.join('');
    const startIdx = guesses.length*5;
    for (let i=0;i<5;i++) guessesEl.children[startIdx+i].textContent = guessLetters[i];

    const res = scoreGuess(guess, target);
    const isWin = res.every(r=>r==='correct');
    for (let i=0;i<5;i++) guessesEl.children[startIdx+i].classList.add(res[i]);

    guesses.push({word:guess, res});
    guessLetters=[]; updatePocket();

    if (isWin){
      won = true;
      clearCountdown();
      const stats = [
        `You solved it!`,
        `Guesses: ${guesses.length}`,
        `Max snake length: ${maxSnakeLen}`,
        `Crashes: ${deaths}`
      ].join('\n');
      statusEl.textContent = stats;
      return;
    } else if (guesses.length>=MAX_GUESSES){
      gameOver = true;
      clearCountdown();
      statusEl.textContent = `Out of guesses. Word: ${target}\nCrashes: ${deaths}\nStart again with Reset.`;
    } else {
      statusEl.textContent = 'Keep going.';
      ensureNextCorrectLetterAvailable();
    }
  }

  function scoreGuess(guess,target){
    const res=Array(5).fill('absent');
    const t=target.split(''); const g=guess.split('');
    for(let i=0;i<5;i++) if(g[i]===t[i]){ res[i]='correct'; t[i]=null; g[i]=null; }
    for(let i=0;i<5;i++) if(g[i]){
      const j=t.indexOf(g[i]); if(j>-1){ res[i]='present'; t[j]=null; }
    }
    return res;
  }

  // UI helpers
  function updatePocket(){
    for(let i=0;i<5;i++){
      const tile = pocketEl.children[i] || null;
      if (tile){
        tile.textContent = guessLetters[i] || '';
        tile.classList.remove('correct','present','absent');
      }
    }
  }
  function updateStats(){ deathsEl.textContent = `${deaths}/${MAX_CRASHES}`; }

  // Rendering
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#111'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#2a2a2a';
    for(let x=0;x<=COLS;x++){ ctx.beginPath(); ctx.moveTo(offsetX+x*cell,offsetY); ctx.lineTo(offsetX+x*cell,offsetY+ROWS*cell); ctx.stroke(); }
    for(let y=0;y<=ROWS;y++){ ctx.beginPath(); ctx.moveTo(offsetX,offsetY+y*cell); ctx.lineTo(offsetX+COLS*cell,offsetY+y*cell); ctx.stroke(); }

    // letters
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=Math.floor(cell*0.6)+'px system-ui';
    letters.forEach(l=>{
      ctx.fillStyle='#355';
      ctx.fillRect(offsetX+l.x*cell+2, offsetY+l.y*cell+2, cell-4, cell-4);
      ctx.fillStyle='#fff';
      ctx.fillText(l.ch, offsetX+l.x*cell+cell/2, offsetY+l.y*cell+cell/2+1);
    });

    // snake
    ctx.fillStyle='#3a6';
    snake.forEach(s=>{
      ctx.fillRect(offsetX+s.x*cell+2, offsetY+s.y*cell+2, cell-4, cell-4);
    });
  }

  // Loop
  function loop(ts){
    const dt = ts - lastTime;
    if (!countdownActive && !won && !gameOver) tick(dt);
    if (ts - lastTime >= speedMs) lastTime = ts;
    requestAnimationFrame(loop);
  }

  // Controls: buttons (desktop/tablet)
  controlButtons.forEach(b=>b.addEventListener('click',()=>setDir(b.dataset.dir)));

  // Controls: keyboard (desktop testing)
  window.addEventListener('keydown', e=>{
    if (gameOver || won || countdownActive) return;
    const k=e.key;
    if (k==='ArrowUp'||k==='w') setDir('up');
    if (k==='ArrowDown'||k==='s') setDir('down');
    if (k==='ArrowLeft'||k==='a') setDir('left');
    if (k==='ArrowRight'||k==='d') setDir('right');
  });

  // Controls: swipe (mobile)
// Controls: swipe (mobile) — prevent page scroll while swiping the canvas
let touchStartX = 0, touchStartY = 0;
const swipeThreshold = 30; // px

function onTouchStart(e) {
  // single touch only
  if (e.changedTouches.length > 0) {
    const t = e.changedTouches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }
  e.preventDefault(); // <-- key: claim the gesture
}

function onTouchMove(e) {
  // prevent Safari from scrolling while finger is on the canvas
  e.preventDefault();
}

function onTouchEnd(e) {
  if (gameOver || won || countdownActive) { e.preventDefault(); return; }

  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > swipeThreshold) {
    setDir(dx > 0 ? 'right' : 'left');
  } else if (Math.abs(dy) > swipeThreshold) {
    setDir(dy > 0 ? 'down' : 'up');
  }
  e.preventDefault(); // stop click emulation / scrolling
}

// IMPORTANT: listeners must be non-passive so preventDefault works
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });


  function setDir(d){
    const nd = d==='up'?{x:0,y:-1}:d==='down'?{x:0,y:1}:d==='left'?{x:-1,y:0}:{x:1,y:0};
    if (snake.length>1 && snake[0].x+nd.x===snake[1].x && snake[0].y+nd.y===snake[1].y) return;
    queuedDir = nd;
  }

  // Reset button
  document.getElementById('btnNew').addEventListener('click', ()=> reset());

  // Canvas sizing
  function fitCanvas(){
    const rect=canvas.getBoundingClientRect();
    const zoom=(window.visualViewport && typeof window.visualViewport.scale==='number')?window.visualViewport.scale:1;
    const dpr=(window.devicePixelRatio||1)*zoom;
    canvas.width=Math.max(1,Math.round(rect.width*dpr));
    canvas.height=Math.max(1,Math.round(rect.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    cell=Math.floor(Math.min(rect.width/COLS, rect.height/ROWS));
    offsetX=Math.floor((rect.width - cell*COLS)/2);
    offsetY=Math.floor((rect.height - cell*ROWS)/2);
    draw();
  }
  let _t; function scheduleFit(){ clearTimeout(_t); _t=setTimeout(fitCanvas,50); }
  const ro=new ResizeObserver(scheduleFit); ro.observe(canvas);
  if (window.visualViewport){
    window.visualViewport.addEventListener('resize', scheduleFit, {passive:true});
    window.visualViewport.addEventListener('scroll',  scheduleFit, {passive:true});
  }

  // Init
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  fitCanvas();
  reset();
  requestAnimationFrame(loop);
}

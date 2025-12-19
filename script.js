(() => {
  // -------- Config: 5x5 dots => 4x4 boxes
  const N = 5; // dots per row/col
  const BOX = N - 1; // boxes per row/col = 4
  const H = (N - 1) * N; // horizontal edges = 20
  const V = (N - 1) * N; // vertical edges = 20
  const E = H + V; // total edges = 40
  const B = BOX * BOX; // total boxes = 16

  // Edge indexing:
  // horizontal edge at (r,c): r in [0..N-1], c in [0..N-2] => idx = r*(N-1)+c   (0..H-1)
  // vertical edge at (r,c): r in [0..N-2], c in [0..N-1] => idx = H + r*N + c   (H..E-1)

  const svg = document.getElementById('svg');
  const turnLabel = document.getElementById('turnLabel');
  const humanScoreEl = document.getElementById('humanScore');
  const aiScoreEl = document.getElementById('aiScore');
  const thinkingEl = document.getElementById('thinking');
  const newGameBtn = document.getElementById('newGame');

  // -------- Precompute box -> 4 edges
  const boxEdges = new Array(B).fill(null).map(() => []);
  const boxRowCol = (b) => [Math.floor(b / BOX), b % BOX];

  function hEdgeIndex(r, c) { return r * (N - 1) + c; }
  function vEdgeIndex(r, c) { return H + r * N + c; }

  for (let br = 0; br < BOX; br++) {
    for (let bc = 0; bc < BOX; bc++) {
      const b = br * BOX + bc;
      const top = hEdgeIndex(br, bc);
      const bottom = hEdgeIndex(br + 1, bc);
      const left = vEdgeIndex(br, bc);
      const right = vEdgeIndex(br, bc + 1);
      boxEdges[b] = [top, right, bottom, left];
    }
  }

  // For each edge, which boxes it borders (0..2 boxes)
  const edgeToBoxes = new Array(E).fill(null).map(() => []);
  for (let b = 0; b < B; b++) {
    for (const e of boxEdges[b]) edgeToBoxes[e].push(b);
  }

  // -------- State
  // edgesMask: BigInt 40 bits
  // ownerAI:   16-bit bitmask (Number)
  // ownerHuman:16-bit bitmask (Number)
  // turn: 'human' or 'ai'
  let edgesMask = 0n;
  let ownerAI = 0;
  let ownerHuman = 0;
  let turn = 'human';

  // UI maps
  const edgeLines = new Array(E);
  const edgeHits = new Array(E);
  const boxRects = new Array(B);

  // -------- Helpers bit ops
  const bitE = (i) => (1n << BigInt(i));
  function hasEdge(mask, i) { return (mask & bitE(i)) !== 0n; }
  function setEdge(mask, i) { return mask | bitE(i); }

  function boxComplete(mask, b) {
    const es = boxEdges[b];
    return hasEdge(mask, es[0]) && hasEdge(mask, es[1]) && hasEdge(mask, es[2]) && hasEdge(mask, es[3]);
  }

  function popcount16(x) {
    x = x - ((x >> 1) & 0x5555);
    x = (x & 0x3333) + ((x >> 2) & 0x3333);
    return (((x + (x >> 4)) & 0x0F0F) * 0x0101) >> 8;
  }

  function scores() {
    return { human: popcount16(ownerHuman), ai: popcount16(ownerAI) };
  }

  function gameOver() {
    return popcount16(ownerHuman | ownerAI) === B;
  }

  // Apply move returns: { newMask, newOwnerAI, newOwnerHuman, nextTurn, gainedAI, gainedHuman }
  function applyMove(mask, oAI, oH, currentTurn, edgeIdx) {
    if (hasEdge(mask, edgeIdx)) return null;

    const newMask = setEdge(mask, edgeIdx);
    let newOAI = oAI;
    let newOH = oH;
    let gained = 0;

    const adj = edgeToBoxes[edgeIdx];
    for (const b of adj) {
      // if box is complete and unowned now -> it gets claimed
      const owned = ((newOAI | newOH) >> b) & 1;
      if (!owned && boxComplete(newMask, b)) {
        gained++;
        if (currentTurn === 'ai') newOAI |= (1 << b);
        else newOH |= (1 << b);
      }
    }

    const nextTurn = gained > 0 ? currentTurn : (currentTurn === 'ai' ? 'human' : 'ai');
    return { newMask, newOAI, newOH, nextTurn, gained };
  }

  // -------- Perfect-play AI: minimax over full remaining game with memo + alpha-beta
  // returns value = (aiScore - humanScore) from this state until end, assuming optimal play
  const memo = new Map();

  function key(mask, oAI, oH, currentTurn) {
    // mask as string is OK for 5x5
    return mask.toString() + '|' + oAI + '|' + oH + '|' + (currentTurn === 'ai' ? 'A' : 'H');
  }

  function minimax(mask, oAI, oH, currentTurn, alpha, beta) {
    const k = key(mask, oAI, oH, currentTurn);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    // terminal
    const claimed = popcount16(oAI | oH);
    if (claimed === B) {
      const v = popcount16(oAI) - popcount16(oH);
      memo.set(k, v);
      return v;
    }

    // move ordering: try "box-closing" moves first
    const moves = [];
    for (let e = 0; e < E; e++) if (!hasEdge(mask, e)) moves.push(e);

    moves.sort((a, b) => {
      // heuristic: edges that complete boxes first
      const ga = wouldGain(mask, oAI, oH, currentTurn, a);
      const gb = wouldGain(mask, oAI, oH, currentTurn, b);
      return gb - ga;
    });

    let best;
    if (currentTurn === 'ai') {
      best = -Infinity;
      for (const e of moves) {
        const res = applyMove(mask, oAI, oH, currentTurn, e);
        const val = minimax(res.newMask, res.newOAI, res.newOH, res.nextTurn, alpha, beta);
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // prune
      }
    } else {
      best = Infinity;
      for (const e of moves) {
        const res = applyMove(mask, oAI, oH, currentTurn, e);
        const val = minimax(res.newMask, res.newOAI, res.newOH, res.nextTurn, alpha, beta);
        if (val < best) best = val;
        if (best < beta) beta = best;
        if (alpha >= beta) break; // prune
      }
    }

    memo.set(k, best);
    return best;
  }

  function wouldGain(mask, oAI, oH, currentTurn, edgeIdx) {
    const res = applyMove(mask, oAI, oH, currentTurn, edgeIdx);
    return res ? res.gained : 0;
  }

  function bestMoveForAI() {
    let bestE = -1;
    let bestV = -Infinity;

    // Same ordering heuristic
    const moves = [];
    for (let e = 0; e < E; e++) if (!hasEdge(edgesMask, e)) moves.push(e);
    moves.sort((a, b) => wouldGain(edgesMask, ownerAI, ownerHuman, 'ai', b) - wouldGain(edgesMask, ownerAI, ownerHuman, 'ai', a));

    let alpha = -Infinity, beta = Infinity;
    for (const e of moves) {
      const res = applyMove(edgesMask, ownerAI, ownerHuman, 'ai', e);
      const v = minimax(res.newMask, res.newOAI, res.newOH, res.nextTurn, alpha, beta);
      if (v > bestV) { bestV = v; bestE = e; }
      if (bestV > alpha) alpha = bestV;
    }
    return bestE;
  }

  // -------- UI rendering
  function clearSVG() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function drawBoard() {
    clearSVG();

    const pad = 60;
    const size = 400;
    const step = size / (N - 1);
    const dotR = 6;

    // background rect
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', 0); bg.setAttribute('y', 0);
    bg.setAttribute('width', 520); bg.setAttribute('height', 520);
    bg.setAttribute('fill', 'transparent');
    svg.appendChild(bg);

    // boxes (for ownership shading)
    for (let br = 0; br < BOX; br++) {
      for (let bc = 0; bc < BOX; bc++) {
        const b = br * BOX + bc;
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', pad + bc * step + 8);
        r.setAttribute('y', pad + br * step + 8);
        r.setAttribute('width', step - 16);
        r.setAttribute('height', step - 16);
        r.setAttribute('rx', 10);
        r.setAttribute('ry', 10);
        r.setAttribute('fill', 'transparent');
        svg.appendChild(r);
        boxRects[b] = r;
      }
    }

    // edges
    // horizontal
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N - 1; c++) {
        const idx = hEdgeIndex(r, c);
        const x1 = pad + c * step, y1 = pad + r * step;
        const x2 = pad + (c + 1) * step, y2 = y1;
        makeEdge(idx, x1, y1, x2, y2);
      }
    }
    // vertical
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N; c++) {
        const idx = vEdgeIndex(r, c);
        const x1 = pad + c * step, y1 = pad + r * step;
        const x2 = x1, y2 = pad + (r + 1) * step;
        makeEdge(idx, x1, y1, x2, y2);
      }
    }

    // dots
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        d.setAttribute('cx', pad + c * step);
        d.setAttribute('cy', pad + r * step);
        d.setAttribute('r', dotR);
        d.setAttribute('class', 'dot');
        svg.appendChild(d);
      }
    }
  }

  function makeEdge(idx, x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('class', 'line');
    svg.appendChild(line);
    edgeLines[idx] = line;

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
    hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
    hit.setAttribute('class', 'line hit');
    hit.addEventListener('click', () => onHumanClick(idx));
    svg.appendChild(hit);
    edgeHits[idx] = hit;
  }

  function render() {
    const sc = scores();
    humanScoreEl.textContent = sc.human;
    aiScoreEl.textContent = sc.ai;

    if (gameOver()) {
      const diff = sc.ai - sc.human;
      if (diff > 0) turnLabel.textContent = 'پایان — AI برنده شد';
      else if (diff < 0) turnLabel.textContent = 'پایان — تو بردی';
      else turnLabel.textContent = 'پایان — مساوی';
    } else {
      turnLabel.textContent = (turn === 'human') ? 'تو' : 'AI';
    }

    for (let e = 0; e < E; e++) {
      const ln = edgeLines[e];
      ln.classList.remove('taken-human', 'taken-ai');
      if (hasEdge(edgesMask, e)) {
        // edge owner color is not tracked; we approximate by last mover is not stored.
        // visual: mark based on whether edge helped claim boxes for someone at claim time not tracked here
        // We'll color by "who took the turn when it was clicked" during gameplay:
        // stored in ln.dataset.owner
        const own = ln.dataset.owner;
        ln.classList.add(own === 'ai' ? 'taken-ai' : 'taken-human');
      }
    }

    // box fills based on owners
    for (let b = 0; b < B; b++) {
      const r = boxRects[b];
      r.setAttribute('class', '');
      const aiOwn = (ownerAI >> b) & 1;
      const huOwn = (ownerHuman >> b) & 1;
      if (aiOwn) r.setAttribute('class', 'boxOwnerAI');
      else if (huOwn) r.setAttribute('class', 'boxOwnerHuman');
      else r.setAttribute('fill', 'transparent');
    }

    // enable/disable clicks when AI turn
    const disable = (turn !== 'human') || gameOver();
    for (let e = 0; e < E; e++) {
      edgeHits[e].style.pointerEvents = (!disable && !hasEdge(edgesMask, e)) ? 'auto' : 'none';
      edgeHits[e].style.cursor = (!disable && !hasEdge(edgesMask, e)) ? 'pointer' : 'default';
    }
  }

  function onHumanClick(edgeIdx) {
    if (turn !== 'human' || gameOver()) return;
    const res = applyMove(edgesMask, ownerAI, ownerHuman, 'human', edgeIdx);
    if (!res) return;

    edgesMask = res.newMask;
    ownerAI = res.newOAI;
    ownerHuman = res.newOH;
    turn = res.nextTurn;

    edgeLines[edgeIdx].dataset.owner = 'human';
    render();

    if (turn === 'ai' && !gameOver()) aiTurn();
  }

  function aiTurn() {
    thinkingEl.textContent = 'AI در حال فکر کردن…';
    render();

    // let UI paint first
    setTimeout(() => {
      const move = bestMoveForAI();
      if (move < 0) { thinkingEl.textContent = ''; return; }

      const res = applyMove(edgesMask, ownerAI, ownerHuman, 'ai', move);
      edgesMask = res.newMask;
      ownerAI = res.newOAI;
      ownerHuman = res.newOH;
      turn = res.nextTurn;

      edgeLines[move].dataset.owner = 'ai';
      thinkingEl.textContent = '';
      render();

      if (turn === 'ai' && !gameOver()) aiTurn();
    }, 30);
  }

  function resetGame() {
    edgesMask = 0n;
    ownerAI = 0;
    ownerHuman = 0;
    memo.clear();
    thinkingEl.textContent = '';

    // clear edge owner paint
    for (let e = 0; e < E; e++) {
      if (edgeLines[e]) delete edgeLines[e].dataset.owner;
    }

    const starter = document.querySelector('input[name="starter"]:checked').value;
    turn = (starter === 'ai') ? 'ai' : 'human';
    render();
    if (turn === 'ai') aiTurn();
  }

  // init
  drawBoard();
  newGameBtn.addEventListener('click', resetGame);
  resetGame();
})();

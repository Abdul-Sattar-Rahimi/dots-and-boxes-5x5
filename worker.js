// worker.js  (FAST AI - no hanging)

const N = 5;
const BOX = N - 1;        // 4
const H = (N - 1) * N;    // 20
const E = H + (N - 1) * N;// 40
const B = BOX * BOX;      // 16

function hEdgeIndex(r, c) { return r * (N - 1) + c; }
function vEdgeIndex(r, c) { return H + r * N + c; }

const boxEdges = Array.from({ length: B }, () => []);
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

// edge -> adjacent boxes
const edgeToBoxes = Array.from({ length: E }, () => []);
for (let b = 0; b < B; b++) for (const e of boxEdges[b]) edgeToBoxes[e].push(b);

const bitE = (i) => (1n << BigInt(i));
const hasEdge = (mask, i) => (mask & bitE(i)) !== 0n;

function boxOwned(oAI, oH, b) {
  return (((oAI | oH) >> b) & 1) === 1;
}

function boxEdgesCount(mask, b) {
  const es = boxEdges[b];
  let c = 0;
  if (hasEdge(mask, es[0])) c++;
  if (hasEdge(mask, es[1])) c++;
  if (hasEdge(mask, es[2])) c++;
  if (hasEdge(mask, es[3])) c++;
  return c;
}

function wouldCompleteBox(mask, oAI, oH, edgeIdx) {
  // after adding edgeIdx, does it complete any unowned box?
  for (const b of edgeToBoxes[edgeIdx]) {
    if (boxOwned(oAI, oH, b)) continue;
    // count edges, but include this new edge
    const before = boxEdgesCount(mask, b);
    // edgeIdx is definitely part of this box, so before+1 is the new count if it wasn't already drawn
    if (before === 3) return true;
  }
  return false;
}

function creates3SideForOpponent(mask, oAI, oH, edgeIdx) {
  // after drawing edgeIdx, do we create any unowned box with exactly 3 sides (a "gift")?
  // i.e., for any adjacent box that isn't owned, its edge count becomes 3.
  for (const b of edgeToBoxes[edgeIdx]) {
    if (boxOwned(oAI, oH, b)) continue;
    const before = boxEdgesCount(mask, b);
    // if this edge isn't already set, count increases by 1
    // before can be 0..3 here; if it becomes 3, we are creating a gift.
    if (before === 2) return true;
  }
  return false;
}

function minGiftScore(mask, oAI, oH, edgeIdx) {
  // Heuristic: how many "3-side boxes" do we create (bad), and how many 2-side we create (medium)
  let gift3 = 0;
  let gift2 = 0;

  for (const b of edgeToBoxes[edgeIdx]) {
    if (boxOwned(oAI, oH, b)) continue;
    const before = boxEdgesCount(mask, b);
    if (before === 2) gift3++;     // becomes 3
    else if (before === 1) gift2++; // becomes 2
  }
  return gift3 * 100 + gift2; // weight 3-side much higher
}

function pickMove(maskStr, oAI, oH) {
  const mask = BigInt(maskStr);

  const available = [];
  for (let e = 0; e < E; e++) if (!hasEdge(mask, e)) available.push(e);
  if (available.length === 0) return -1;

  // 1) If can complete a box now -> do it immediately (greedy capture)
  for (const e of available) {
    if (wouldCompleteBox(mask, oAI, oH, e)) return e;
  }

  // 2) Prefer safe moves: do NOT create a 3-side box for opponent
  const safe = [];
  for (const e of available) {
    if (!creates3SideForOpponent(mask, oAI, oH, e)) safe.push(e);
  }

  if (safe.length > 0) {
    // choose the safest (least future risk): minimize heuristic score
    let bestE = safe[0];
    let bestS = Infinity;
    for (const e of safe) {
      const s = minGiftScore(mask, oAI, oH, e);
      if (s < bestS) { bestS = s; bestE = e; }
    }
    return bestE;
  }

  // 3) If no safe moves exist, choose the least bad

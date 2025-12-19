// worker.js
let N=5, BOX=4, H=20, V=20, E=40, B=16;
const boxEdges = new Array(B).fill(null).map(()=>[]);
const edgeToBoxes = new Array(E).fill(null).map(()=>[]);
const memo = new Map();

function hEdgeIndex(r,c){ return r*(N-1)+c; }
function vEdgeIndex(r,c){ return H + r*N + c; }
const bitE = (i)=> (1n<<BigInt(i));
function hasEdge(mask,i){ return (mask & bitE(i))!==0n; }
function setEdge(mask,i){ return mask | bitE(i); }
function popcount16(x){
  x = x - ((x >> 1) & 0x5555);
  x = (x & 0x3333) + ((x >> 2) & 0x3333);
  return (((x + (x >> 4)) & 0x0F0F) * 0x0101) >> 8;
}
function boxComplete(mask,b){
  const es=boxEdges[b];
  return hasEdge(mask,es[0])&&hasEdge(mask,es[1])&&hasEdge(mask,es[2])&&hasEdge(mask,es[3]);
}
function applyMove(mask,oAI,oH,turn,edgeIdx){
  if(hasEdge(mask,edgeIdx)) return null;
  const newMask = setEdge(mask,edgeIdx);
  let newOAI=oAI, newOH=oH, gained=0;
  for(const b of edgeToBoxes[edgeIdx]){
    const owned=((newOAI|newOH)>>b)&1;
    if(!owned && boxComplete(newMask,b)){
      gained++;
      if(turn==='ai') newOAI |= (1<<b); else newOH |= (1<<b);
    }
  }
  const nextTurn = gained>0 ? turn : (turn==='ai'?'human':'ai');
  return {newMask,newOAI,newOH,nextTurn,gained};
}

// کلید سریع (بدون رشته): [40bit mask][16bit oAI][16bit oH][1bit turn]
function key(mask,oAI,oH,turn){
  const t = (turn==='ai') ? 1n : 0n;
  // mask (<=40bit) | oAI<<40 | oH<<56 | t<<72
  return mask | (BigInt(oAI)<<40n) | (BigInt(oH)<<56n) | (t<<72n);
}

function wouldGain(mask,oAI,oH,turn,edgeIdx){
  const r=applyMove(mask,oAI,oH,turn,edgeIdx);
  return r ? r.gained : 0;
}

function minimax(mask,oAI,oH,turn,alpha,beta){
  const k=key(mask,oAI,oH,turn);
  const c=memo.get(k);
  if(c!==undefined) return c;

  const claimed=popcount16(oAI|oH);
  if(claimed===B){
    const v = popcount16(oAI)-popcount16(oH);
    memo.set(k,v);
    return v;
  }

  const moves=[];
  for(let e=0;e<E;e++) if(!hasEdge(mask,e)) moves.push(e);
  moves.sort((a,b)=> wouldGain(mask,oAI,oH,turn,b)-wouldGain(mask,oAI,oH,turn,a));

  let best = (turn==='ai') ? -Infinity : Infinity;

  if(turn==='ai'){
    for(const e of moves){
      const r=applyMove(mask,oAI,oH,turn,e);
      const v=minimax(r.newMask,r.newOAI,r.newOH,r.nextTurn,alpha,beta);
      if(v>best) best=v;
      if(best>alpha) alpha=best;
      if(alpha>=beta) break;
    }
  }else{
    for(const e of moves){
      const r=applyMove(mask,oAI,oH,turn,e);
      const v=minimax(r.newMask,r.newOAI,r.newOH,r.nextTurn,alpha,beta);
      if(v<best) best=v;
      if(best<beta) beta=best;
      if(alpha>=beta) break;
    }
  }

  memo.set(k,best);
  return best;
}

function bestMoveForAI(mask,oAI,oH){
  const moves=[];
  for(let e=0;e<E;e++) if(!hasEdge(mask,e)) moves.push(e);
  moves.sort((a,b)=> wouldGain(mask,oAI,oH,'ai',b)-wouldGain(mask,oAI,oH,'ai',a));

  let bestE=-1, bestV=-Infinity;
  let alpha=-Infinity, beta=Infinity;

  for(const e of moves){
    const r=applyMove(mask,oAI,oH,'ai',e);
    const v=minimax(r.newMask,r.newOAI,r.newOH,r.nextTurn,alpha,beta);
    if(v>bestV){ bestV=v; bestE=e; }
    if(bestV>alpha) alpha=bestV;
  }
  return bestE;
}

function init(){
  // precompute boxes
  for(let br=0;br<BOX;br++){
    for(let bc=0;bc<BOX;bc++){
      const b=br*BOX+bc;
      const top=hEdgeIndex(br,bc);
      const bottom=hEdgeIndex(br+1,bc);
      const left=vEdgeIndex(br,bc);
      const right=vEdgeIndex(br,bc+1);
      boxEdges[b]=[top,right,bottom,left];
    }
  }
  for(let b=0;b<B;b++){
    for(const e of boxEdges[b]) edgeToBoxes[e].push(b);
  }
}

init();

self.onmessage = (ev)=>{
  const {mask,oAI,oH} = ev.data;
  // پاک کردن memo را نمی‌کنیم تا سریع‌تر شود
  const move = bestMoveForAI(BigInt(mask), oAI|0, oH|0);
  self.postMessage({move});
};

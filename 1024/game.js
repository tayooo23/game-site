'use strict';

const GRID = 4;
const LS_KEY = '1024-highscore';
const MAX_UNDO = 3;

let board, score, highscore, undoStack, won, over, continueAfterWin;
let tileSize, tileGap;

const gridTiles = document.getElementById('grid-tiles');
const gridWrapper = document.querySelector('.grid-wrapper');
const scoreEl = document.getElementById('score');
const bestEl  = document.getElementById('best');
const undoBtn = document.getElementById('btn-undo');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub   = document.getElementById('overlay-sub');
const overlayActions = document.getElementById('overlay-actions');

/* ── helpers ── */
function rand(n) { return Math.floor(Math.random() * n); }
function emptyIdx(b) {
  const e = [];
  for (let i = 0; i < GRID * GRID; i++) if (b[i] === 0) e.push(i);
  return e;
}
function addRandom(b) {
  const empty = emptyIdx(b);
  if (!empty.length) return;
  b[empty[rand(empty.length)]] = Math.random() < 0.9 ? 2 : 4;
}
function cloneBoard(b) { return [...b]; }

/* ── move logic (returns {board, score, moved, merged[]}) ── */
function slide(row) {
  const nums = row.filter(v => v);
  const result = [];
  let added = 0;
  let i = 0;
  while (i < nums.length) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      result.push({ val: nums[i] * 2, merged: true });
      added += nums[i] * 2;
      i += 2;
    } else {
      result.push({ val: nums[i], merged: false });
      i++;
    }
  }
  while (result.length < GRID) result.push({ val: 0, merged: false });
  return { result, added };
}

function applyMove(b, dir) {
  const next = new Array(GRID * GRID).fill(0);
  let gained = 0;
  let moved = false;
  const mergedSet = new Set();

  const getRC = (r, c) => {
    if (dir === 0) return { r, c };         // left
    if (dir === 1) return { r, c: GRID-1-c }; // right
    if (dir === 2) return { r: c, c: r };   // up   (transpose r↔c then slide left)
    if (dir === 3) return { r: GRID-1-c, c: r }; // down
  };

  for (let outer = 0; outer < GRID; outer++) {
    const row = [];
    for (let inner = 0; inner < GRID; inner++) {
      const { r, c } = getRC(outer, inner);
      row.push(b[r * GRID + c]);
    }
    const { result, added } = slide(row);
    gained += added;
    for (let inner = 0; inner < GRID; inner++) {
      const { r, c } = getRC(outer, inner);
      const idx = r * GRID + c;
      if (next[idx] !== result[inner].val) moved = true;
      next[idx] = result[inner].val;
      if (result[inner].merged && result[inner].val > 0) mergedSet.add(idx);
    }
  }
  return { next, gained, moved, mergedSet };
}

function canMove(b) {
  if (emptyIdx(b).length) return true;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const v = b[r * GRID + c];
      if (c + 1 < GRID && b[r * GRID + c + 1] === v) return true;
      if (r + 1 < GRID && b[(r+1) * GRID + c] === v) return true;
    }
  }
  return false;
}

/* ── DOM rendering ── */
function measureGrid() {
  const rect = gridTiles.getBoundingClientRect();
  // grid-tiles inset: 10px each side from grid-bg, gap 10px between cells
  // cell size = (rect.width - 3*gap) / 4
  tileGap = 10;
  tileSize = (rect.width - tileGap * (GRID - 1)) / GRID;
}

function posStyle(idx) {
  const r = Math.floor(idx / GRID);
  const c = idx % GRID;
  return {
    top:  r * (tileSize + tileGap) + 'px',
    left: c * (tileSize + tileGap) + 'px',
    width:  tileSize + 'px',
    height: tileSize + 'px',
  };
}

function fontSize(val) {
  if (val >= 1024) return '1.4rem';
  if (val >= 128)  return '1.7rem';
  if (val >= 16)   return '2rem';
  return '2.2rem';
}

let renderedTiles = [];

function renderBoard(mergedSet = new Set(), newIdxs = new Set()) {
  measureGrid();

  // Build a map of current DOM tiles by their position index
  // We match by value+pos for smooth transitions
  const existing = new Map(); // idx -> element
  for (const el of renderedTiles) {
    const idx = parseInt(el.dataset.idx);
    existing.set(idx, el);
  }

  const nextEls = [];

  for (let idx = 0; idx < GRID * GRID; idx++) {
    const val = board[idx];
    if (!val) continue;

    let el = existing.get(idx);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile';
      gridTiles.appendChild(el);
    }

    el.dataset.val = val;
    el.dataset.idx = idx;
    el.textContent = val;
    el.style.fontSize = fontSize(val);

    const pos = posStyle(idx);
    el.style.top    = pos.top;
    el.style.left   = pos.left;
    el.style.width  = pos.width;
    el.style.height = pos.height;

    // Remove old animation classes first
    el.classList.remove('new', 'merged');
    // Trigger reflow to restart animation
    void el.offsetWidth;

    if (mergedSet.has(idx)) el.classList.add('merged');
    if (newIdxs.has(idx))   el.classList.add('new');

    nextEls.push(el);
    existing.delete(idx);
  }

  // Remove tiles that are no longer on the board
  for (const el of existing.values()) {
    el.remove();
  }

  renderedTiles = nextEls;
}

function renderScores() {
  scoreEl.textContent = score;
  bestEl.textContent  = highscore;
}

function renderUndo() {
  const left = undoStack.length;
  undoBtn.textContent = `↩ ${left}`;
  undoBtn.disabled = left === 0;
}

/* ── overlay ── */
function showOverlay(title, sub, actions) {
  overlayTitle.textContent = title;
  overlaySub.textContent   = sub;
  overlayActions.innerHTML = '';
  for (const { label, cls, cb } of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + cls;
    btn.textContent = label;
    btn.addEventListener('click', cb);
    overlayActions.appendChild(btn);
  }
  overlay.removeAttribute('hidden');
}

function hideOverlay() {
  overlay.setAttribute('hidden', '');
}

/* ── game state ── */
function init() {
  board = new Array(GRID * GRID).fill(0);
  score = 0;
  undoStack = [];
  won = false;
  over = false;
  continueAfterWin = false;

  addRandom(board);
  addRandom(board);

  // Clear DOM tiles
  for (const el of renderedTiles) el.remove();
  renderedTiles = [];

  hideOverlay();

  const newIdxs = new Set();
  for (let i = 0; i < board.length; i++) if (board[i]) newIdxs.add(i);
  renderBoard(new Set(), newIdxs);
  renderScores();
  renderUndo();
}

function move(dir) {
  if (over) return;
  if (won && !continueAfterWin) return;

  const { next, gained, moved, mergedSet } = applyMove(board, dir);
  if (!moved) return;

  // Save undo state
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  undoStack.push({ board: cloneBoard(board), score });

  board = next;
  score += gained;
  if (score > highscore) {
    highscore = score;
    localStorage.setItem(LS_KEY, highscore);
  }

  // Place new tile
  const beforeEmpty = new Set(emptyIdx(next));
  addRandom(board);
  const newIdxs = new Set();
  for (let i = 0; i < board.length; i++) {
    if (board[i] && !next[i]) newIdxs.add(i);
  }

  renderBoard(mergedSet, newIdxs);
  renderScores();
  renderUndo();

  // Check win
  if (!won && !continueAfterWin && board.includes(1024)) {
    won = true;
    showOverlay('You reached 1024!', 'Amazing!', [
      { label: 'Keep going', cls: 'btn-new', cb: () => { continueAfterWin = true; hideOverlay(); } },
      { label: 'New game',   cls: 'btn-undo', cb: () => init() },
    ]);
    return;
  }

  // Check lose
  if (!canMove(board)) {
    over = true;
    showOverlay('Game Over', `Score: ${score}`, [
      { label: 'Try again', cls: 'btn-new', cb: () => init() },
    ]);
  }
}

function undo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  board = prev.board;
  score = prev.score;
  over = false;
  hideOverlay();
  renderBoard();
  renderScores();
  renderUndo();
}

/* ── input ── */
document.addEventListener('keydown', e => {
  const map = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3 };
  if (e.key in map) {
    e.preventDefault();
    move(map[e.key]);
  }
  if (e.key === 'u' || e.key === 'U') undo();
});

let touchStartX, touchStartY;
document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  if (Math.max(absDx, absDy) < 20) return;
  if (absDx > absDy) move(dx < 0 ? 0 : 1);
  else               move(dy < 0 ? 2 : 3);
}, { passive: true });

undoBtn.addEventListener('click', undo);
document.getElementById('btn-new').addEventListener('click', () => init());

/* ── boot ── */
highscore = parseInt(localStorage.getItem(LS_KEY)) || 0;

// Wait for layout then start
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    init();
  });
});

window.addEventListener('resize', () => {
  measureGrid();
  renderBoard();
});

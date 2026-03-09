import { Chessground } from 'https://cdn.jsdelivr.net/npm/@lichess-org/chessground@10.1.0/dist/chessground.min.js';
import { uciToMove } from 'https://cdn.jsdelivr.net/npm/@lichess-org/chessground@10.1.0/dist/util.js';
import { Chess, compat, fen, san, variant } from './vendor/chessops.bundle.js';
import {
  parseUci,
  makeUci,
  squareFile,
  squareRank,
} from './vendor/chessops.bundle.js';
import {
  getSupabaseClient,
  getPlayerSession,
  hasPlayerSession,
  signOutAndRedirect,
} from './supabase-client.js';

const { chessgroundDests } = compat;
const { parseFen, makeFen, INITIAL_FEN } = fen;
const { makeSan } = san;
const { normalizeMove } = variant;

const ROLE_LABEL = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
};

const PIECE_VALUE = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};
const ENGINE_MIN_ELO = 400;
const ENGINE_MAX_ELO = 2200;
const ENGINE_DEFAULT_ELO = 900;
const ENGINE_CALIBRATION_GAMES = 5;
const ENGINE_ANALYSIS_DEPTH = 12;
const LIVE_EVAL_DEPTH = 10;
const STOCKFISH_WORKER_PATH = './stockfish-worker.js?v=20260310g';
const THEME_MODE_KEY = 'cloud-chess-theme-mode-v1';
const AUTO_FLIP_HUMAN_KEY = 'cloud-chess-auto-flip-human-v1';
const ACTIVE_GAME_KEY_PREFIX = 'cloud-chess-active-game-v1:';
const SNAPSHOT_KEY_PREFIX = 'cloud-chess-board-snapshot-v1:';

const statusCard = document.getElementById('status-card');
const statusText = document.getElementById('status-text');
const turnDot = document.getElementById('turn-dot');
const syncText = document.getElementById('sync-text');
const boardShell = document.getElementById('chessground');
const moveList = document.getElementById('move-list');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const scoreWhiteEl = document.getElementById('score-white');
const scoreBlackEl = document.getElementById('score-black');

const accountUsernameEl = document.getElementById('account-username');
const accountEmailEl = document.getElementById('account-email');

const pieceStyleEl = document.getElementById('piece-style');
const boardStyleEl = document.getElementById('board-style');
const soundEnabledEl = document.getElementById('sound-enabled');
const autoSyncEnabledEl = document.getElementById('auto-sync-enabled');
const themeModeEl = document.getElementById('theme-mode');
const autoFlipHumanEl = document.getElementById('auto-flip-human');

const cloudStatusEl = document.getElementById('cloud-status');
const cloudGameIdEl = document.getElementById('cloud-game-id');
const recentGamesEl = document.getElementById('recent-games');
const promotionOverlayEl = document.getElementById('promotion-overlay');
const promotionGridEl = document.getElementById('promotion-grid');
const promotionCancelEl = document.getElementById('promotion-cancel');
const engineEnabledEl = document.getElementById('engine-enabled');
const enginePlayerColorEl = document.getElementById('engine-player-color');
const engineEloEl = document.getElementById('engine-elo');
const engineEloValueEl = document.getElementById('engine-elo-value');
const engineCalibrationTextEl = document.getElementById('engine-calibration-text');
const engineStatusEl = document.getElementById('engine-status');
const startStockfishBtnEl = document.getElementById('btn-start-stockfish');
const analyzeAllBtnEl = document.getElementById('btn-analyze-all');
const clearAnalysisBtnEl = document.getElementById('btn-clear-analysis');
const analysisSummaryEl = document.getElementById('analysis-summary');
const analysisListEl = document.getElementById('analysis-list');
const arenaCleanerEl = document.getElementById('arena-cleaner');
const arenaCleanerBarEl = document.getElementById('arena-cleaner-bar');
const arenaCleanerTextEl = document.getElementById('arena-cleaner-text');
const evalTrackEl = document.getElementById('eval-track');
const evalFillBlackEl = document.getElementById('eval-fill-black');
const evalFillWhiteEl = document.getElementById('eval-fill-white');
const evalReadoutEl = document.getElementById('eval-readout');
const evalColumnEl = document.querySelector('.eval-column');

const PROMOTION_ROLES = ['queen', 'rook', 'bishop', 'knight'];
const PROMOTION_TEXT = {
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
};
const PROMOTION_2D_CODE = {
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
};
const PROMOTION_3D_ROLE = {
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
};

const sounds = {
  move: new Audio('./assets/sound/futuristic/Move.ogg'),
  capture: new Audio('./assets/sound/futuristic/Capture.ogg'),
  check: new Audio('./assets/sound/futuristic/Check.ogg'),
  checkmate: new Audio('./assets/sound/futuristic/Checkmate.ogg'),
  draw: new Audio('./assets/sound/futuristic/Draw.ogg'),
};

const state = {
  ground: null,
  position: null,
  orientation: 'white',
  lastMoveUci: null,
  moves: [],
  capturedByWhite: [],
  capturedByBlack: [],
  history: [],
  pieceStyle: '2d',
  boardStyle: 'brown',
  soundEnabled: true,
  autoSyncEnabled: true,
  themeMode: 'auto',
  autoFlipHuman: false,
  supabase: null,
  player: null,
  gameId: null,
  channel: null,
  saveTimer: null,
  settingsTimer: null,
  analysisTimer: null,
  supportsExtendedSettings: true,
  syncingRemote: false,
  syncingSince: 0,
  sessionId: crypto.randomUUID(),
  awaitingPromotion: false,
  awaitingPromotionSince: 0,
  cleaningArena: false,
  engine: {
    enabled: false,
    side: 'black',
    elo: ENGINE_DEFAULT_ELO,
    calibrationGames: 0,
    calibrationTarget: ENGINE_CALIBRATION_GAMES,
    resultHandled: false,
    worker: null,
    workerUrl: '',
    ready: false,
    busy: false,
    pendingMove: null,
  },
  analysis: {
    worker: null,
    workerUrl: '',
    ready: false,
    pending: null,
    running: false,
    entries: [],
    summary: null,
    token: 0,
    depth: ENGINE_ANALYSIS_DEPTH,
  },
  liveEval: {
    timer: null,
    token: 0,
    pendingFen: '',
    lastFen: '',
    blackPercent: 50,
    scoreText: '+0.00',
    available: true,
    loading: false,
    nextRetryAt: 0,
  },
};

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function setCloudStatus(message, kind = '') {
  if (!cloudStatusEl) return;
  cloudStatusEl.textContent = message;
  cloudStatusEl.className = 'cloud-status';
  if (kind) cloudStatusEl.classList.add(kind);
}

function setSyncPill(message, kind = '') {
  if (!syncText) return;
  syncText.textContent = message;
  syncText.className = 'sync-pill';
  if (kind) syncText.classList.add(kind);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function activeGameStorageKey() {
  const playerId = state.player?.playerId || 'anonymous';
  return ACTIVE_GAME_KEY_PREFIX + playerId;
}

function boardSnapshotStorageKey() {
  const playerId = state.player?.playerId || 'anonymous';
  return SNAPSHOT_KEY_PREFIX + playerId;
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

function resolveThemeMode(mode) {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyDocumentTheme() {
  const resolved = resolveThemeMode(state.themeMode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = state.themeMode;
}

function readStoredThemeMode() {
  try {
    const raw = localStorage.getItem(THEME_MODE_KEY);
    if (!raw) return null;
    return normalizeThemeMode(raw);
  } catch {
    return null;
  }
}

function readStoredAutoFlipHuman() {
  try {
    const raw = localStorage.getItem(AUTO_FLIP_HUMAN_KEY);
    if (raw == null) return null;
    return raw === '1';
  } catch {
    return null;
  }
}

function persistLocalPreferences() {
  try {
    localStorage.setItem(THEME_MODE_KEY, state.themeMode);
    localStorage.setItem(AUTO_FLIP_HUMAN_KEY, state.autoFlipHuman ? '1' : '0');
  } catch {
    // no-op
  }
}

function loadLocalActiveGameId() {
  try {
    const id = (localStorage.getItem(activeGameStorageKey()) || '').trim();
    state.gameId = id || null;
  } catch {
    state.gameId = null;
  }
}

function persistLocalBoardSnapshot() {
  if (!state.position || !state.player) return;

  try {
    const info = gameStatus();
    const payload = {
      fen: currentFen(),
      turn: state.position.turn,
      status: mapStatusCode(info.code),
      result: info.result,
      lastMoveUci: state.lastMoveUci,
      moves: state.moves,
      capturedByWhite: state.capturedByWhite,
      capturedByBlack: state.capturedByBlack,
      sessionId: state.sessionId,
    };

    localStorage.setItem(boardSnapshotStorageKey(), JSON.stringify(payload));

    if (state.gameId) {
      localStorage.setItem(activeGameStorageKey(), state.gameId);
    }
  } catch {
    // no-op
  }
}

function engineHumanColor() {
  return state.engine.side === 'white' ? 'black' : 'white';
}
function engineStorageKey() {
  const playerId = state.player?.playerId || 'anonymous';
  return 'cloud-chess-engine-settings-v1:' + playerId;
}

function setEngineStatus(message, kind = '') {
  if (!engineStatusEl) return;
  engineStatusEl.textContent = message;
  engineStatusEl.className = 'engine-status';
  if (kind) engineStatusEl.classList.add(kind);
}

function playSound(name) {
  if (!state.soundEnabled) return;
  const audio = sounds[name];
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function createPositionFromFen(fen) {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

function currentFen() {
  return makeFen(state.position.toSetup());
}

function pieceToToken(piece) {
  return `${piece.color === 'white' ? 'w' : 'b'}${ROLE_LABEL[piece.role]}`;
}

function tokenToRole(token) {
  const roleChar = token[1];
  for (const [role, label] of Object.entries(ROLE_LABEL)) {
    if (label === roleChar) return role;
  }
  return 'pawn';
}

function tokenScore(token) {
  return PIECE_VALUE[tokenToRole(token)] || 0;
}

function gameStatus() {
  if (state.position.isCheckmate()) {
    const winner = state.position.turn === 'white' ? 'black' : 'white';
    return {
      code: 'checkmate',
      result: winner,
      text: `Checkmate. ${capitalize(winner)} wins.`,
    };
  }

  if (state.position.isStalemate()) {
    return {
      code: 'stalemate',
      result: 'draw',
      text: 'Draw by stalemate.',
    };
  }

  if (state.position.isInsufficientMaterial()) {
    return {
      code: 'draw',
      result: 'draw',
      text: 'Draw by insufficient material.',
    };
  }

  if (state.position.isCheck()) {
    return {
      code: 'check',
      result: null,
      text: `${capitalize(state.position.turn)} to move - check.`,
    };
  }

  return {
    code: 'ongoing',
    result: null,
    text: `${capitalize(state.position.turn)} to move.`,
  };
}

function mapStatusCode(code) {
  if (code === 'checkmate') return 'checkmate';
  if (code === 'stalemate') return 'stalemate';
  if (code === 'draw') return 'draw';
  return 'ongoing';
}

function isMatchFinished() {
  const code = gameStatus().code;
  return code === 'checkmate' || code === 'stalemate' || code === 'draw';
}

function boardHasPriorGame() {
  if (!state.position) return false;
  return state.moves.length > 0 || currentFen() !== INITIAL_FEN;
}

async function runArenaCleanupAnimation() {
  if (!arenaCleanerEl || !arenaCleanerBarEl || !arenaCleanerTextEl) return;

  const checkpoints = [
    { at: 12, text: 'Scanning board clutter...' },
    { at: 36, text: 'Collecting loose pieces...' },
    { at: 58, text: 'Polishing squares...' },
    { at: 82, text: 'Calibrating robot arms...' },
    { at: 100, text: 'Arena ready for match.' },
  ];

  state.cleaningArena = true;
  refreshBoard();

  arenaCleanerEl.classList.add('open');
  arenaCleanerEl.setAttribute('aria-hidden', 'false');
  arenaCleanerBarEl.style.width = '0%';
  arenaCleanerTextEl.textContent = checkpoints[0].text;

  await new Promise(resolve => {
    let progress = 0;
    let checkpointIndex = 0;

    const timer = setInterval(() => {
      progress = Math.min(100, progress + 6 + Math.random() * 13);
      arenaCleanerBarEl.style.width = progress.toFixed(0) + '%';

      while (
        checkpointIndex + 1 < checkpoints.length &&
        progress >= checkpoints[checkpointIndex + 1].at
      ) {
        checkpointIndex += 1;
        arenaCleanerTextEl.textContent = checkpoints[checkpointIndex].text;
      }

      if (progress >= 100) {
        clearInterval(timer);
        setTimeout(resolve, 320);
      }
    }, 120);
  });

  arenaCleanerEl.classList.remove('open');
  arenaCleanerEl.setAttribute('aria-hidden', 'true');
  state.cleaningArena = false;
  refreshBoard();
}

async function startStockfishMatch() {
  if (state.cleaningArena) return;

  const shouldCleanArena = boardHasPriorGame();
  if (shouldCleanArena) {
    setEngineStatus('Robot cleaner is tidying the arena...', 'warn');
    await runArenaCleanupAnimation();
    newGame({ skipComputerMove: true });
  }

  state.engine.enabled = true;
  state.engine.resultHandled = false;
  renderEngineControls();
  saveEnginePreferences();

  const ready = await initPlayWorker();
  if (!ready) {
    state.engine.enabled = false;
    renderEngineControls();
    saveEnginePreferences();
    return;
  }

  setEngineStatus(
    shouldCleanArena
      ? 'Arena cleaned. Stockfish match started.'
      : 'Stockfish match started.',
    'ok',
  );

  maybeRequestComputerMove().catch(error => {
    setEngineStatus('Engine move failed: ' + error.message, 'error');
  });
}

function renderStatus() {
  const info = gameStatus();
  statusCard.className = 'status-card';
  statusText.textContent = info.text;
  turnDot.className = `turn-dot ${state.position.turn}`;

  if (info.code === 'check') statusCard.classList.add('is-check');
  if (info.code === 'checkmate') statusCard.classList.add('is-checkmate');
  if (info.code === 'stalemate' || info.code === 'draw') statusCard.classList.add('is-draw');
}

function renderMoveList() {
  moveList.innerHTML = '';

  if (!state.moves.length) {
    const empty = document.createElement('div');
    empty.className = 'move-row';
    empty.innerHTML = '<span class="num">-</span><span class="w">No moves yet.</span><span></span>';
    moveList.appendChild(empty);
    return;
  }

  for (let i = 0; i < state.moves.length; i += 2) {
    const whiteMove = state.moves[i];
    const blackMove = state.moves[i + 1];
    const row = document.createElement('div');
    row.className = 'move-row';

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${Math.floor(i / 2) + 1}.`;

    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = whiteMove?.san || '';

    const b = document.createElement('span');
    b.className = 'b';
    b.textContent = blackMove?.san || '';

    row.append(num, w, b);
    moveList.appendChild(row);
  }

  moveList.scrollTop = moveList.scrollHeight;
}

function renderCaptured() {
  capturedWhiteEl.innerHTML = '';
  capturedBlackEl.innerHTML = '';

  for (const token of state.capturedByWhite) {
    const chip = document.createElement('span');
    chip.className = 'piece-chip';
    chip.textContent = token;
    capturedWhiteEl.appendChild(chip);
  }

  for (const token of state.capturedByBlack) {
    const chip = document.createElement('span');
    chip.className = 'piece-chip';
    chip.textContent = token;
    capturedBlackEl.appendChild(chip);
  }

  const whiteScore = state.capturedByWhite.reduce((sum, token) => sum + tokenScore(token), 0);
  const blackScore = state.capturedByBlack.reduce((sum, token) => sum + tokenScore(token), 0);
  const diff = whiteScore - blackScore;

  scoreWhiteEl.textContent = diff > 0 ? `Material edge: +${diff}` : '';
  scoreBlackEl.textContent = diff < 0 ? `Material edge: +${Math.abs(diff)}` : '';
}

function renderEngineControls() {
  if (!engineEnabledEl) return;

  const matchFinished = isMatchFinished();

  engineEnabledEl.checked = state.engine.enabled;
  enginePlayerColorEl.value = engineHumanColor();
  engineEloEl.value = String(state.engine.elo);
  engineEloValueEl.textContent = String(state.engine.elo);

  if (analyzeAllBtnEl) {
    analyzeAllBtnEl.disabled = !matchFinished || !state.moves.length || state.analysis.running || state.cleaningArena;
  }

  if (clearAnalysisBtnEl) {
    clearAnalysisBtnEl.disabled =
      state.analysis.running ||
      (!state.analysis.entries.length && !state.analysis.summary) ||
      state.cleaningArena;
  }

  if (startStockfishBtnEl) {
    startStockfishBtnEl.disabled = state.cleaningArena || state.engine.busy;
    startStockfishBtnEl.textContent = boardHasPriorGame()
      ? 'Clean Arena & Start Match'
      : 'Start Stockfish Match';
  }

  const played = state.engine.calibrationGames;
  const target = state.engine.calibrationTarget;
  if (played < target) {
    engineCalibrationTextEl.textContent = 'Calibration: ' + played + '/' + target + ' games';
  } else {
    engineCalibrationTextEl.textContent = 'Calibrated (' + played + ' games)';
  }
}

function formatEval(score) {
  if (!score) return '+0.00';
  if (score.type === 'mate') {
    const prefix = score.value > 0 ? '+' : '-';
    return prefix + 'M' + Math.abs(score.value);
  }
  const value = score.value / 100;
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(2);
}

function scoreToCentipawns(score) {
  if (!score) return 0;
  if (score.type === 'cp') return score.value;
  if (score.type === 'mate') {
    const sign = score.value >= 0 ? 1 : -1;
    const plyDistance = Math.min(99, Math.abs(score.value));
    return sign * (32000 - plyDistance * 100);
  }
  return 0;
}

function orientScore(score, sideToMove, targetColor) {
  if (!score) return null;
  const factor = sideToMove === targetColor ? 1 : -1;
  return {
    type: score.type,
    value: score.value * factor,
  };
}

function scoreToBlackBarPercent(score) {
  if (!score) return 50;

  if (score.type === 'mate') {
    if (score.value > 0) return 0;
    if (score.value < 0) return 100;
    return 50;
  }

  const cp = clamp(score.value, -1800, 1800);
  const whitePercent = 50 + 50 * Math.tanh(cp / 360);
  return clamp(100 - whitePercent, 0, 100);
}

function renderLiveEvaluationBar() {
  if (!evalTrackEl || !evalFillBlackEl || !evalFillWhiteEl || !evalReadoutEl) return;

  if (!state.position || !isMatchFinished()) {
    if (evalColumnEl) evalColumnEl.classList.add('hidden');
    state.liveEval.loading = false;
    evalTrackEl.classList.remove('loading');
    evalFillBlackEl.style.height = '50%';
    evalFillWhiteEl.style.height = '50%';
    evalReadoutEl.textContent = '--';
    evalReadoutEl.classList.remove('on-dark');
    evalReadoutEl.classList.remove('on-light');
    return;
  }

  if (evalColumnEl) evalColumnEl.classList.remove('hidden');

  const blackPercent = clamp(state.liveEval.blackPercent, 0, 100);
  const whitePercent = 100 - blackPercent;

  evalFillBlackEl.style.height = blackPercent.toFixed(1) + '%';
  evalFillWhiteEl.style.height = whitePercent.toFixed(1) + '%';
  evalReadoutEl.textContent = state.liveEval.available ? state.liveEval.scoreText : '--';

  const readoutOnDark = blackPercent >= 50;
  evalReadoutEl.classList.toggle('on-dark', readoutOnDark);
  evalReadoutEl.classList.toggle('on-light', !readoutOnDark);

  if (state.liveEval.loading) {
    evalTrackEl.classList.add('loading');
  } else {
    evalTrackEl.classList.remove('loading');
  }
}
function classifyMove(cpl, playedUci, bestUci) {
  const normalize = text => (text || '').trim().toLowerCase();
  if (bestUci && normalize(playedUci) === normalize(bestUci)) return 'best';
  if (cpl <= 35) return 'good';
  if (cpl <= 100) return 'inaccuracy';
  if (cpl <= 220) return 'mistake';
  return 'blunder';
}

function summarizeAnalysis(entries) {
  if (!entries.length) return null;

  const counts = {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };

  for (const entry of entries) {
    counts[entry.grade] += 1;
  }

  const avgCpl = Math.round(entries.reduce((sum, entry) => sum + entry.cpl, 0) / entries.length);
  return { counts, avgCpl, total: entries.length };
}

function renderAnalysis() {
  if (!analysisSummaryEl || !analysisListEl) return;

  if (!isMatchFinished()) {
    analysisSummaryEl.textContent = 'Analysis unlocks after checkmate or draw.';
    analysisListEl.innerHTML = '';

    const locked = document.createElement('div');
    locked.className = 'analysis-item locked';
    locked.textContent =
      state.moves.length
        ? 'Finish this match to run move quality analysis (best, good, inaccuracy, mistake, blunder).'
        : 'Play a match first. Analysis becomes available after the result is decided.';
    analysisListEl.appendChild(locked);
    return;
  }

  const summary = state.analysis.summary;
  if (!summary) {
    analysisSummaryEl.textContent = state.analysis.running
      ? 'Analyzing finished match...'
      : 'No analysis yet.';
  } else {
    analysisSummaryEl.textContent =
      'Moves: ' + summary.total +
      ' | Avg CPL: ' + summary.avgCpl +
      ' | Best ' + summary.counts.best +
      ', Good ' + summary.counts.good +
      ', Inaccuracy ' + summary.counts.inaccuracy +
      ', Mistake ' + summary.counts.mistake +
      ', Blunder ' + summary.counts.blunder;
  }

  analysisListEl.innerHTML = '';

  if (!state.analysis.entries.length) {
    if (!state.analysis.running) {
      const empty = document.createElement('div');
      empty.className = 'analysis-item';
      empty.textContent = 'Run analysis to evaluate every played move.';
      analysisListEl.appendChild(empty);
    }
    return;
  }

  for (const entry of state.analysis.entries) {
    const row = document.createElement('div');
    row.className = 'analysis-item';

    const head = document.createElement('div');
    head.className = 'analysis-item-head';

    const left = document.createElement('strong');
    const turnLabel = entry.color === 'white'
      ? Math.ceil(entry.ply / 2) + '.'
      : Math.ceil(entry.ply / 2) + '...';
    left.textContent = turnLabel + ' ' + entry.san;

    const badge = document.createElement('span');
    badge.className = 'analysis-badge ' + entry.grade;
    badge.textContent = entry.grade;

    head.append(left, badge);

    const meta = document.createElement('div');
    meta.className = 'analysis-item-meta';

    const cpl = document.createElement('span');
    cpl.textContent = 'CPL ' + entry.cpl;

    const evalText = document.createElement('span');
    evalText.textContent = 'Eval ' + entry.evalWhite;

    meta.append(cpl, evalText);

    const best = document.createElement('div');
    best.className = 'analysis-best';
    best.textContent = 'Best: ' + (entry.bestMoveSan || '--') + ' (' + (entry.bestMoveUci || '--') + ')';

    row.append(head, meta, best);
    analysisListEl.appendChild(row);
  }
}

function applyTheme() {
  applyDocumentTheme();

  if (boardShell) {
    boardShell.dataset.pieceStyle = state.pieceStyle;
    boardShell.dataset.boardStyle = state.boardStyle;
  }

  if (state.ground) {
    state.ground.set({
      addPieceZIndex: state.pieceStyle === '3d',
    });
  }
}
function selfHealLocks() {
  const now = Date.now();

  if (state.syncingRemote && state.syncingSince && now - state.syncingSince > 3500) {
    state.syncingRemote = false;
    state.syncingSince = 0;
    setCloudStatus('Recovered from stale sync lock.', 'error');
  }

  const overlayOpen = Boolean(promotionOverlayEl?.classList.contains('open'));
  if (
    state.awaitingPromotion &&
    ((!overlayOpen && state.awaitingPromotionSince > 0) ||
      (state.awaitingPromotionSince > 0 && now - state.awaitingPromotionSince > 20000))
  ) {
    state.awaitingPromotion = false;
    state.awaitingPromotionSince = 0;
  }
}

function refreshBoard() {
  if (!state.ground || !state.position) return;

  selfHealLocks();

  if (state.engine.enabled) {
    state.orientation = engineHumanColor();
  } else if (state.autoFlipHuman) {
    state.orientation = state.position.turn;
  }

  const info = gameStatus();
  const isActive = info.code === 'ongoing' || info.code === 'check';
  const blockedByEngine = state.engine.enabled && (state.position.turn === state.engine.side || state.engine.busy);
  const canMove = isActive && !state.awaitingPromotion && !blockedByEngine && !state.cleaningArena;

  state.ground.set({
    fen: currentFen(),
    orientation: state.orientation,
    turnColor: state.position.turn,
    check: state.position.isCheck(),
    lastMove: state.lastMoveUci ? uciToMove(state.lastMoveUci) : undefined,
    addPieceZIndex: state.pieceStyle === '3d',
    movable: {
      color: canMove ? state.position.turn : undefined,
      dests: canMove ? chessgroundDests(state.position) : new Map(),
      events: {
        after: onGroundMove,
      },
    },
  });
}

function refreshUi() {
  refreshBoard();
  renderStatus();
  renderMoveList();
  renderCaptured();
  renderEngineControls();
  renderAnalysis();
  renderLiveEvaluationBar();
  queueLiveEvaluation();
  persistLocalBoardSnapshot();
}
function isPromotionNeeded(move, piece) {
  if (!piece || piece.role !== 'pawn' || !('to' in move)) return false;
  const rank = squareRank(move.to);
  return (piece.color === 'white' && rank === 7) || (piece.color === 'black' && rank === 0);
}

function promptPromotionFallback() {
  const raw = window.prompt('Promote pawn to: q (queen), r (rook), b (bishop), n (knight)', 'q');
  if (raw == null) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'q' || value === 'queen') return 'queen';
  if (value === 'r' || value === 'rook') return 'rook';
  if (value === 'b' || value === 'bishop') return 'bishop';
  if (value === 'n' || value === 'knight') return 'knight';
  return null;
}

function promotionImagePath(color, role) {
  if (state.pieceStyle === '3d') {
    const pieceColor = color === 'white' ? 'White' : 'Black';
    return `./assets/pieces/3d/staunton-basic/${pieceColor}-${PROMOTION_3D_ROLE[role]}.png`;
  }

  const prefix = color === 'white' ? 'w' : 'b';
  return `./assets/pieces/2d/cburnett/${prefix}${PROMOTION_2D_CODE[role]}.svg`;
}

function choosePromotion(color) {
  return new Promise(resolve => {
    if (!promotionOverlayEl || !promotionGridEl || !promotionCancelEl) {
      resolve(promptPromotionFallback() || 'queen');
      return;
    }

    promotionGridEl.innerHTML = '';
    promotionOverlayEl.classList.add('open');
    promotionOverlayEl.setAttribute('aria-hidden', 'false');
    let settled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (settled) return;
      finish(promptPromotionFallback());
    }, 12000);

    const finish = selection => {
      if (settled) return;
      settled = true;
      promotionOverlayEl.classList.remove('open');
      promotionOverlayEl.setAttribute('aria-hidden', 'true');
      promotionGridEl.innerHTML = '';
      promotionCancelEl.onclick = null;
      promotionOverlayEl.onclick = null;
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('keydown', onHotkeys);
      window.clearTimeout(fallbackTimer);
      resolve(selection);
    };

    const onEscape = event => {
      if (event.key === 'Escape') finish(null);
    };
    const onHotkeys = event => {
      const key = event.key.toLowerCase();
      if (key === 'q') finish('queen');
      else if (key === 'r') finish('rook');
      else if (key === 'b') finish('bishop');
      else if (key === 'n') finish('knight');
    };

    window.addEventListener('keydown', onEscape);
    window.addEventListener('keydown', onHotkeys);

    promotionCancelEl.onclick = () => finish(null);
    promotionOverlayEl.onclick = event => {
      if (event.target === promotionOverlayEl) finish(null);
    };

    for (const role of PROMOTION_ROLES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'promotion-btn';
      const imgSrc = promotionImagePath(color, role);
      button.innerHTML = `<span>${PROMOTION_TEXT[role]}</span><img class="promotion-piece-img" src="${imgSrc}" alt="${PROMOTION_TEXT[role]}" />`;
      button.addEventListener('click', () => finish(role));
      promotionGridEl.appendChild(button);
    }
  });
}

function detectCapture(position, move) {
  if (!('from' in move)) return null;
  const movingPiece = position.board.get(move.from);
  if (!movingPiece) return null;

  const directCapture = position.board.get(move.to);
  if (directCapture) return directCapture;

  const isDiagonalPawnMove =
    movingPiece.role === 'pawn' && squareFile(move.from) !== squareFile(move.to);

  if (isDiagonalPawnMove) {
    return {
      color: movingPiece.color === 'white' ? 'black' : 'white',
      role: 'pawn',
    };
  }

  return null;
}

function saveEnginePreferences() {
  if (!state.player) return;

  const payload = {
    enabled: state.engine.enabled,
    side: state.engine.side,
    elo: state.engine.elo,
    calibrationGames: state.engine.calibrationGames,
  };

  try {
    localStorage.setItem(engineStorageKey(), JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function loadEnginePreferences() {
  if (!state.player) return;

  try {
    const raw = localStorage.getItem(engineStorageKey());
    if (!raw) return;

    const parsed = JSON.parse(raw);
    state.engine.enabled = Boolean(parsed.enabled);
    state.engine.side = parsed.side === 'white' ? 'white' : 'black';
    state.engine.elo = clamp(Number(parsed.elo) || ENGINE_DEFAULT_ELO, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
    state.engine.calibrationGames = clamp(
      Number(parsed.calibrationGames) || 0,
      0,
      state.engine.calibrationTarget,
    );
  } catch {
    // no-op
  }
}

function cancelEngineSearch(reason = 'Cancelled') {
  const pending = state.engine.pendingMove;
  state.engine.pendingMove = null;
  state.engine.busy = false;

  if (state.engine.worker) {
    try {
      state.engine.worker.postMessage('stop');
    } catch {
      // no-op
    }
  }

  if (pending) pending.reject(new Error(reason));
}

function cancelAnalysisRequest(reason = 'Cancelled') {
  const pending = state.analysis.pending;
  state.analysis.pending = null;

  if (state.analysis.worker) {
    try {
      state.analysis.worker.postMessage('stop');
    } catch {
      // no-op
    }
  }

  if (pending) pending.reject(new Error(reason));
}

function resetAnalysisState(render = true) {
  if (state.analysisTimer) {
    clearTimeout(state.analysisTimer);
    state.analysisTimer = null;
  }

  state.analysis.token += 1;
  state.analysis.running = false;
  cancelAnalysisRequest('Analysis reset');
  state.analysis.entries = [];
  state.analysis.summary = null;

  if (render) renderAnalysis();
}

function mapDisplayEloToUci(elo) {
  const bounded = clamp(elo, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
  const ratio = (bounded - ENGINE_MIN_ELO) / (ENGINE_MAX_ELO - ENGINE_MIN_ELO);
  return Math.round(1320 + ratio * (2800 - 1320));
}

function mapDisplayEloToSkill(elo) {
  const bounded = clamp(elo, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
  const ratio = (bounded - ENGINE_MIN_ELO) / (ENGINE_MAX_ELO - ENGINE_MIN_ELO);
  return Math.round(ratio * 20);
}

function moveTimeForElo(elo) {
  const bounded = clamp(elo, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
  const ratio = (bounded - ENGINE_MIN_ELO) / (ENGINE_MAX_ELO - ENGINE_MIN_ELO);
  return Math.round(140 + ratio * 960);
}

function parseUciInfoLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (!tokens.length || tokens[0] !== 'info') return null;

  const scoreIndex = tokens.indexOf('score');
  if (scoreIndex < 0 || scoreIndex + 2 >= tokens.length) return null;

  const scoreType = tokens[scoreIndex + 1];
  const rawScore = Number(tokens[scoreIndex + 2]);
  if (!Number.isFinite(rawScore)) return null;
  if (scoreType !== 'cp' && scoreType !== 'mate') return null;

  const depthIndex = tokens.indexOf('depth');
  const depth = depthIndex >= 0 ? Number(tokens[depthIndex + 1]) || 0 : 0;

  const multipvIndex = tokens.indexOf('multipv');
  const multipv = multipvIndex >= 0 ? Number(tokens[multipvIndex + 1]) || 1 : 1;

  const pvIndex = tokens.indexOf('pv');
  const pv = pvIndex >= 0 ? tokens.slice(pvIndex + 1).join(' ') : '';

  return {
    depth,
    multipv,
    score: {
      type: scoreType,
      value: rawScore,
    },
    pv,
  };
}

function extractBestMove(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove') return null;
  return tokens[1] || null;
}

function waitForUciOk(worker, timeoutMs = 90000) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);

    const onMessage = event => {
      const line = String(event.data || '').trim();
      if (line === 'uciok') finish(true);
    };

    const onError = () => finish(false);

    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(ok);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage('uci');
  });
}

async function createStockfishWorker() {
  let worker = null;

  try {
    worker = new Worker(new URL(STOCKFISH_WORKER_PATH, import.meta.url));
  } catch {
    return null;
  }

  const ok = await waitForUciOk(worker);
  if (!ok) {
    try {
      worker.terminate();
    } catch {
      // no-op
    }
    return null;
  }

  return worker;
}

function handlePlayWorkerLine(line) {
  const bestMove = extractBestMove(line);
  if (!bestMove) return;

  const pending = state.engine.pendingMove;
  if (!pending) return;

  state.engine.pendingMove = null;
  pending.resolve(bestMove);
}

function handleAnalysisWorkerLine(line) {
  const pending = state.analysis.pending;
  if (!pending) return;

  if (line.startsWith('info ')) {
    const parsed = parseUciInfoLine(line);
    if (!parsed || parsed.multipv !== 1) return;

    if (!pending.bestInfo || parsed.depth >= pending.bestInfo.depth) {
      pending.bestInfo = parsed;
    }
    return;
  }

  const bestMove = extractBestMove(line);
  if (!bestMove) return;

  state.analysis.pending = null;
  pending.resolve({
    bestmove: bestMove,
    score: pending.bestInfo ? pending.bestInfo.score : null,
    depth: pending.bestInfo ? pending.bestInfo.depth : 0,
    pv: pending.bestInfo ? pending.bestInfo.pv : '',
  });
}

async function initPlayWorker() {
  if (state.engine.worker && state.engine.ready) return true;

  cancelEngineSearch('Reinitializing engine');

  const worker = await createStockfishWorker();
  if (!worker) {
    state.engine.ready = false;
    setEngineStatus('Could not start Stockfish worker.', 'error');
    return false;
  }

  worker.onmessage = event => {
    handlePlayWorkerLine(String(event.data || '').trim());
  };

  worker.onerror = () => {
    state.engine.ready = false;
    setEngineStatus('Stockfish play worker crashed.', 'error');
    cancelEngineSearch('Engine worker crashed');
  };

  state.engine.worker = worker;
  state.engine.workerUrl = STOCKFISH_WORKER_PATH;
  state.engine.ready = true;

  configurePlayStrength();
  setEngineStatus('Stockfish ready.', 'ok');
  return true;
}

async function initAnalysisWorker() {
  if (state.analysis.worker && state.analysis.ready) return true;

  cancelAnalysisRequest('Reinitializing analysis');

  const worker = await createStockfishWorker();
  if (!worker) {
    state.analysis.ready = false;
    setEngineStatus('Could not start Stockfish analysis worker.', 'error');
    return false;
  }

  worker.onmessage = event => {
    handleAnalysisWorkerLine(String(event.data || '').trim());
  };

  worker.onerror = () => {
    state.analysis.ready = false;
    setEngineStatus('Stockfish analysis worker crashed.', 'error');
    cancelAnalysisRequest('Analysis worker crashed');
  };

  state.analysis.worker = worker;
  state.analysis.workerUrl = STOCKFISH_WORKER_PATH;
  state.analysis.ready = true;

  worker.postMessage('setoption name Threads value 1');
  worker.postMessage('setoption name Hash value 32');
  worker.postMessage('setoption name MultiPV value 1');

  return true;
}

function configurePlayStrength() {
  if (!state.engine.worker || !state.engine.ready) return;

  const uciElo = mapDisplayEloToUci(state.engine.elo);
  const skill = mapDisplayEloToSkill(state.engine.elo);

  state.engine.worker.postMessage('setoption name Threads value 1');
  state.engine.worker.postMessage('setoption name Hash value 32');
  state.engine.worker.postMessage('setoption name UCI_LimitStrength value true');
  state.engine.worker.postMessage('setoption name UCI_Elo value ' + uciElo);
  state.engine.worker.postMessage('setoption name Skill Level value ' + skill);
}

async function requestEngineBestMove(fenText) {
  const ready = await initPlayWorker();
  if (!ready || !state.engine.worker) {
    throw new Error('Stockfish play engine is not available.');
  }

  cancelEngineSearch('Replaced by new move request');

  return new Promise((resolve, reject) => {
    state.engine.pendingMove = { resolve, reject };

    const thinkMs = moveTimeForElo(state.engine.elo);
    state.engine.worker.postMessage('ucinewgame');
    state.engine.worker.postMessage('position fen ' + fenText);
    state.engine.worker.postMessage('go movetime ' + thinkMs);
  });
}

function requestPositionAnalysis(fenText, depth) {
  if (!state.analysis.worker || !state.analysis.ready) {
    return Promise.reject(new Error('Stockfish analysis engine is not available.'));
  }

  if (state.analysis.pending) {
    return Promise.reject(new Error('Analysis request overlap detected.'));
  }

  return new Promise((resolve, reject) => {
    state.analysis.pending = {
      resolve,
      reject,
      bestInfo: null,
    };

    state.analysis.worker.postMessage('position fen ' + fenText);
    state.analysis.worker.postMessage('go depth ' + depth);
  });
}

function queueLiveEvaluation(delayMs = 160) {
  if (!state.position) return;

  if (!isMatchFinished()) {
    state.liveEval.pendingFen = '';
    state.liveEval.lastFen = '';
    state.liveEval.loading = false;

    if (state.liveEval.timer) {
      clearTimeout(state.liveEval.timer);
      state.liveEval.timer = null;
    }

    renderLiveEvaluationBar();
    return;
  }

  const fenText = currentFen();
  state.liveEval.pendingFen = fenText;

  if (state.analysis.running || state.cleaningArena) {
    state.liveEval.loading = false;
    renderLiveEvaluationBar();
    return;
  }

  if (!state.liveEval.available && Date.now() < state.liveEval.nextRetryAt) {
    state.liveEval.loading = false;
    renderLiveEvaluationBar();
    return;
  }

  if (state.liveEval.available && state.liveEval.lastFen === fenText && !state.liveEval.loading) {
    renderLiveEvaluationBar();
    return;
  }

  if (state.liveEval.timer) {
    clearTimeout(state.liveEval.timer);
    state.liveEval.timer = null;
  }

  state.liveEval.loading = true;
  renderLiveEvaluationBar();

  state.liveEval.timer = setTimeout(() => {
    state.liveEval.timer = null;
    updateLiveEvaluation(fenText).catch(() => {});
  }, delayMs);
}

async function updateLiveEvaluation(fenText) {
  if (!state.position) return;
  if (!isMatchFinished()) return;
  if (state.analysis.running || state.cleaningArena) return;
  if (fenText !== state.liveEval.pendingFen) return;

  if (state.analysis.pending) {
    queueLiveEvaluation(180);
    return;
  }

  const ready = await initAnalysisWorker();
  if (!ready) {
    state.liveEval.available = false;
    state.liveEval.nextRetryAt = Date.now() + 8000;
    state.liveEval.loading = false;
    renderLiveEvaluationBar();
    return;
  }

  if (fenText !== state.liveEval.pendingFen || state.analysis.running || state.cleaningArena) return;

  if (state.analysis.pending) {
    queueLiveEvaluation(180);
    return;
  }

  const token = state.liveEval.token + 1;
  state.liveEval.token = token;

  try {
    const result = await requestPositionAnalysis(fenText, LIVE_EVAL_DEPTH);
    if (token !== state.liveEval.token || fenText !== state.liveEval.pendingFen) return;

    const turnToken = fenText.trim().split(/\s+/)[1];
    const sideToMove = turnToken === 'b' ? 'black' : 'white';
    const whiteScore = orientScore(result.score, sideToMove, 'white');

    state.liveEval.blackPercent = scoreToBlackBarPercent(whiteScore);
    state.liveEval.scoreText = formatEval(whiteScore);
    state.liveEval.available = true;
    state.liveEval.nextRetryAt = 0;
    state.liveEval.loading = false;
    state.liveEval.lastFen = fenText;
    renderLiveEvaluationBar();
  } catch (error) {
    if (token !== state.liveEval.token) return;

    if (error?.message && /position analysis timeout/i.test(error.message)) {
      queueLiveEvaluation(180);
      return;
    }

    if (error?.message && /worker restarting/i.test(error.message)) {
      queueLiveEvaluation(120);
      return;
    }

    state.liveEval.available = false;
    state.liveEval.nextRetryAt = Date.now() + 8000;
    state.liveEval.loading = false;
    renderLiveEvaluationBar();
  }
}
async function analyzeAllMoves() {
  if (!state.moves.length) {
    resetAnalysisState(true);
    setEngineStatus('No moves to analyze yet.', 'warn');
    return;
  }

  if (!isMatchFinished()) {
    setEngineStatus('Finish the match first to unlock analysis.', 'warn');
    renderAnalysis();
    return;
  }

  const ready = await initAnalysisWorker();
  if (!ready) {
    setEngineStatus('Analysis engine unavailable.', 'error');
    return;
  }

  const token = state.analysis.token + 1;
  state.analysis.token = token;
  state.analysis.running = true;
  state.analysis.entries = [];
  state.analysis.summary = null;
  state.liveEval.loading = false;
  renderAnalysis();
  renderLiveEvaluationBar();

  const replay = createPositionFromFen(INITIAL_FEN);
  const entries = [];

  try {
    for (let i = 0; i < state.moves.length; i += 1) {
      if (token !== state.analysis.token) return;

      const moveRecord = state.moves[i];
      const mover = replay.turn;
      const beforeFen = makeFen(replay.toSetup());

      const parsed = parseUci(moveRecord.uci);
      if (!parsed || !('from' in parsed)) break;

      const normalized = normalizeMove(replay, parsed);
      if (!replay.isLegal(normalized)) break;

      setEngineStatus('Analyzing move ' + (i + 1) + '/' + state.moves.length + '...', 'warn');

      const best = await requestPositionAnalysis(beforeFen, state.analysis.depth);
      if (token !== state.analysis.token) return;

      let bestSan = '--';
      const bestUci = best.bestmove && best.bestmove !== '(none)' ? best.bestmove : null;

      if (bestUci) {
        const probe = createPositionFromFen(beforeFen);
        const parsedBest = parseUci(bestUci);
        if (parsedBest && 'from' in parsedBest) {
          const normalizedBest = normalizeMove(probe, parsedBest);
          if (probe.isLegal(normalizedBest)) {
            bestSan = makeSan(probe, normalizedBest);
          }
        }
      }

      const bestMoverCp = scoreToCentipawns(best.score);

      replay.play(normalized);
      const afterFen = makeFen(replay.toSetup());
      const after = await requestPositionAnalysis(afterFen, state.analysis.depth);
      if (token !== state.analysis.token) return;

      const playedMoverCp = -scoreToCentipawns(after.score);
      const cpl = Math.max(0, Math.round(bestMoverCp - playedMoverCp));

      const whiteScore = orientScore(after.score, replay.turn, 'white');

      const entry = {
        ply: i + 1,
        color: mover,
        san: moveRecord.san,
        uci: moveRecord.uci,
        bestMoveUci: bestUci,
        bestMoveSan: bestSan,
        cpl,
        grade: classifyMove(cpl, moveRecord.uci, bestUci),
        evalWhite: formatEval(whiteScore),
      };

      entries.push(entry);
      state.analysis.entries = entries.slice();
      state.analysis.summary = summarizeAnalysis(entries);
      renderAnalysis();
    }

    if (token !== state.analysis.token) return;

    state.analysis.entries = entries;
    state.analysis.summary = summarizeAnalysis(entries);
    state.analysis.running = false;
    renderAnalysis();
    queueLiveEvaluation(220);
    setEngineStatus('Analysis complete (' + entries.length + ' moves).', 'ok');
  } catch (error) {
    if (token !== state.analysis.token) return;

    state.analysis.running = false;
    renderAnalysis();
    queueLiveEvaluation(220);
    setEngineStatus('Analysis failed: ' + error.message, 'error');
  }
}

function queueAutoAnalysis() {
  if (state.analysisTimer) clearTimeout(state.analysisTimer);

  if (!state.moves.length) {
    resetAnalysisState(true);
    return;
  }

  if (!isMatchFinished()) {
    renderAnalysis();
    return;
  }

  state.analysisTimer = setTimeout(() => {
    analyzeAllMoves().catch(error => {
      setEngineStatus('Analysis failed: ' + error.message, 'error');
    });
  }, 350);
}

function playOutcomeSound(info, capture) {
  if (info.code === 'checkmate') playSound('checkmate');
  else if (info.code === 'stalemate' || info.code === 'draw') playSound('draw');
  else if (info.code === 'check') playSound('check');
  else if (capture) playSound('capture');
  else playSound('move');
}

function adjustEngineEloFromResult(result) {
  const calibrating = state.engine.calibrationGames < state.engine.calibrationTarget;

  let delta = 0;
  if (calibrating) {
    if (result === 'win') delta = 120;
    else if (result === 'draw') delta = 45;
    else delta = -90;
    state.engine.calibrationGames += 1;
  } else {
    if (result === 'win') delta = 45;
    else if (result === 'draw') delta = 15;
    else delta = -35;
  }

  state.engine.elo = clamp(state.engine.elo + delta, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
  renderEngineControls();
  saveEnginePreferences();
  configurePlayStrength();

  if (calibrating) {
    setEngineStatus(
      'Calibration ' + state.engine.calibrationGames + '/' + state.engine.calibrationTarget +
      ': ' + result + '. ELO ' + state.engine.elo + '.',
      'ok',
    );
  } else {
    setEngineStatus('Result ' + result + '. Adjusted ELO to ' + state.engine.elo + '.', 'ok');
  }
}

function handleComputerGameResult(info) {
  const finished = info.code === 'checkmate' || info.code === 'stalemate' || info.code === 'draw';
  if (!finished) {
    state.engine.resultHandled = false;
    return;
  }

  if (!state.engine.enabled || state.engine.resultHandled) return;
  state.engine.resultHandled = true;

  const human = engineHumanColor();
  let result = 'draw';

  if (info.result === 'draw') {
    result = 'draw';
  } else if (info.result === human) {
    result = 'win';
  } else {
    result = 'loss';
  }

  adjustEngineEloFromResult(result);
}

function snapshot() {
  return {
    fen: currentFen(),
    moves: JSON.parse(JSON.stringify(state.moves)),
    capturedByWhite: [...state.capturedByWhite],
    capturedByBlack: [...state.capturedByBlack],
    lastMoveUci: state.lastMoveUci,
    orientation: state.orientation,
  };
}

function restoreSnapshot(data) {
  state.position = createPositionFromFen(data.fen);
  state.moves = data.moves || [];
  state.capturedByWhite = data.capturedByWhite || [];
  state.capturedByBlack = data.capturedByBlack || [];
  state.lastMoveUci = data.lastMoveUci || null;
  state.orientation = data.orientation || state.orientation;
  state.engine.resultHandled = false;
  refreshUi();
}

function applyLegalMove(move, source = 'human') {
  state.history.push(snapshot());

  const capture = detectCapture(state.position, move);
  const sanText = makeSan(state.position, move);
  const uci = makeUci(move);

  if (capture) {
    const token = pieceToToken(capture);
    if (state.position.turn === 'white') state.capturedByWhite.push(token);
    else state.capturedByBlack.push(token);
  }

  state.position.play(move);
  state.lastMoveUci = uci;
  state.moves.push({
    ply: state.moves.length + 1,
    uci,
    san: sanText,
    fen: currentFen(),
  });

  resetAnalysisState(false);
  refreshUi();

  const info = gameStatus();
  playOutcomeSound(info, Boolean(capture));

  queueCloudSave();
  handleComputerGameResult(info);
  queueAutoAnalysis();

  if (source !== 'engine') {
    maybeRequestComputerMove().catch(error => {
      setEngineStatus('Engine move failed: ' + error.message, 'error');
    });
  }
}

function clearGameLog() {
  cancelEngineSearch('Clearing game log');
  resetAnalysisState(false);

  state.moves = [];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  state.history = [];
  state.lastMoveUci = null;
  state.engine.resultHandled = false;
  refreshUi();

  queueCloudSave();
}

function newGame(options = {}) {
  const skipComputerMove = Boolean(options.skipComputerMove);

  cancelEngineSearch('Starting new game');
  resetAnalysisState(false);

  state.position = createPositionFromFen(INITIAL_FEN);
  state.moves = [];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  state.history = [];
  state.lastMoveUci = null;
  state.engine.resultHandled = false;

  refreshUi();
  queueCloudSave();

  if (skipComputerMove) return;

  maybeRequestComputerMove().catch(error => {
    setEngineStatus('Engine move failed: ' + error.message, 'error');
  });
}

function undoMove() {
  cancelEngineSearch('Undo move');
  resetAnalysisState(false);

  const prev = state.history.pop();
  if (!prev) return;

  restoreSnapshot(prev);
  queueCloudSave();
  queueAutoAnalysis();

  maybeRequestComputerMove().catch(error => {
    setEngineStatus('Engine move failed: ' + error.message, 'error');
  });
}

async function onGroundMove(orig, dest) {
  selfHealLocks();
  if (state.syncingRemote || state.cleaningArena) return;

  if (state.engine.enabled && state.position.turn === state.engine.side) {
    refreshBoard();
    return;
  }

  const parsed = parseUci(orig + dest);
  if (!parsed || !('from' in parsed)) {
    refreshBoard();
    return;
  }

  const movingPiece = state.position.board.get(parsed.from);
  let move = normalizeMove(state.position, parsed);

  if (isPromotionNeeded(move, movingPiece) && !move.promotion) {
    let selectedRole = null;
    state.awaitingPromotion = true;
    state.awaitingPromotionSince = Date.now();
    refreshBoard();
    try {
      selectedRole = await choosePromotion(movingPiece.color);
    } finally {
      state.awaitingPromotion = false;
      state.awaitingPromotionSince = 0;
      refreshBoard();
    }

    if (!selectedRole) return;
    move = { ...move, promotion: selectedRole };
  }

  if (!state.position.isLegal(move)) {
    refreshBoard();
    return;
  }

  applyLegalMove(move, 'human');
}

async function playEngineMoveFromUci(uci) {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) {
    throw new Error('Engine returned invalid move: ' + uci);
  }

  let move = normalizeMove(state.position, parsed);
  const movingPiece = state.position.board.get(move.from);

  if (isPromotionNeeded(move, movingPiece) && !move.promotion) {
    move = { ...move, promotion: 'queen' };
  }

  if (!state.position.isLegal(move)) {
    throw new Error('Engine move is illegal in current position: ' + uci);
  }

  applyLegalMove(move, 'engine');
}

async function maybeRequestComputerMove() {
  if (!state.engine.enabled) return;
  if (state.awaitingPromotion || state.syncingRemote || state.cleaningArena) return;

  const info = gameStatus();
  const isActive = info.code === 'ongoing' || info.code === 'check';
  if (!isActive) return;

  if (state.position.turn !== state.engine.side) return;
  if (state.engine.busy) return;

  state.engine.busy = true;
  refreshBoard();
  setEngineStatus('Stockfish thinking (' + state.engine.elo + ' ELO)...', 'warn');

  try {
    const bestmove = await requestEngineBestMove(currentFen());

    if (!bestmove || bestmove === '(none)') {
      throw new Error('No legal move returned.');
    }

    await playEngineMoveFromUci(bestmove);
    setEngineStatus('Stockfish played ' + bestmove + '.', 'ok');
  } finally {
    state.engine.busy = false;
    refreshBoard();
  }
}

function gamePayload(title = 'Cloud Chess Game') {
  const info = gameStatus();
  return {
    title,
    owner_profile_id: state.player.playerId,
    owner_token: state.player.playerToken,
    fen: currentFen(),
    turn: state.position.turn,
    status: mapStatusCode(info.code),
    result: info.result,
    last_move_uci: state.lastMoveUci,
    moves: state.moves,
    captured_white: state.capturedByWhite,
    captured_black: state.capturedByBlack,
    session_id: state.sessionId,
  };
}

async function saveUserSettings() {
  if (!state.supabase || !state.player) return;

  const basePayload = {
    profile_id: state.player.playerId,
    owner_token: state.player.playerToken,
    piece_style: state.pieceStyle,
    board_style: state.boardStyle,
    sound_enabled: state.soundEnabled,
    auto_sync_enabled: state.autoSyncEnabled,
  };

  if (state.supportsExtendedSettings) {
    const fullPayload = {
      ...basePayload,
      theme_mode: state.themeMode,
      auto_flip_human: state.autoFlipHuman,
    };

    const { error } = await state.supabase
      .from('user_settings')
      .upsert(fullPayload, { onConflict: 'profile_id' });

    if (!error) return;

    const message = (error.message || '').toLowerCase();
    if (!message.includes('theme_mode') && !message.includes('auto_flip_human')) {
      setCloudStatus(`Settings save failed: ${error.message}`, 'error');
      return;
    }

    state.supportsExtendedSettings = false;
  }

  const { error: baseError } = await state.supabase
    .from('user_settings')
    .upsert(basePayload, { onConflict: 'profile_id' });

  if (baseError) {
    setCloudStatus(`Settings save failed: ${baseError.message}`, 'error');
  }
}
function queueSettingsSave() {
  if (state.settingsTimer) clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => {
    saveUserSettings().catch(error => {
      setCloudStatus(`Settings save failed: ${error.message}`, 'error');
    });
  }, 250);
}

async function fetchRecentGames() {
  if (!recentGamesEl) return;
  if (!state.supabase || !state.player) return;

  const { data, error } = await state.supabase
    .from('chess_games')
    .select('id,title,updated_at,status,result')
    .eq('owner_profile_id', state.player.playerId)
    .order('updated_at', { ascending: false })
    .limit(8);

  if (error) {
    setCloudStatus(`Could not list recent games: ${error.message}`, 'error');
    return;
  }

  recentGamesEl.innerHTML = '';

  if (!data.length) {
    recentGamesEl.textContent = 'No cloud games yet.';
    return;
  }

  for (const game of data) {
    const item = document.createElement('div');
    item.className = 'recent-item';

    const title = document.createElement('div');
    title.className = 'recent-item-title';
    title.textContent = game.title || game.id;

    const meta = document.createElement('div');
    meta.className = 'recent-item-meta';
    const updated = new Date(game.updated_at).toLocaleString();
    meta.innerHTML = `<span>${game.status}</span><span>${updated}</span>`;

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.type = 'button';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => {
      if (cloudGameIdEl) cloudGameIdEl.value = game.id;
      loadCloudGameById(game.id).catch(error => {
        setCloudStatus('Load failed: ' + error.message, 'error');
      });
    });

    item.append(title, meta, loadBtn);
    recentGamesEl.appendChild(item);
  }
}
async function removeSubscription() {
  if (state.channel && state.supabase) {
    await state.supabase.removeChannel(state.channel);
    state.channel = null;
  }
}

async function subscribeToGame(gameId) {
  if (!state.supabase || !state.player) return;

  await removeSubscription();

  state.channel = state.supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chess_games',
        filter: `id=eq.${gameId}`,
      },
      payload => {
        const row = payload.new;
        if (!row || row.session_id === state.sessionId) return;
        applyCloudRow(row, true);
      },
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setSyncPill('Cloud live', 'connected');
    });
}

function applyCloudRow(row, fromRemote = false) {
  state.syncingRemote = true;
  state.syncingSince = Date.now();
  cancelEngineSearch('Applying cloud update');
  resetAnalysisState(false);

  try {
    state.position = createPositionFromFen(row.fen);
    state.moves = Array.isArray(row.moves) ? row.moves : [];
    state.capturedByWhite = Array.isArray(row.captured_white) ? row.captured_white : [];
    state.capturedByBlack = Array.isArray(row.captured_black) ? row.captured_black : [];
    state.lastMoveUci = row.last_move_uci || null;
    state.history = [];
    state.engine.resultHandled = false;
    refreshUi();

    if (fromRemote) {
      setCloudStatus(`Synced remote update (${new Date().toLocaleTimeString()}).`, 'ok');
      playSound('move');
    }

    queueAutoAnalysis();
  } catch (error) {
    setCloudStatus(`Could not parse cloud row: ${error.message}`, 'error');
  } finally {
    state.syncingRemote = false;
    state.syncingSince = 0;
  }

  maybeRequestComputerMove().catch(error => {
    setEngineStatus('Engine move failed: ' + error.message, 'error');
  });
}

async function createCloudGame() {
  if (!state.supabase || !state.player) return;

  const payload = gamePayload(`Cloud Chess ${new Date().toLocaleString()}`);
  const { data, error } = await state.supabase
    .from('chess_games')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    setCloudStatus(`Create failed: ${error.message}`, 'error');
    return;
  }

  state.gameId = data.id;
  if (cloudGameIdEl) cloudGameIdEl.value = data.id;

  try {
    localStorage.setItem(activeGameStorageKey(), data.id);
  } catch {
    // no-op
  }

  setCloudStatus(`Created cloud game ${data.id}.`, 'ok');
  setSyncPill('Cloud live', 'connected');

  await subscribeToGame(data.id);
  await fetchRecentGames();
}

async function saveCloudGame(createIfMissing = true) {
  if (!state.supabase || !state.player) return;

  if (!state.gameId) {
    if (!createIfMissing) return;
    await createCloudGame();
    if (!state.gameId) return;
  }

  const payload = gamePayload();
  const { error } = await state.supabase
    .from('chess_games')
    .update(payload)
    .eq('id', state.gameId)
    .eq('owner_profile_id', state.player.playerId);

  if (error) {
    setCloudStatus(`Save failed: ${error.message}`, 'error');
    setSyncPill('Cloud error', 'error');
    return;
  }

  try {
    localStorage.setItem(activeGameStorageKey(), state.gameId);
  } catch {
    // no-op
  }

  persistLocalBoardSnapshot();
  setCloudStatus(`Saved to cloud (${new Date().toLocaleTimeString()}).`, 'ok');
  setSyncPill('Cloud live', 'connected');
  await fetchRecentGames();
}

function queueCloudSave() {
  if (!state.autoSyncEnabled || !state.supabase || !state.player || !state.gameId || state.syncingRemote) {
    return;
  }

  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveCloudGame(false).catch(error => {
      setCloudStatus(`Auto-save failed: ${error.message}`, 'error');
    });
  }, 300);
}

async function loadCloudGameById(id, options = {}) {
  if (!state.supabase || !state.player) return;

  const gameId = (id || '').trim();
  if (!gameId) {
    setCloudStatus('Enter a cloud game ID to load.', 'error');
    return;
  }

  const { silentStatus = false } = options;

  const { data, error } = await state.supabase
    .from('chess_games')
    .select('*')
    .eq('id', gameId)
    .eq('owner_profile_id', state.player.playerId)
    .single();

  if (error) {
    state.gameId = null;
    if (cloudGameIdEl) cloudGameIdEl.value = '';
    try {
      localStorage.removeItem(activeGameStorageKey());
    } catch {
      // no-op
    }

    setCloudStatus(`Load failed: ${error.message}`, 'error');
    return;
  }

  state.gameId = gameId;
  if (cloudGameIdEl) cloudGameIdEl.value = gameId;

  try {
    localStorage.setItem(activeGameStorageKey(), gameId);
  } catch {
    // no-op
  }

  applyCloudRow(data, false);
  await subscribeToGame(gameId);
  await fetchRecentGames();

  if (!silentStatus) {
    setCloudStatus(`Loaded cloud game ${gameId}.`, 'ok');
  }
}

async function loadCloudGame() {
  if (!state.supabase || !state.player) return;

  const id = cloudGameIdEl ? cloudGameIdEl.value.trim() : (state.gameId || '').trim();
  await loadCloudGameById(id);
}

async function copyCurrentGameId() {
  if (!state.gameId) {
    setCloudStatus('No cloud game ID to copy.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(state.gameId);
    setCloudStatus('Cloud game ID copied to clipboard.', 'ok');
  } catch {
    setCloudStatus('Could not copy game ID in this browser context.', 'error');
  }
}
async function loadProfileAndSettings() {
  const { data: profileRow, error: profileError } = await state.supabase
    .from('profiles')
    .select('id,username,display_name')
    .eq('id', state.player.playerId)
    .single();

  if (profileError || !profileRow) {
    throw new Error('Profile could not be loaded. Please login again.');
  }

  state.player.username = profileRow.username;
  state.player.displayName = profileRow.display_name;
  if (accountUsernameEl) accountUsernameEl.textContent = profileRow.display_name || profileRow.username;
  if (accountEmailEl) accountEmailEl.textContent = `@${profileRow.username}`;

  let settingsRow = null;

  const { data: fullSettings, error: fullError } = await state.supabase
    .from('user_settings')
    .select('piece_style,board_style,sound_enabled,auto_sync_enabled,theme_mode,auto_flip_human')
    .eq('profile_id', state.player.playerId)
    .maybeSingle();

  if (!fullError) {
    settingsRow = fullSettings;
  } else {
    const message = (fullError.message || '').toLowerCase();
    if (!message.includes('theme_mode') && !message.includes('auto_flip_human')) {
      throw fullError;
    }

    state.supportsExtendedSettings = false;

    const { data: baseSettings, error: baseError } = await state.supabase
      .from('user_settings')
      .select('piece_style,board_style,sound_enabled,auto_sync_enabled')
      .eq('profile_id', state.player.playerId)
      .maybeSingle();

    if (baseError) throw baseError;
    settingsRow = baseSettings;
  }

  if (settingsRow) {
    state.pieceStyle = settingsRow.piece_style || state.pieceStyle;
    state.boardStyle = settingsRow.board_style || state.boardStyle;
    state.soundEnabled = settingsRow.sound_enabled ?? state.soundEnabled;
    state.autoSyncEnabled = settingsRow.auto_sync_enabled ?? state.autoSyncEnabled;

    if (typeof settingsRow.theme_mode === 'string') {
      state.themeMode = normalizeThemeMode(settingsRow.theme_mode);
    }

    if (typeof settingsRow.auto_flip_human === 'boolean') {
      state.autoFlipHuman = settingsRow.auto_flip_human;
    }
  }

  const localThemeMode = readStoredThemeMode();
  const localAutoFlipHuman = readStoredAutoFlipHuman();
  if (localThemeMode) state.themeMode = localThemeMode;
  if (localAutoFlipHuman != null) state.autoFlipHuman = localAutoFlipHuman;

  if (pieceStyleEl) pieceStyleEl.value = state.pieceStyle;
  if (boardStyleEl) boardStyleEl.value = state.boardStyle;
  if (soundEnabledEl) soundEnabledEl.checked = state.soundEnabled;
  if (autoSyncEnabledEl) autoSyncEnabledEl.checked = state.autoSyncEnabled;
  if (themeModeEl) themeModeEl.value = state.themeMode;
  if (autoFlipHumanEl) autoFlipHumanEl.checked = state.autoFlipHuman;

  persistLocalPreferences();
  applyTheme();
}
function wireUi() {
  const newGameBtn = document.getElementById('btn-new-game');
  if (newGameBtn) newGameBtn.addEventListener('click', newGame);

  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.addEventListener('click', undoMove);

  const clearHistoryBtn = document.getElementById('btn-clear-history');
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearGameLog);

  const createCloudBtn = document.getElementById('btn-create-cloud');
  if (createCloudBtn) createCloudBtn.addEventListener('click', createCloudGame);

  const saveCloudBtn = document.getElementById('btn-save-cloud');
  if (saveCloudBtn) saveCloudBtn.addEventListener('click', () => saveCloudGame(true));

  const loadCloudBtn = document.getElementById('btn-load-cloud');
  if (loadCloudBtn) loadCloudBtn.addEventListener('click', loadCloudGame);

  const copyCloudBtn = document.getElementById('btn-copy-id');
  if (copyCloudBtn) copyCloudBtn.addEventListener('click', copyCurrentGameId);

  if (analyzeAllBtnEl) {
    analyzeAllBtnEl.addEventListener('click', () => {
      analyzeAllMoves().catch(error => {
        setEngineStatus('Analysis failed: ' + error.message, 'error');
      });
    });
  }

  if (clearAnalysisBtnEl) {
    clearAnalysisBtnEl.addEventListener('click', () => {
      resetAnalysisState(true);
      setEngineStatus('Analysis cleared.', '');
    });
  }

  if (startStockfishBtnEl) {
    startStockfishBtnEl.addEventListener('click', () => {
      startStockfishMatch().catch(error => {
        setEngineStatus('Stockfish start failed: ' + error.message, 'error');
      });
    });
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await removeSubscription();
      signOutAndRedirect('./login.html?v=20260309h');
    });
  }

  if (pieceStyleEl) {
    pieceStyleEl.addEventListener('change', () => {
      state.pieceStyle = pieceStyleEl.value;
      applyTheme();
      refreshBoard();
      queueSettingsSave();
    });
  }

  if (boardStyleEl) {
    boardStyleEl.addEventListener('change', () => {
      state.boardStyle = boardStyleEl.value;
      applyTheme();
      queueSettingsSave();
    });
  }

  if (soundEnabledEl) {
    soundEnabledEl.addEventListener('change', () => {
      state.soundEnabled = soundEnabledEl.checked;
      queueSettingsSave();
    });
  }

  if (autoSyncEnabledEl) {
    autoSyncEnabledEl.addEventListener('change', () => {
      state.autoSyncEnabled = autoSyncEnabledEl.checked;
      queueSettingsSave();
    });
  }

  if (themeModeEl) {
    themeModeEl.addEventListener('change', () => {
      state.themeMode = normalizeThemeMode(themeModeEl.value);
      persistLocalPreferences();
      applyTheme();
      queueSettingsSave();
    });
  }

  if (autoFlipHumanEl) {
    autoFlipHumanEl.addEventListener('change', () => {
      state.autoFlipHuman = autoFlipHumanEl.checked;
      persistLocalPreferences();
      refreshUi();
      queueSettingsSave();
    });
  }

  if (engineEnabledEl) {
    engineEnabledEl.addEventListener('change', () => {
      state.engine.enabled = engineEnabledEl.checked;
      state.engine.resultHandled = false;
      renderEngineControls();
      saveEnginePreferences();

      if (!state.engine.enabled) {
        cancelEngineSearch('Computer mode disabled');
        setEngineStatus('Computer mode disabled.', '');
        refreshBoard();
        return;
      }

      setEngineStatus('Computer mode enabled. Press Start Stockfish Match.', 'ok');
      refreshBoard();
    });
  }

  if (enginePlayerColorEl) {
    enginePlayerColorEl.addEventListener('change', () => {
      const human = enginePlayerColorEl.value === 'black' ? 'black' : 'white';
      state.engine.side = human === 'white' ? 'black' : 'white';
      state.orientation = human;
      state.engine.resultHandled = false;
      saveEnginePreferences();
      refreshUi();
    });
  }

  if (engineEloEl) {
    engineEloEl.addEventListener('input', () => {
      state.engine.elo = clamp(Number(engineEloEl.value) || ENGINE_DEFAULT_ELO, ENGINE_MIN_ELO, ENGINE_MAX_ELO);
      renderEngineControls();
      saveEnginePreferences();
      configurePlayStrength();
    });

    engineEloEl.addEventListener('change', () => {
      setEngineStatus('Stockfish strength set to ELO ' + state.engine.elo + '.', 'ok');
    });
  }

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const refreshForSystemTheme = () => {
    if (state.themeMode === 'auto') applyTheme();
  };

  if (typeof themeMedia.addEventListener === 'function') {
    themeMedia.addEventListener('change', refreshForSystemTheme);
  } else if (typeof themeMedia.addListener === 'function') {
    themeMedia.addListener(refreshForSystemTheme);
  }
}
async function boot() {
  if (!hasPlayerSession()) {
    window.location.href = './login.html?v=20260309h&next=index';
    return;
  }

  if (!boardShell) {
    throw new Error('Board element missing.');
  }

  state.player = getPlayerSession();
  state.supabase = getSupabaseClient(state.player.playerToken);
  const bootThemeMode = readStoredThemeMode();
  const bootAutoFlipHuman = readStoredAutoFlipHuman();
  if (bootThemeMode) state.themeMode = bootThemeMode;
  if (bootAutoFlipHuman != null) state.autoFlipHuman = bootAutoFlipHuman;
  applyDocumentTheme();
  loadLocalActiveGameId();

  wireUi();

  try {
    await loadProfileAndSettings();
  } catch {
    signOutAndRedirect('./login.html?v=20260309h');
    return;
  }

  loadEnginePreferences();

  state.position = createPositionFromFen(INITIAL_FEN);

  if (state.engine.enabled) {
    state.orientation = engineHumanColor();
  } else if (state.autoFlipHuman) {
    state.orientation = state.position.turn;
  }

  state.ground = Chessground(boardShell, {
    orientation: state.orientation,
    fen: currentFen(),
    coordinates: true,
    movable: {
      color: state.position.turn,
      dests: chessgroundDests(state.position),
      events: {
        after: onGroundMove,
      },
    },
    animation: {
      enabled: true,
      duration: 220,
    },
    highlight: {
      lastMove: true,
      check: true,
    },
    draggable: {
      enabled: true,
      showGhost: true,
    },
  });

  applyTheme();
  refreshUi();

  setCloudStatus('Connected. Data sync is scoped to your player token.', 'ok');
  setSyncPill('Cloud live', 'connected');

  await fetchRecentGames();

  if (state.gameId) {
    await loadCloudGameById(state.gameId, { silentStatus: true }).catch(() => {});
  }

  if (state.engine.enabled) {
    setEngineStatus('Computer mode enabled. Press Start Stockfish Match.', 'ok');
  } else {
    setEngineStatus('Engine idle.', '');
  }
}
window.addEventListener('beforeunload', () => {
  removeSubscription().catch(() => {});
  cancelEngineSearch('Window unload');
  cancelAnalysisRequest('Window unload');

  if (state.liveEval.timer) {
    clearTimeout(state.liveEval.timer);
    state.liveEval.timer = null;
  }

  if (state.engine.worker) {
    try {
      state.engine.worker.terminate();
    } catch {
      // no-op
    }
    state.engine.worker = null;
    state.engine.ready = false;
  }

  if (state.analysis.worker) {
    try {
      state.analysis.worker.terminate();
    } catch {
      // no-op
    }
    state.analysis.worker = null;
    state.analysis.ready = false;
  }
});

boot();





























































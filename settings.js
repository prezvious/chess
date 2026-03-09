import {
  getSupabaseClient,
  getPlayerSession,
  hasPlayerSession,
  signOutAndRedirect,
} from './supabase-client.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const THEME_MODE_KEY = 'cloud-chess-theme-mode-v1';
const AUTO_FLIP_HUMAN_KEY = 'cloud-chess-auto-flip-human-v1';
const ACTIVE_GAME_KEY_PREFIX = 'cloud-chess-active-game-v1:';
const SNAPSHOT_KEY_PREFIX = 'cloud-chess-board-snapshot-v1:';

const accountUsernameEl = document.getElementById('account-username');
const accountEmailEl = document.getElementById('account-email');
const cloudStatusEl = document.getElementById('cloud-status');
const pieceStyleEl = document.getElementById('piece-style');
const boardStyleEl = document.getElementById('board-style');
const themeModeEl = document.getElementById('theme-mode');
const soundEnabledEl = document.getElementById('sound-enabled');
const autoSyncEnabledEl = document.getElementById('auto-sync-enabled');
const autoFlipHumanEl = document.getElementById('auto-flip-human');
const cloudGameIdEl = document.getElementById('cloud-game-id');
const recentGamesEl = document.getElementById('recent-games');

const state = {
  supabase: null,
  player: null,
  pieceStyle: '2d',
  boardStyle: 'brown',
  soundEnabled: true,
  autoSyncEnabled: true,
  themeMode: 'auto',
  autoFlipHuman: false,
  gameId: null,
  snapshot: null,
  settingsTimer: null,
  supportsExtendedSettings: true,
};

function activeGameKey() {
  const playerId = state.player?.playerId || 'anonymous';
  return ACTIVE_GAME_KEY_PREFIX + playerId;
}

function snapshotKey() {
  const playerId = state.player?.playerId || 'anonymous';
  return SNAPSHOT_KEY_PREFIX + playerId;
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

function resolveTheme(mode) {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyDocumentTheme() {
  const resolved = resolveTheme(state.themeMode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = state.themeMode;
}

function setCloudStatus(message, kind = '') {
  cloudStatusEl.textContent = message;
  cloudStatusEl.className = 'cloud-status';
  if (kind) cloudStatusEl.classList.add(kind);
}

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLocalTheme() {
  try {
    const raw = localStorage.getItem(THEME_MODE_KEY);
    if (!raw) return null;
    return normalizeThemeMode(raw);
  } catch {
    return null;
  }
}

function saveLocalTheme() {
  localStorage.setItem(THEME_MODE_KEY, state.themeMode);
}

function readLocalAutoFlipHuman() {
  try {
    const raw = localStorage.getItem(AUTO_FLIP_HUMAN_KEY);
    if (raw == null) return null;
    return raw === '1';
  } catch {
    return null;
  }
}

function saveLocalAutoFlipHuman() {
  localStorage.setItem(AUTO_FLIP_HUMAN_KEY, state.autoFlipHuman ? '1' : '0');
}

function loadLocalGameLink() {
  const id = (localStorage.getItem(activeGameKey()) || '').trim();
  state.gameId = id || null;

  const snap = safeParseJson(localStorage.getItem(snapshotKey()));
  if (snap && typeof snap === 'object') {
    state.snapshot = snap;
  }
}

function saveLocalGameLink() {
  if (state.gameId) {
    localStorage.setItem(activeGameKey(), state.gameId);
  } else {
    localStorage.removeItem(activeGameKey());
  }

  if (state.snapshot) {
    localStorage.setItem(snapshotKey(), JSON.stringify(state.snapshot));
  }
}

function snapshotForSave() {
  if (state.snapshot && typeof state.snapshot === 'object') return state.snapshot;

  const stored = safeParseJson(localStorage.getItem(snapshotKey()));
  if (stored && typeof stored === 'object') return stored;

  return {
    fen: START_FEN,
    turn: 'white',
    status: 'ongoing',
    result: null,
    lastMoveUci: null,
    moves: [],
    capturedByWhite: [],
    capturedByBlack: [],
  };
}

function gamePayloadFromSnapshot(title = 'Cloud Chess Game') {
  const snap = snapshotForSave();
  return {
    title,
    owner_profile_id: state.player.playerId,
    owner_token: state.player.playerToken,
    fen: snap.fen || START_FEN,
    turn: snap.turn === 'black' ? 'black' : 'white',
    status: snap.status || 'ongoing',
    result: snap.result ?? null,
    last_move_uci: snap.lastMoveUci || null,
    moves: Array.isArray(snap.moves) ? snap.moves : [],
    captured_white: Array.isArray(snap.capturedByWhite) ? snap.capturedByWhite : [],
    captured_black: Array.isArray(snap.capturedByBlack) ? snap.capturedByBlack : [],
    session_id: snap.sessionId || '',
  };
}

async function fetchSettingsRow() {
  const fullQuery = state.supabase
    .from('user_settings')
    .select('piece_style,board_style,sound_enabled,auto_sync_enabled,theme_mode,auto_flip_human')
    .eq('profile_id', state.player.playerId)
    .maybeSingle();

  const { data: fullData, error: fullError } = await fullQuery;
  if (!fullError) return fullData;

  const message = (fullError.message || '').toLowerCase();
  if (!message.includes('theme_mode') && !message.includes('auto_flip_human')) {
    throw fullError;
  }

  state.supportsExtendedSettings = false;

  const { data: baseData, error: baseError } = await state.supabase
    .from('user_settings')
    .select('piece_style,board_style,sound_enabled,auto_sync_enabled')
    .eq('profile_id', state.player.playerId)
    .maybeSingle();

  if (baseError) throw baseError;
  return baseData;
}

async function saveUserSettings() {
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
      throw error;
    }

    state.supportsExtendedSettings = false;
  }

  const { error: baseError } = await state.supabase
    .from('user_settings')
    .upsert(basePayload, { onConflict: 'profile_id' });

  if (baseError) throw baseError;
}

function queueSettingsSave() {
  if (state.settingsTimer) clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => {
    saveUserSettings().catch(error => {
      setCloudStatus('Settings save failed: ' + error.message, 'error');
    });
  }, 250);
}

function syncControls() {
  pieceStyleEl.value = state.pieceStyle;
  boardStyleEl.value = state.boardStyle;
  themeModeEl.value = state.themeMode;
  soundEnabledEl.checked = state.soundEnabled;
  autoSyncEnabledEl.checked = state.autoSyncEnabled;
  autoFlipHumanEl.checked = state.autoFlipHuman;
  cloudGameIdEl.value = state.gameId || '';
}

async function fetchRecentGames() {
  const { data, error } = await state.supabase
    .from('chess_games')
    .select('id,title,updated_at,status,result,fen,turn,last_move_uci,moves,captured_white,captured_black,session_id')
    .eq('owner_profile_id', state.player.playerId)
    .order('updated_at', { ascending: false })
    .limit(8);

  if (error) {
    setCloudStatus('Could not list recent games: ' + error.message, 'error');
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
      cloudGameIdEl.value = game.id;
      loadCloudGame().catch(error => {
        setCloudStatus('Load failed: ' + error.message, 'error');
      });
    });

    item.append(title, meta, loadBtn);
    recentGamesEl.appendChild(item);
  }
}

async function createCloudGame() {
  const payload = gamePayloadFromSnapshot('Cloud Chess ' + new Date().toLocaleString());
  const { data, error } = await state.supabase
    .from('chess_games')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    setCloudStatus('Create failed: ' + error.message, 'error');
    return;
  }

  state.gameId = data.id;
  cloudGameIdEl.value = data.id;
  saveLocalGameLink();
  setCloudStatus('Created cloud game ' + data.id + '.', 'ok');
  await fetchRecentGames();
}

async function saveCloudGame(createIfMissing = true) {
  if (!state.gameId) {
    if (!createIfMissing) return;
    await createCloudGame();
    if (!state.gameId) return;
  }

  const payload = gamePayloadFromSnapshot();
  const { error } = await state.supabase
    .from('chess_games')
    .update(payload)
    .eq('id', state.gameId)
    .eq('owner_profile_id', state.player.playerId);

  if (error) {
    setCloudStatus('Save failed: ' + error.message, 'error');
    return;
  }

  saveLocalGameLink();
  setCloudStatus('Saved snapshot to cloud (' + new Date().toLocaleTimeString() + ').', 'ok');
  await fetchRecentGames();
}

async function loadCloudGame() {
  const id = cloudGameIdEl.value.trim();
  if (!id) {
    setCloudStatus('Enter a cloud game ID to load.', 'error');
    return;
  }

  const { data, error } = await state.supabase
    .from('chess_games')
    .select('*')
    .eq('id', id)
    .eq('owner_profile_id', state.player.playerId)
    .single();

  if (error) {
    setCloudStatus('Load failed: ' + error.message, 'error');
    return;
  }

  state.gameId = id;
  state.snapshot = {
    fen: data.fen,
    turn: data.turn,
    status: data.status,
    result: data.result,
    lastMoveUci: data.last_move_uci,
    moves: Array.isArray(data.moves) ? data.moves : [],
    capturedByWhite: Array.isArray(data.captured_white) ? data.captured_white : [],
    capturedByBlack: Array.isArray(data.captured_black) ? data.captured_black : [],
    sessionId: data.session_id || '',
  };

  saveLocalGameLink();
  setCloudStatus('Loaded cloud game ' + id + '. Return to board to continue.', 'ok');
  await fetchRecentGames();
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

function wireUi() {
  document.getElementById('btn-logout').addEventListener('click', () => {
    signOutAndRedirect('./login.html?v=20260309h');
  });

  pieceStyleEl.addEventListener('change', () => {
    state.pieceStyle = pieceStyleEl.value;
    queueSettingsSave();
  });

  boardStyleEl.addEventListener('change', () => {
    state.boardStyle = boardStyleEl.value;
    queueSettingsSave();
  });

  soundEnabledEl.addEventListener('change', () => {
    state.soundEnabled = soundEnabledEl.checked;
    queueSettingsSave();
  });

  autoSyncEnabledEl.addEventListener('change', () => {
    state.autoSyncEnabled = autoSyncEnabledEl.checked;
    queueSettingsSave();
  });

  themeModeEl.addEventListener('change', () => {
    state.themeMode = normalizeThemeMode(themeModeEl.value);
    saveLocalTheme();
    applyDocumentTheme();
    queueSettingsSave();
  });

  autoFlipHumanEl.addEventListener('change', () => {
    state.autoFlipHuman = autoFlipHumanEl.checked;
    saveLocalAutoFlipHuman();
    queueSettingsSave();
  });

  document.getElementById('btn-create-cloud').addEventListener('click', () => {
    createCloudGame().catch(error => {
      setCloudStatus('Create failed: ' + error.message, 'error');
    });
  });

  document.getElementById('btn-save-cloud').addEventListener('click', () => {
    saveCloudGame(true).catch(error => {
      setCloudStatus('Save failed: ' + error.message, 'error');
    });
  });

  document.getElementById('btn-load-cloud').addEventListener('click', () => {
    loadCloudGame().catch(error => {
      setCloudStatus('Load failed: ' + error.message, 'error');
    });
  });

  document.getElementById('btn-copy-id').addEventListener('click', () => {
    copyCurrentGameId().catch(error => {
      setCloudStatus('Copy failed: ' + error.message, 'error');
    });
  });

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const refreshForSystemTheme = () => {
    if (state.themeMode === 'auto') applyDocumentTheme();
  };

  if (typeof themeMedia.addEventListener === 'function') {
    themeMedia.addEventListener('change', refreshForSystemTheme);
  } else if (typeof themeMedia.addListener === 'function') {
    themeMedia.addListener(refreshForSystemTheme);
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
  accountUsernameEl.textContent = profileRow.display_name || profileRow.username;
  accountEmailEl.textContent = '@' + profileRow.username;

  const settingsRow = await fetchSettingsRow();

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

  const localTheme = readLocalTheme();
  const localAutoFlip = readLocalAutoFlipHuman();
  if (localTheme) state.themeMode = localTheme;
  if (localAutoFlip != null) state.autoFlipHuman = localAutoFlip;

  loadLocalGameLink();
  syncControls();
  saveLocalTheme();
  saveLocalAutoFlipHuman();
  applyDocumentTheme();
}

async function boot() {
  if (!hasPlayerSession()) {
    window.location.href = './login.html?v=20260309h&next=settings';
    return;
  }

  state.player = getPlayerSession();
  state.supabase = getSupabaseClient(state.player.playerToken);

  wireUi();

  try {
    await loadProfileAndSettings();
  } catch {
    signOutAndRedirect('./login.html?v=20260309h');
    return;
  }

  setCloudStatus('Connected. Settings and cloud controls are ready.', 'ok');
  await fetchRecentGames();
}

boot();


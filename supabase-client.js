import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://zunmeiakbtqlhssjkelt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gMSA_K2m2ziNS6cWE4KVhw_4I6ojA7o';

const PLAYER_KEYS = {
  id: 'chess-player-id',
  username: 'chess-player-username',
  displayName: 'chess-player-display-name',
  token: 'chess-player-token',
};

let supabaseInstance = null;
let currentToken = '';

function normalize(value) {
  return (value || '').trim();
}

export function readSupabaseConfig() {
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  };
}

export function getPlayerSession() {
  const playerId = normalize(localStorage.getItem(PLAYER_KEYS.id));
  const username = normalize(localStorage.getItem(PLAYER_KEYS.username));
  const displayName = normalize(localStorage.getItem(PLAYER_KEYS.displayName));
  const playerToken = normalize(localStorage.getItem(PLAYER_KEYS.token));

  if (!playerId || !playerToken) return null;

  return {
    playerId,
    username,
    displayName,
    playerToken,
  };
}

export function hasPlayerSession() {
  return Boolean(getPlayerSession());
}

export function savePlayerSession(session) {
  localStorage.setItem(PLAYER_KEYS.id, normalize(session.playerId));
  localStorage.setItem(PLAYER_KEYS.username, normalize(session.username));
  localStorage.setItem(PLAYER_KEYS.displayName, normalize(session.displayName));
  localStorage.setItem(PLAYER_KEYS.token, normalize(session.playerToken));
  resetSupabaseClient();
}

export function clearPlayerSession() {
  localStorage.removeItem(PLAYER_KEYS.id);
  localStorage.removeItem(PLAYER_KEYS.username);
  localStorage.removeItem(PLAYER_KEYS.displayName);
  localStorage.removeItem(PLAYER_KEYS.token);
  resetSupabaseClient();
}

export function resetSupabaseClient() {
  supabaseInstance = null;
  currentToken = '';
}

export function getSupabaseClient(token = '') {
  const effectiveToken = normalize(token) || normalize(getPlayerSession()?.playerToken);

  if (supabaseInstance && currentToken === effectiveToken) return supabaseInstance;

  currentToken = effectiveToken;

  supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: effectiveToken
        ? {
            'x-player-token': effectiveToken,
          }
        : {},
    },
  });

  return supabaseInstance;
}

export function redirectToLogin(path = './login.html') {
  window.location.href = path;
}

export function signOutAndRedirect(path = './login.html') {
  clearPlayerSession();
  window.location.href = path;
}

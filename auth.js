import {
  getSupabaseClient,
  hasPlayerSession,
  savePlayerSession,
  readSupabaseConfig,
} from './supabase-client.js';

const form = document.getElementById('auth-form');
const mode = form?.dataset.mode || 'login';

const usernameEl = document.getElementById('username');
const displayNameEl = document.getElementById('display-name');
const passwordEl = document.getElementById('password');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('auth-message');
const apiUrlEl = document.getElementById('api-url');

const params = new URLSearchParams(window.location.search);

function authNextPath() {
  const next = params.get('next');
  if (next === 'settings') return './settings.html?v=20260310h';
  return './index.html?v=20260310h';
}

function setMessage(text, kind = '') {
  messageEl.textContent = text;
  messageEl.className = 'auth-message';
  if (kind) messageEl.classList.add(kind);
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

function saveSessionFromPayload(payload) {
  savePlayerSession({
    playerId: payload.player_id,
    username: payload.username,
    displayName: payload.display_name,
    playerToken: payload.player_token,
  });
}

async function handleSignup() {
  const supabase = getSupabaseClient();
  const username = usernameEl.value.trim().toLowerCase();
  const displayName = displayNameEl.value.trim();
  const passwordHash = await hashPassword(passwordEl.value);

  const { data, error } = await supabase.rpc('create_player', {
    p_username: username,
    p_display_name: displayName,
    p_password_hash: passwordHash,
  });

  if (error) throw error;
  if (!data?.player_id || !data?.player_token) {
    throw new Error('Could not create player profile.');
  }

  saveSessionFromPayload(data);
  setMessage('Signup successful. Redirecting...', 'ok');
  window.location.href = authNextPath();
}

async function handleLogin() {
  const supabase = getSupabaseClient();
  const username = usernameEl.value.trim().toLowerCase();
  const passwordHash = await hashPassword(passwordEl.value);

  const { data, error } = await supabase.rpc('login_player', {
    p_username: username,
    p_password_hash: passwordHash,
  });

  if (error) throw error;
  if (!data?.player_id || !data?.player_token) {
    throw new Error('Invalid username or password.');
  }

  saveSessionFromPayload(data);
  setMessage('Login successful. Redirecting...', 'ok');
  window.location.href = authNextPath();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage('');
  submitBtn.disabled = true;

  try {
    if (mode === 'signup') await handleSignup();
    else await handleLogin();
  } catch (error) {
    setMessage(error.message || String(error), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

if (hasPlayerSession()) {
  window.location.href = authNextPath();
}

const config = readSupabaseConfig();
if (apiUrlEl) {
  apiUrlEl.textContent = config.url;
}

const next = params.get('next');
if (next === 'index' || next === 'settings') {
  setMessage('Please login to continue.', '');
}

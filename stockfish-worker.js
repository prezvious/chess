const STOCKFISH_VERSION = '18.0.5';
const STOCKFISH_SOURCES = [
  {
    id: 'local',
    js: './stockfish/stockfish-18-lite-single.js',
    wasm: './stockfish/stockfish-18-lite-single.wasm',
  },
  {
    id: 'unpkg',
    js: `https://unpkg.com/stockfish@${STOCKFISH_VERSION}/bin/stockfish-18-lite-single.js`,
    wasm: `https://unpkg.com/stockfish@${STOCKFISH_VERSION}/bin/stockfish-18-lite-single.wasm`,
  },
  {
    id: 'jsdelivr',
    js: `https://cdn.jsdelivr.net/npm/stockfish@${STOCKFISH_VERSION}/bin/stockfish-18-lite-single.js`,
    wasm: `https://cdn.jsdelivr.net/npm/stockfish@${STOCKFISH_VERSION}/bin/stockfish-18-lite-single.wasm`,
  },
];

let activeWasmUrl = STOCKFISH_SOURCES[0].wasm;

function needsWasmRewrite(url) {
  const raw = String(url || '').toLowerCase();
  if (!raw || raw.includes('.wasm.map')) return false;
  if (raw.includes('stockfish-worker.wasm') || raw.includes('stockfish.wasm')) return true;
  return /\.wasm(?:$|[?#])/.test(raw);
}

const originalFetch = typeof self.fetch === 'function' ? self.fetch.bind(self) : null;
if (originalFetch) {
  self.fetch = (input, init) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input && typeof input.url === 'string'
        ? input.url
        : '';

    if (needsWasmRewrite(requestUrl)) {
      return originalFetch(activeWasmUrl, init);
    }

    return originalFetch(input, init);
  };
}

const OriginalXHR = typeof self.XMLHttpRequest === 'function' ? self.XMLHttpRequest : null;
const originalXhrOpen = OriginalXHR && OriginalXHR.prototype ? OriginalXHR.prototype.open : null;
if (originalXhrOpen) {
  OriginalXHR.prototype.open = function patchedOpen(method, url, ...rest) {
    const nextUrl = needsWasmRewrite(url) ? activeWasmUrl : url;
    return originalXhrOpen.call(this, method, nextUrl, ...rest);
  };
}

let loaded = false;
let lastError = null;

for (const source of STOCKFISH_SOURCES) {
  try {
    activeWasmUrl = source.wasm;
    importScripts(source.js);
    loaded = true;

    try {
      postMessage('info string stockfish-version ' + STOCKFISH_VERSION);
      postMessage('info string stockfish-source ' + source.id);
      postMessage('info string stockfish-js ' + source.js);
      postMessage('info string stockfish-wasm ' + source.wasm);
    } catch {
      // no-op
    }

    break;
  } catch (error) {
    lastError = error;
    try {
      postMessage(
        'info string stockfish-source-failed ' + source.id + ' ' + String((error && error.message) || error),
      );
    } catch {
      // no-op
    }
  }
}

if (!loaded) {
  throw new Error(
    'Unable to load Stockfish ' +
      STOCKFISH_VERSION +
      ' worker script from all configured sources. Last error: ' +
      String((lastError && lastError.message) || lastError || 'unknown'),
  );
}


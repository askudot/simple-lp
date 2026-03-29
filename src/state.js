import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// State files are at project root (parent of src/)
const STATE_DIR = path.join(__dirname, '..');

// ─── Generic state file helpers ─────────────────────────────
export function loadStateFile(filename) {
  const filePath = path.join(STATE_DIR, filename);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`   ⚠️  ${filename} corrupted, resetting: ${e.message}`);
    }
  }
  return null;
}

export function saveStateFile(filename, state) {
  const filePath = path.join(STATE_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// ─── Positions state ───────────────────────────────────────
export function loadPositionsState() {
  return loadStateFile('positions-state.json') || {};
}

export function savePositionsState(state) {
  saveStateFile('positions-state.json', state);
}

// ─── Conversation state ─────────────────────────────────────
export function loadConversationState() {
  const defaultState = {
    step: 'idle',
    selectedPool: null,
    scoredPools: [],
    poolDetail: null,
    binData: null,
    calcResults: null,
  };
  const saved = loadStateFile('conversation-state.json');
  return saved || defaultState;
}

export function saveConversationState(state) {
  saveStateFile('conversation-state.json', state);
}

const fs = require("fs/promises");
const path = require("path");

class MemoryTokenStore {
  constructor() {
    this.tokens = new Map();
  }

  async save(key, token) {
    this.tokens.set(key, token);
    return token;
  }

  async get(key) {
    return this.tokens.get(key) ?? null;
  }
}

class FileTokenStore {
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      path.resolve(process.cwd(), "data", "monday-state.json");
  }

  async save(key, token) {
    const state = await this.getState();
    state.tokens[key] = token;
    await this.#writeState(state);
    return token;
  }

  async get(key) {
    const state = await this.getState();
    return state.tokens[key] ?? null;
  }

  async saveState(partialState) {
    const state = await this.getState();
    const nextState = {
      ...state,
      ...partialState,
      tokens: {
        ...state.tokens,
        ...(partialState.tokens ?? {}),
      },
      board: {
        ...state.board,
        ...(partialState.board ?? {}),
      },
      account_id: partialState.account_id ?? state.account_id ?? null,
      updated_at: new Date().toISOString(),
    };

    await this.#writeState(nextState);
    return nextState;
  }

  async getState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        tokens: parsed.tokens ?? {},
        board: parsed.board ?? null,
        account_id: parsed.account_id ?? null,
        updated_at: parsed.updated_at ?? null,
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { tokens: {}, board: null, account_id: null, updated_at: null };
      }

      throw error;
    }
  }

  async #writeState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }
}

module.exports = {
  FileTokenStore,
  MemoryTokenStore,
};

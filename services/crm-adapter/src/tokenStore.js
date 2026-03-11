const fs = require("fs/promises");
const path = require("path");

class MemoryTokenStore {
  constructor() {
    this.tokens = new Map();
    this.state = {
      tokens: {},
      board: null,
      account_id: null,
      updated_at: null,
    };
  }

  async save(key, token) {
    this.tokens.set(key, token);
    this.state.tokens[key] = token;
    this.state.updated_at = new Date().toISOString();
    return token;
  }

  async get(key) {
    return this.tokens.get(key) ?? null;
  }

  async saveState(partialState) {
    const nextBoard =
      partialState.board === null
        ? null
        : partialState.board
          ? {
              ...(this.state.board ?? {}),
              ...partialState.board,
            }
          : this.state.board;

    this.state = {
      ...this.state,
      ...partialState,
      tokens: {
        ...this.state.tokens,
        ...(partialState.tokens ?? {}),
      },
      board: nextBoard,
      account_id: partialState.account_id ?? this.state.account_id ?? null,
      updated_at: new Date().toISOString(),
    };

    Object.entries(this.state.tokens).forEach(([key, value]) => {
      this.tokens.set(key, value);
    });

    return this.state;
  }

  async getState() {
    return {
      tokens: { ...this.state.tokens },
      board: this.state.board ? { ...this.state.board } : null,
      account_id: this.state.account_id,
      updated_at: this.state.updated_at,
    };
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
    const nextBoard =
      partialState.board === null
        ? null
        : partialState.board
          ? {
              ...(state.board ?? {}),
              ...partialState.board,
            }
          : state.board;
    const nextState = {
      ...state,
      ...partialState,
      tokens: {
        ...state.tokens,
        ...(partialState.tokens ?? {}),
      },
      board: nextBoard,
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

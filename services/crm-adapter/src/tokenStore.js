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

module.exports = {
  MemoryTokenStore,
};


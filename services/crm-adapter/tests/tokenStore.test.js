const fs = require("fs");
const os = require("os");
const path = require("path");

const { FileTokenStore } = require("../src/tokenStore");

describe("FileTokenStore", () => {
  it("persists tokens and board state to disk", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-state-${Date.now()}.json`);
    const store = new FileTokenStore({ filePath });

    await store.save("monday_access_token", "token-123");
    await store.saveState({
      board: {
        id: "board-1",
        name: "Leads",
      },
    });

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    expect(persisted.tokens.monday_access_token).toBe("token-123");
    expect(persisted.board).toEqual({
      id: "board-1",
      name: "Leads",
    });
    await expect(store.get("monday_access_token")).resolves.toBe("token-123");
  });
});

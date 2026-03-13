const fs = require("fs");
const path = require("path");

const { createApp } = require("./app");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

loadDotEnv(path.resolve(__dirname, "../.env"));

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  process.stdout.write(`crm-adapter listening on ${port}\n`);
});

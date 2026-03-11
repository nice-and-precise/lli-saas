const axios = require("axios");

function wait(ms, sleep = setTimeout) {
  return new Promise((resolve) => sleep(resolve, ms));
}

class MondayClient {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    tokenEndpoint = "https://auth.monday.com/oauth2/token",
    apiBaseUrl = "https://api.monday.com/v2",
    httpClient = axios,
    sleep = wait,
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.tokenEndpoint = tokenEndpoint;
    this.apiBaseUrl = apiBaseUrl;
    this.httpClient = httpClient;
    this.sleep = sleep;
  }

  getAuthorizationUrl(state = "lli-saas-state") {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
    });

    return `https://auth.monday.com/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code) {
    const response = await this.httpClient.post(this.tokenEndpoint, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });

    return response.data;
  }

  async executeGraphQL({ query, variables = {}, token }) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.httpClient.post(
          this.apiBaseUrl,
          { query, variables },
          {
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
            validateStatus: () => true,
          },
        );

        if (response.status === 429) {
          if (attempt === 3) {
            throw new Error("Monday API rate limit exceeded after 3 attempts");
          }

          const retryAfter = Number(response.headers["retry-after"] ?? attempt);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        if (response.status >= 400) {
          throw new Error(`Monday API request failed with status ${response.status}`);
        }

        return response.data;
      } catch (error) {
        const status = error.response?.status;

        if (status === 429 && attempt < 3) {
          const retryAfter = Number(error.response?.headers?.["retry-after"] ?? attempt);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Monday API rate limit exceeded after 3 attempts");
  }
}

module.exports = {
  MondayClient,
  wait,
};


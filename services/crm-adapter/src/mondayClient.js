const axios = require("axios");
const { createLogger } = require("./logger");
const {
  CREATE_ITEM_MUTATION,
  LIST_BOARDS_QUERY,
  LIST_BOARD_ITEMS_PAGE_QUERY,
  NEXT_BOARD_ITEMS_PAGE_QUERY,
} = require("./queries");

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
    logger = createLogger("crm-adapter"),
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.tokenEndpoint = tokenEndpoint;
    this.apiBaseUrl = apiBaseUrl;
    this.httpClient = httpClient;
    this.sleep = sleep;
    this.logger = logger;
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

  async executeGraphQL({ query, variables = {}, token, context = {} }) {
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
            this.logger.error("monday_api_request_failed", {
              tenant_id: context.tenant_id ?? null,
              scan_id: context.scan_id ?? null,
              attempt,
              status_code: response.status,
              reason: "rate_limited",
            });
            throw new Error("Monday API rate limit exceeded after 3 attempts");
          }

          const retryAfter = Number(response.headers["retry-after"] ?? attempt);
          this.logger.warn("monday_api_request_retry", {
            tenant_id: context.tenant_id ?? null,
            scan_id: context.scan_id ?? null,
            attempt,
            retry_after_seconds: retryAfter,
            status_code: response.status,
          });
          await this.sleep(retryAfter * 1000);
          continue;
        }

        if (response.status >= 400) {
          this.logger.error("monday_api_request_failed", {
            tenant_id: context.tenant_id ?? null,
            scan_id: context.scan_id ?? null,
            attempt,
            status_code: response.status,
          });
          throw new Error(`Monday API request failed with status ${response.status}`);
        }

        if (Array.isArray(response.data?.errors) && response.data.errors.length > 0) {
          const message = response.data.errors
            .map((error) => error.message)
            .filter(Boolean)
            .join("; ");
          this.logger.error("monday_api_request_failed", {
            tenant_id: context.tenant_id ?? null,
            scan_id: context.scan_id ?? null,
            attempt,
            reason: "graphql_errors",
            details: message || "Monday API returned GraphQL errors",
          });
          throw new Error(message || "Monday API returned GraphQL errors");
        }

        return response.data;
      } catch (error) {
        const status = error.response?.status;

        if (status === 429 && attempt < 3) {
          const retryAfter = Number(error.response?.headers?.["retry-after"] ?? attempt);
          this.logger.warn("monday_api_request_retry", {
            tenant_id: context.tenant_id ?? null,
            scan_id: context.scan_id ?? null,
            attempt,
            retry_after_seconds: retryAfter,
            status_code: status,
          });
          await this.sleep(retryAfter * 1000);
          continue;
        }

        this.logger.error("monday_api_request_failed", {
          tenant_id: context.tenant_id ?? null,
          scan_id: context.scan_id ?? null,
          attempt,
          error: error.message,
          status_code: status ?? null,
        });
        throw error;
      }
    }

    throw new Error("Monday API rate limit exceeded after 3 attempts");
  }

  async listBoards(token, context = {}) {
    const response = await this.executeGraphQL({
      query: LIST_BOARDS_QUERY,
      token,
      context,
    });

    return response.data?.boards ?? [];
  }

  async listBoardItemsPage({ token, boardId, limit = 500, context = {} }) {
    const response = await this.executeGraphQL({
      query: LIST_BOARD_ITEMS_PAGE_QUERY,
      variables: {
        boardIds: [boardId],
        limit,
      },
      token,
      context,
    });

    const itemsPage = response.data?.boards?.[0]?.items_page ?? {};
    return {
      cursor: itemsPage.cursor ?? null,
      items: itemsPage.items ?? [],
    };
  }

  async nextBoardItemsPage({ token, cursor, limit = 500, context = {} }) {
    const response = await this.executeGraphQL({
      query: NEXT_BOARD_ITEMS_PAGE_QUERY,
      variables: {
        cursor,
        limit,
      },
      token,
      context,
    });

    const itemsPage = response.data?.next_items_page ?? {};
    return {
      cursor: itemsPage.cursor ?? null,
      items: itemsPage.items ?? [],
    };
  }

  async listBoardItems({ token, boardId, limit = 10000, context = {} }) {
    const pageSize = Math.min(Math.max(limit, 1), 500);
    const collected = [];
    let page = await this.listBoardItemsPage({
      token,
      boardId,
      limit: pageSize,
      context,
    });

    collected.push(...page.items);

    while (page.cursor && collected.length < limit) {
      page = await this.nextBoardItemsPage({
        token,
        cursor: page.cursor,
        limit: Math.min(limit - collected.length, 500),
        context,
      });
      collected.push(...page.items);
    }

    return collected.slice(0, limit);
  }

  async createItem({ token, boardId, itemName, columnValues = {}, context = {} }) {
    const response = await this.executeGraphQL({
      query: CREATE_ITEM_MUTATION,
      variables: {
        boardId,
        itemName,
        columnValues: JSON.stringify(columnValues),
      },
      token,
      context,
    });

    return response.data?.create_item ?? null;
  }
}

module.exports = {
  MondayClient,
  wait,
};

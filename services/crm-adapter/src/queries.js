const BOARD_ITEM_FIELDS = `
  id
  name
  column_values {
    id
    text
    type
    value
    column {
      title
    }
  }
`;

const LIST_BOARDS_QUERY = `
  query ListBoards {
    boards {
      id
      name
      columns {
        id
        title
      }
    }
  }
`;

const CREATE_ITEM_MUTATION = `
  mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
      id
    }
  }
`;

const LIST_BOARD_ITEMS_PAGE_QUERY = `
  query ListBoardItemsPage($boardIds: [ID!], $limit: Int!) {
    boards(ids: $boardIds) {
      id
      items_page(limit: $limit) {
        cursor
        items {
          ${BOARD_ITEM_FIELDS}
        }
      }
    }
  }
`;

const NEXT_BOARD_ITEMS_PAGE_QUERY = `
  query NextBoardItemsPage($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        ${BOARD_ITEM_FIELDS}
      }
    }
  }
`;

module.exports = {
  CREATE_ITEM_MUTATION,
  LIST_BOARDS_QUERY,
  LIST_BOARD_ITEMS_PAGE_QUERY,
  NEXT_BOARD_ITEMS_PAGE_QUERY,
};

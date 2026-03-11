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

const LIST_BOARD_ITEMS_QUERY = `
  query ListBoardItems($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      items_page(limit: 100) {
        items {
          id
          name
        }
      }
    }
  }
`;

module.exports = {
  LIST_BOARDS_QUERY,
  CREATE_ITEM_MUTATION,
  LIST_BOARD_ITEMS_QUERY,
};

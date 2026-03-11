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
  mutation CreateItem($boardId: ID!, $itemName: String!) {
    create_item(board_id: $boardId, item_name: $itemName) {
      id
    }
  }
`;

module.exports = {
  LIST_BOARDS_QUERY,
  CREATE_ITEM_MUTATION,
};

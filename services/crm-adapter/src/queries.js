const LIST_BOARDS_QUERY = `
  query {
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
  mutation CreateItem($BOARD_ID: ID!) {
    create_item(board_id: $BOARD_ID, item_name: "Deceased Name") {
      id
    }
  }
`;

module.exports = {
  LIST_BOARDS_QUERY,
  CREATE_ITEM_MUTATION,
};


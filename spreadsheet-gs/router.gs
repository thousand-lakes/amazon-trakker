function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) 
      ? e.parameter.action.toLowerCase().trim() 
      : "default";

    switch (action) {
      case "get_ordered":
        return handleGetOrdered(e);

      case "get_shipped":
        return handleGetShipped(e);

      default:
        return ContentService.createTextOutput("Apps Script Webhook Endpoint Active.");
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) 
      ? e.parameter.action.toLowerCase().trim() 
      : "default";

    switch (action) {
      case "amazon_orders":
        return handleAmazonNewOrders(e);

      case "update_tracking":
        return handleAmazonUpdateTracking(e); // Located in amazon_update_tracking.gs

      case "test_log":
        return handleTestRawLog(e);

      default:
        return handleTestRawLog(e);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
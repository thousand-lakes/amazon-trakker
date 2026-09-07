function handleAmazonNewOrders(e) {
  const startTime = new Date();
  let logSheet = null;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1EnJB26zuZjXNrHnZQwcB01yacs5_0gohzsPfuaQPGJA");
    
    logSheet = ss.getSheetByName("Execution Logs");
    if (!logSheet) {
      logSheet = ss.insertSheet("Execution Logs");
      logSheet.appendRow(["Timestamp", "Action", "Parsed Orders", "New Orders", "Skipped Duplicates", "Inserted Rows", "Details"]);
      logSheet.getRange("A1:G1").setFontWeight("bold");
    }

    if (!e || !e.postData || !e.postData.contents) {
      logExecution(logSheet, startTime, "amazon_orders", 0, 0, [], 0, "Error: Body empty");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Empty body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let payload = JSON.parse(e.postData.contents);
    if (typeof payload === "string") payload = JSON.parse(payload);

    const ordersList = [];
    if (Array.isArray(payload)) {
      payload.forEach(item => {
        if (item["page content"] && Array.isArray(item["page content"])) {
          ordersList.push(...item["page content"]);
        } else if (item.number) {
          ordersList.push(item);
        }
      });
    } else if (typeof payload === "object" && payload !== null) {
      if (Array.isArray(payload["page content"])) {
        ordersList.push(...payload["page content"]);
      } else if (payload.number) {
        ordersList.push(payload);
      }
    }

    // Flip order array so oldest orders on the page get written first
    ordersList.reverse();

    const sheet = ss.getSheetByName("Amazon");
    if (!sheet) {
      logExecution(logSheet, startTime, "amazon_orders", ordersList.length, 0, [], 0, "Error: Tab 'Amazon' missing");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Tab 'Amazon' missing" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Calculate last occupied row based strictly on Column B (Order #)
    const colBValues = sheet.getRange("B:B").getValues();
    let lastRow = 1;
    for (let i = colBValues.length - 1; i >= 0; i--) {
      if (colBValues[i][0] && String(colBValues[i][0]).trim() !== "") {
        lastRow = i + 1;
        break;
      }
    }

    // Fetch existing Order #s in Column B for deduplication
    const existingOrders = new Set();
    if (lastRow > 1) {
      colBValues.slice(1, lastRow).forEach(row => {
        if (row[0]) existingOrders.add(String(row[0]).trim());
      });
    }

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const lastUpdateStr = Utilities.formatDate(now, tz, "MM/dd/yy hh:mm a");
    const historyTimestamp = Utilities.formatDate(now, tz, "MM/dd/yy HH:mm");

    const rowsToInsert = [];
    const skippedOrders = [];
    const newOrders = [];

    ordersList.forEach(order => {
      const orderNum = String(order.number || "").trim();
      if (!orderNum) return;

      // 1. Deduplication check against Column B
      if (existingOrders.has(orderNum)) {
        skippedOrders.push(orderNum);
        return;
      }

      newOrders.push(orderNum);

      const orderDate = order.date ? order.date : ""; 
      const orderDetailsLink = order.orderDetailsLink || "";
      const packages = order.packages || [];

      packages.forEach(pkg => {
        const pkgId = pkg.id || "";
        const estDelivery = pkg.estDeliveryDate || "";
        const trackingLink = pkg.trackingLink || "";
        const items = pkg.items || [];

        items.forEach(item => {
          const rawName = item.name || "Product";
          const cleanName = String(rawName).replace(/"/g, ''); 
          const prodLink = item.productLink || "";
          const imgUrl = item.image || "";
          const qty = item.quantity || 1;

          // Form Formula Strings
          const orderDetailsVal = orderDetailsLink ? `=HYPERLINK("${orderDetailsLink}", "${orderNum}")` : orderNum;
          const itemNameVal = prodLink ? `=HYPERLINK("${prodLink}", "${cleanName}")` : cleanName;
          const imgVal = imgUrl ? `=IMAGE("${imgUrl}")` : "";
          const trackingVal = trackingLink ? `=HYPERLINK("${trackingLink}", "tracking page")` : "";
          const historyVal = `${historyTimestamp} New|${estDelivery}`;

          rowsToInsert.push([
            orderDate,         // A: Order date
            orderNum,          // B: Order #
            pkgId,             // C: Package id
            estDelivery,       // D: Est. delivery date
            orderDetailsVal,   // E: Order details formula
            trackingLink,      // F: Tracking page URL
            itemNameVal,       // G: Item name formula
            imgVal,            // H: Image formula
            qty,               // I: Qty
            "",                // J: Status
            lastUpdateStr,     // K: Last update
            trackingVal,       // L: Tracking link formula
            "",                // M: Attn Required
            prodLink,          // N: Product link
            "",                // O: Comments
            historyVal         // P: History
          ]);
        });
      });

      existingOrders.add(orderNum);
    });

    if (rowsToInsert.length > 0) {
      const maxRows = sheet.getMaxRows();
      const requiredRows = lastRow + rowsToInsert.length;

      if (requiredRows > maxRows) {
        sheet.insertRowsAfter(maxRows, Math.max(requiredRows - maxRows, 500));
      }

      const targetRange = sheet.getRange(lastRow + 1, 1, rowsToInsert.length, rowsToInsert[0].length);
      targetRange.setValues(rowsToInsert);
    }

    logExecution(logSheet, startTime, "amazon_orders", ordersList.length, newOrders.length, skippedOrders, rowsToInsert.length, rowsToInsert.length > 0 ? "Success" : "Skipped (duplicates)");

    return ContentService.createTextOutput(JSON.stringify({ 
      status: "success", 
      parsedOrdersCount: ordersList.length,
      insertedRowsCount: rowsToInsert.length
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    if (logSheet) logExecution(logSheet, startTime, "amazon_orders", 0, 0, [], 0, `Exception: ${err.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
function handleAmazonUpdateTracking(e) {
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
      logExecution(logSheet, startTime, "update_tracking", 0, 0, [], 0, "Error: Body empty");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Empty body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let payload = JSON.parse(e.postData.contents);
    if (typeof payload === "string") payload = JSON.parse(payload);

    // Normalize input (single object vs array of objects)
    const itemsList = Array.isArray(payload) ? payload : [payload];

    const sheet = ss.getSheetByName("Amazon");
    if (!sheet) {
      logExecution(logSheet, startTime, "update_tracking", itemsList.length, 0, [], 0, "Error: Tab 'Amazon' missing");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Tab 'Amazon' missing" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Real last row based on Column B
    const colBValues = sheet.getRange("B:B").getValues();
    let lastRow = 1;
    for (let i = colBValues.length - 1; i >= 0; i--) {
      if (colBValues[i][0] && String(colBValues[i][0]).trim() !== "") {
        lastRow = i + 1;
        break;
      }
    }

    if (lastRow <= 1) {
      logExecution(logSheet, startTime, "update_tracking", itemsList.length, 0, [], 0, "Sheet is empty");
      return ContentService.createTextOutput(JSON.stringify({ status: "success", updatedRowsCount: 0, message: "No data rows in sheet" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Fetch existing Tracking Page links in Column F (Col 6)
    const colFValues = sheet.getRange(2, 6, lastRow - 1, 1).getValues();

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const lastUpdateStr = Utilities.formatDate(now, tz, "MM/dd/yy hh:mm a");
    const historyTimestamp = Utilities.formatDate(now, tz, "MM/dd/yy HH:mm");

    let totalUpdatedRows = 0;

    itemsList.forEach(item => {
      const pageUrl = String(item["page url"] || "").trim();
      const content = item["page content"] || {};

      if (!pageUrl) return;

      const orderStatus = String(content.orderStatus || "").trim();
      const packageStatus = String(content.packageStatus || "").trim();
      const trackingId = String(content.trackingId || "").trim();

      // Determine new Status (Col J)
      let newStatus = "";
      if (orderStatus !== "") {
        newStatus = orderStatus;
      } else if (trackingId === "") {
        newStatus = "Ordered";
      } else {
        newStatus = "Shipped";
      }

      // Determine Tracking no formula (Col L)
      const linkPlaceholder = trackingId !== "" ? trackingId : "tracking page";
      const newTrackingFormula = `=HYPERLINK("${pageUrl}", "${linkPlaceholder}")`;

      // Scan Column F to find all matching rows
      colFValues.forEach((fRow, idx) => {
        const existingUrl = String(fRow[0] || "").trim();
        if (existingUrl === pageUrl) {
          const rowIndex = idx + 2; // Offset for 1-based index + header row

          // 1. Est. delivery date (Col D)
          sheet.getRange(rowIndex, 4).setValue(packageStatus);

          // 2. Status (Col J)
          sheet.getRange(rowIndex, 10).setValue(newStatus);

          // 3. Last update (Col K)
          sheet.getRange(rowIndex, 11).setValue(lastUpdateStr);

          // 4. Tracking no (Col L) & Attn Required (Col M)
          const trackingRange = sheet.getRange(rowIndex, 12);
          const oldFormulaOrValue = String(trackingRange.getFormula() || trackingRange.getValue() || "").trim();

          trackingRange.setValue(newTrackingFormula);

          if (oldFormulaOrValue !== "" && oldFormulaOrValue !== newTrackingFormula) {
            sheet.getRange(rowIndex, 13).setValue(true); // Checkbox enabled
          }

          // 5. History (Col P)
          const historyRange = sheet.getRange(rowIndex, 16);
          const oldHistory = String(historyRange.getValue() || "").trim();
          const newHistoryRecord = `${historyTimestamp} Upd|${orderStatus}|${packageStatus}`;
          const updatedHistory = oldHistory ? `${oldHistory}\n${newHistoryRecord}` : newHistoryRecord;

          historyRange.setValue(updatedHistory);

          totalUpdatedRows++;
        }
      });
    });

    logExecution(logSheet, startTime, "update_tracking", itemsList.length, 0, [], totalUpdatedRows, `Updated ${totalUpdatedRows} row(s)`);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      processedItems: itemsList.length,
      updatedRowsCount: totalUpdatedRows
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    if (logSheet) logExecution(logSheet, startTime, "update_tracking", 0, 0, [], 0, `Exception: ${err.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
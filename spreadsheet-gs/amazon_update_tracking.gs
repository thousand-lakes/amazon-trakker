function handleAmazonUpdateTracking(e) {
  const startTime = new Date();
  let ss = null;

  try {
    // Get active spreadsheet container
    ss = SpreadsheetApp.getActiveSpreadsheet();

    if (!e || !e.postData || !e.postData.contents) {
      logIncident(ss, startTime, "update_tracking", "Error: Body empty");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Empty body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let payload = JSON.parse(e.postData.contents);
    if (typeof payload === "string") payload = JSON.parse(payload);

    const itemsList = Array.isArray(payload) ? payload : [payload];

    const sheet = ss.getSheetByName("Amazon");
    if (!sheet) {
      logIncident(ss, startTime, "update_tracking", "Error: Tab 'Amazon' missing");
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Tab 'Amazon' missing" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Determine actual last row based on Column B
    const sheetLastRow = sheet.getLastRow();
    let lastRow = 1;
    if (sheetLastRow > 1) {
      const colBValues = sheet.getRange(1, 2, sheetLastRow, 1).getValues();
      for (let i = colBValues.length - 1; i >= 0; i--) {
        if (colBValues[i][0] && String(colBValues[i][0]).trim() !== "") {
          lastRow = i + 1;
          break;
        }
      }
    }

    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", updatedRowsCount: 0, message: "No data rows in sheet" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Read Column F (Tracking Page URLs)
    const colFValues = sheet.getRange(2, 6, lastRow - 1, 1).getValues();

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const lastUpdateStr = Utilities.formatDate(now, tz, "MM/dd/yy hh:mm a");
    const historyTimestamp = Utilities.formatDate(now, tz, "MM/dd/yy HH:mm");

    let totalUpdatedRows = 0;

    itemsList.forEach(item => {
      const pageUrl = String(item["page url"] || "").trim();
      
      let content = item["page content"] || {};
      if (typeof content === "string") {
        try { content = JSON.parse(content); } catch (err) { content = {}; }
      }

      if (!pageUrl) return;

      const orderStatus = String(content.orderStatus || "").trim();
      const packageStatus = String(content.packageStatus || "").trim();
      const trackingId = String(content.trackingId || "").trim();

      // Search matching row in Column F
      colFValues.forEach((fRow, idx) => {
        const existingUrl = String(fRow[0] || "").trim();

        if (existingUrl === pageUrl) {
          const rowIndex = idx + 2; // Offset for 1-based index + header row

          // 1. Est. delivery date (Col D): Keep existing if empty in payload
          if (packageStatus !== "") {
            sheet.getRange(rowIndex, 4).setValue(packageStatus);
          }

          // 2. Status (Col J)
          const statusCell = sheet.getRange(rowIndex, 10);
          const currentStatus = String(statusCell.getValue() || "").trim();

          let newStatus = "";
          if (orderStatus !== "") {
            newStatus = orderStatus;
          } else if (trackingId !== "") {
            newStatus = "Shipped";
          } else if (currentStatus === "") {
            newStatus = "Ordered";
          }

          if (newStatus !== "") {
            statusCell.setValue(newStatus);
          }

          // 3. Last update (Col K)
          sheet.getRange(rowIndex, 11).setValue(lastUpdateStr);

          // 4. Tracking Link (Col L) & Attn Required Checkbox (Col M)
          if (trackingId !== "") {
            const trackingCell = sheet.getRange(rowIndex, 12);
            
            // 1. Remember existing visible label before clearing cell
            const oldLabel = String(trackingCell.getValue() || "").trim();

            // 2. Prepare RichText object with tracking URL
            const richText = SpreadsheetApp.newRichTextValue()
              .setText(trackingId)
              .setLinkUrl(pageUrl)
              .build();

            // 3. Clear existing formula or value to ensure reliable overwrite
            trackingCell.clearContent();

            // 4. Set rich text value containing tracking link
            trackingCell.setRichTextValue(richText);

            // 5. Set Col M checkbox to true if tracking ID is new or changed
            if (oldLabel !== trackingId) {
              sheet.getRange(rowIndex, 13).setValue(true);
            }
          }

          // 5. History (Col P)
          const historyCell = sheet.getRange(rowIndex, 16);
          const oldHistory = String(historyCell.getValue() || "").trim();
          const newHistoryRecord = `${historyTimestamp} Upd|${orderStatus}|${packageStatus}`;
          const updatedHistory = oldHistory ? `${oldHistory}\n${newHistoryRecord}` : newHistoryRecord;

          historyCell.setValue(updatedHistory);

          totalUpdatedRows++;
        }
      });
    });

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      processedItems: itemsList.length,
      updatedRowsCount: totalUpdatedRows
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logIncident(ss, startTime, "update_tracking", `Exception: ${err.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function logIncident(ss, startTime, action, details) {
  try {
    if (!ss) return;
    let logSheet = ss.getSheetByName("Incidents");
    if (!logSheet) {
      logSheet = ss.insertSheet("Incidents");
      logSheet.appendRow(["Timestamp", "Duration (ms)", "Action", "Details"]);
    }
    const duration = new Date() - startTime;
    logSheet.appendRow([new Date(), duration, action, details]);
  } catch (e) {
    // Silent catch
  }
}
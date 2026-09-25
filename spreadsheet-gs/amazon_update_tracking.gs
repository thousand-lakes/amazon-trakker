function handleAmazonUpdateTracking(e) {
  const startTime = new Date();
  let ss = null;

  try {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1EnJB26zuZjXNrHnZQwcB01yacs5_0gohzsPfuaQPGJA");

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

    const cleanStr = (str) => {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/"/g, '""')
        .trim();
    };

    let totalUpdatedRows = 0;

    itemsList.forEach(item => {
      const pageUrl = String(item["page url"] || "").trim();
      const content = item["page content"] || {};

      if (!pageUrl) return;

      const orderStatus = String(content.orderStatus || "").trim();
      const packageStatus = String(content.packageStatus || "").trim();
      const trackingId = String(content.trackingId || "").trim();

      let newStatus = "";
      if (orderStatus !== "") {
        newStatus = orderStatus;
      } else if (trackingId === "") {
        newStatus = "Ordered";
      } else {
        newStatus = "Shipped";
      }

      const linkPlaceholder = trackingId !== "" ? trackingId : "tracking page";
      const newTrackingFormula = `=HYPERLINK("${cleanStr(pageUrl)}", "${cleanStr(linkPlaceholder)}")`;

      // Exact match against Column F
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

          // 4. Tracking no formula (Col L) & Attn Required (Col M)
          const trackingCell = sheet.getRange(rowIndex, 12);
          const oldFormulaOrValue = String(trackingCell.getFormula() || trackingCell.getValue() || "").trim();

          trackingCell.setValue(newTrackingFormula);

          if (oldFormulaOrValue !== "" && oldFormulaOrValue !== newTrackingFormula) {
            sheet.getRange(rowIndex, 13).setValue(true); // Enable checkbox
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
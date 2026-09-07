function syncAmazonStatuses() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1EnJB26zuZjXNrHnZQwcB01yacs5_0gohzsPfuaQPGJA");
    const sheet = ss.getSheetByName("Amazon");
    if (!sheet) return;

    // Find real last row based strictly on Column B
    const colBValues = sheet.getRange("B:B").getValues();
    let lastRow = 1;
    for (let i = colBValues.length - 1; i >= 0; i--) {
      if (colBValues[i][0] && String(colBValues[i][0]).trim() !== "") {
        lastRow = i + 1;
        break;
      }
    }

    if (lastRow <= 1) return;

    // Read all rows into memory for fast scanning
    const data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const lastUpdateStr = Utilities.formatDate(now, tz, "MM/dd/yy hh:mm a");
    const historyTimestamp = Utilities.formatDate(now, tz, "MM/dd/yy HH:mm");

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const estDelivery = String(row[3] || "").trim();    // Col D (Index 3)
      const currentStatus = String(row[9] || "").trim();  // Col J (Index 9)
      const estLower = estDelivery.toLowerCase();

      let targetStatus = null;
      let historyTag = null;

      // Rule evaluation
      if (estLower.startsWith("delivered")) {
        if (currentStatus !== "Delivered") {
          targetStatus = "Delivered";
          historyTag = "Aut|Delivered";
        }
      } else if (estLower === "cancelled") {
        if (currentStatus !== "Cancelled") {
          targetStatus = "Cancelled";
          historyTag = "Aut|Cancelled";
        }
      } else if (estLower === "refund issued") {
        if (currentStatus !== "Refunding") {
          targetStatus = "Refunding";
          historyTag = "Aut|Refunding";
        }
      } else if (estLower === "refunded") {
        if (currentStatus !== "Refunded") {
          targetStatus = "Refunded";
          historyTag = "Aut|Refunded";
        }
      } else if (estLower === "replacement ordered") {
        if (currentStatus !== "Replaced") {
          targetStatus = "Replaced";
          historyTag = "Aut|Replaced";
        }
      } else if (estLower.startsWith("return")) {
        if (currentStatus !== "Return") {
          targetStatus = "Return";
          historyTag = "Aut|Return";
        }
      }

      // Targeted write: update ONLY modified row cells
      if (targetStatus && historyTag) {
        const rowIndex = i + 2; // Row index in sheet
        const oldHistory = String(row[15] || "").trim();
        const newHistoryRecord = `${historyTimestamp} ${historyTag}`;
        const updatedHistory = oldHistory ? `${oldHistory}\n${newHistoryRecord}` : newHistoryRecord;

        sheet.getRange(rowIndex, 10).setValue(targetStatus);   // Col J: Status
        sheet.getRange(rowIndex, 11).setValue(lastUpdateStr);  // Col K: Last update
        sheet.getRange(rowIndex, 16).setValue(updatedHistory); // Col P: History
      }
    }

  } catch (err) {
    console.log("Error in syncAmazonStatuses:", err.toString());
  }
}
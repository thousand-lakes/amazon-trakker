/**
 * Main function to process Amazon payloads (both Tracking Page and Order Details).
 * Accepts event object 'e' from your router (containing e.postData.contents).
 */
function handleAmazonUpdateTracking(e) {
  const startTime = new Date();
  let ss = null;

  try {
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

    // Determine actual last row based on Column B (Order ID)
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

    // Strict pointer tracking for seamless batch appends
    let currentLastRow = lastRow;

    // Load all sheet data into memory (Columns A-P)
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 16);
    const data = dataRange.getValues();

    // Batch read Column E formulas and RichText for URL extraction
    const colEFormulas = sheet.getRange(2, 5, lastRow - 1, 1).getFormulas();
    const colERichTexts = sheet.getRange(2, 5, lastRow - 1, 1).getRichTextValues();

    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const lastUpdateStr = Utilities.formatDate(now, tz, "MM/dd/yy hh:mm a");
    const historyTimestamp = Utilities.formatDate(now, tz, "MM/dd/yy HH:mm");

    // Clean strings for Google Sheets formula literals (sync with primary parser)
    const cleanStr = (str) => {
      if (str === null || str === undefined) return "";
      return String(str).replace(/[\r\n\t]+/g, " ").replace(/"/g, '""').trim();
    };

    let totalUpdatedRows = 0;
    let totalInsertedRows = 0;

    itemsList.forEach(item => {
      const rawUrl = String(item["page url"] || "").trim();
      
      let content = item["page content"] || {};
      if (typeof content === "string") {
        try { content = JSON.parse(content); } catch (err) { content = {}; }
      }
      
      const pageUrl = String(content.pageUrl || rawUrl).trim();

      // =========================================================================
      // ROUTER BRANCH 1: ORDER DETAILS PAYLOAD (Safe Link Healing + Auto-Add New Items)
      // =========================================================================
      if (Array.isArray(content.packages)) {
        const orderId = String(content.number || "").trim();
        const orderDate = String(content.date || "").trim();
        const shipTo = String(content.shipTo || "").replace(/[\r\n\t]+/g, " ").trim();
        const newRowsToAppend = [];

        content.packages.forEach(pkg => {
          const trackingLink = String(pkg.trackingLink || "").trim();
          const pkgId = String(pkg.id || "").trim();
          const estDeliveryDate = String(pkg.estDeliveryDate || "").trim();
          const pkgItems = Array.isArray(pkg.items) ? pkg.items : [];

          // Build ASIN allocation map for this package (Store quantity AND item data)
          const pkgAsinQuota = {};
          pkgItems.forEach(pkgItm => {
            const asin = extractAsin(pkgItm.productId || pkgItm.productLink);
            if (asin) {
              const qty = Number(pkgItm.quantity) || 1;
              if (pkgAsinQuota[asin]) {
                pkgAsinQuota[asin].qty += qty;
              } else {
                pkgAsinQuota[asin] = { qty: qty, data: pkgItm, asin: asin };
              }
            }
          });

          // Match sheet rows and insert newly retrieved trackingLink into Column F
          data.forEach((row, idx) => {
            const existingOrderNum = String(row[1] || "").trim();    // Column B
            const existingTrackingUrl = String(row[5] || "").trim(); // Column F
            const rowQty = Number(row[8]) || 1;                      // Column I
            const existingProductUrl = String(row[13] || "").trim(); // Column N
            const existingAsin = extractAsin(existingProductUrl);

            const isOrderMatch = existingOrderNum === orderId;
            const hasQuota = existingAsin && (pkgAsinQuota[existingAsin]?.qty || 0) > 0;

            if (isOrderMatch && hasQuota && trackingLink !== "") {
              const rowIndex = idx + 2;

              // Only update if the tracking link actually changed
              if (existingTrackingUrl !== trackingLink) {
                sheet.getRange(rowIndex, 6).setValue(trackingLink);

                const historyCell = sheet.getRange(rowIndex, 16);
                const oldHistory = String(historyCell.getValue() || "").trim();
                const newRec = `${historyTimestamp} Order Details | Linked new tracking page`;
                historyCell.setValue(oldHistory ? `${oldHistory}\n${newRec}` : newRec);

                totalUpdatedRows++;
              }

              // Deduct quota
              pkgAsinQuota[existingAsin].qty -= rowQty;
            }
          });

          // CHECK REMAINDERS: If leftover qty > 0, generate new rows
          Object.keys(pkgAsinQuota).forEach(asinKey => {
            const leftover = pkgAsinQuota[asinKey].qty;
            if (leftover > 0) {
              const itemData = pkgAsinQuota[asinKey].data;
              const asin = pkgAsinQuota[asinKey].asin;
              
              const rawName = itemData.name || "Product";
              const prodLink = (itemData.productLink || "").trim();
              const imgUrl = (itemData.image || "").trim();
              
              const orderDetailsVal = pageUrl ? `=HYPERLINK("${cleanStr(pageUrl)}", "${cleanStr(orderId)}")` : orderId;
              const itemNameVal = prodLink ? `=HYPERLINK("${cleanStr(prodLink)}", "${cleanStr(rawName)}")` : cleanStr(rawName);
              const imgVal = imgUrl ? `=IMAGE("${cleanStr(imgUrl)}")` : "";
              const trackingVal = trackingLink ? `=HYPERLINK("${cleanStr(trackingLink)}", "tracking page")` : "";
              const prodIdVal = prodLink ? `=HYPERLINK("${cleanStr(prodLink)}", "${cleanStr(asin)}")` : cleanStr(asin);
              
              const historyVal = `${historyTimestamp} Added automatically (Substitution/New Item from Order Details)`;

              newRowsToAppend.push([
                orderDate,         // A: Order date
                orderId,           // B: Order #
                pkgId,             // C: Package id
                estDeliveryDate,   // D: Est. delivery date
                orderDetailsVal,   // E: Order details formula
                trackingLink,      // F: Tracking page URL
                itemNameVal,       // G: Item name formula
                imgVal,            // H: Image formula
                leftover,          // I: Qty
                "",                // J: Status
                lastUpdateStr,     // K: Last update
                trackingVal,       // L: Tracking link formula
                true,              // M: Attn Required
                prodIdVal,         // N: Product link formula with ASIN
                "",                // O: Comments
                historyVal,        // P: History
                shipTo             // Q: Ship To
              ]);
            }
          });
        });

        // Batch insert new rows strictly below currentLastRow
        if (newRowsToAppend.length > 0) {
          const appendStartRow = currentLastRow + 1;
          const maxRows = sheet.getMaxRows();
          const requiredMaxRows = appendStartRow + newRowsToAppend.length - 1;
          
          if (requiredMaxRows > maxRows) {
            sheet.insertRowsAfter(maxRows, requiredMaxRows - maxRows);
          }
          
          sheet.getRange(appendStartRow, 1, newRowsToAppend.length, 17).setValues(newRowsToAppend);
          currentLastRow += newRowsToAppend.length;
          totalInsertedRows += newRowsToAppend.length;
        }

        return; // Complete handling for Order Details payload
      }

      // =========================================================================
      // ROUTER BRANCH 2: TRACKING PAGE PAYLOAD
      // =========================================================================
      const deliveryStatus = String(content.deliveryStatus || "").trim();
      const packageStatus = String(content.packageStatus || "").trim();
      const trackingId = String(content.trackingId || "").trim();

      // Extract latest delivery event message (index 0)
      let latestEvent = "";
      if (Array.isArray(content.trackingEvents) && content.trackingEvents.length > 0) {
        const ev = content.trackingEvents[0];
        if (ev && ev.message) {
          latestEvent = String(ev.message).trim();
        }
      }

      // Format delivery details string (Column D)
      let deliveryDetailsStr = packageStatus;
      if (latestEvent !== "") {
        deliveryDetailsStr = packageStatus ? `${packageStatus} - ${latestEvent}` : latestEvent;
      }

      const itemsInPackage = Array.isArray(content.itemsInThisPackage) ? content.itemsInThisPackage : [];
      const associatedOrderIds = Array.isArray(content.associatedOrderIds) ? content.associatedOrderIds.map(id => String(id).trim()) : [];

      // -------------------------------------------------------------
      // 1. GUARDRAIL: Check for broken / invalid parsed data
      // -------------------------------------------------------------
      if (itemsInPackage.length === 0 && !deliveryStatus && !packageStatus && !trackingId) {
        logIncident(ss, startTime, "Parsing Error / Dead Link", `URL: ${pageUrl} | Payload: ${JSON.stringify(item)}`);
        return; // Skip corrupted record
      }

      // -------------------------------------------------------------
      // 2. SCENARIO 1: Minimal "Ordered" status without items list
      // -------------------------------------------------------------
      if (itemsInPackage.length === 0) {
        data.forEach((row, idx) => {
          const existingTrackingUrl = String(row[5] || "").trim(); // Column F
          const existingStatus = String(row[9] || "").trim();      // Column J

          if (pageUrl && existingTrackingUrl === pageUrl && (existingStatus === "" || existingStatus === "Ordered")) {
            const rowIndex = idx + 2;

            sheet.getRange(rowIndex, 10).setValue("Ordered");

            if (deliveryDetailsStr !== "") {
              sheet.getRange(rowIndex, 4).setValue(deliveryDetailsStr);
            }

            sheet.getRange(rowIndex, 11).setValue(lastUpdateStr);

            const historyCell = sheet.getRange(rowIndex, 16);
            const oldHistory = String(historyCell.getValue() || "").trim();
            const newRec = `${historyTimestamp} Upd|Ordered|${deliveryDetailsStr}`;
            historyCell.setValue(oldHistory ? `${oldHistory}\n${newRec}` : newRec);

            totalUpdatedRows++;
          }
        });
        return;
      }

      // -------------------------------------------------------------
      // 3. SCENARIO 2 & 3: Package with items (FBA / Multi-item / Shipped / Delivered)
      // -------------------------------------------------------------
      const availableAsins = {};
      itemsInPackage.forEach(itm => {
        const asin = extractAsin(itm.asin || itm.productUrl);
        if (asin) {
          const qty = Number(itm.quantity) || 1;
          availableAsins[asin] = (availableAsins[asin] || 0) + qty;
        }
      });

      const updatedRowIndexes = new Set();

      // Pass 1: Match search and row updates
      data.forEach((row, idx) => {
        const existingOrderNum = String(row[1] || "").trim();    // Column B
        const rowQty = Number(row[8]) || 1;                      // Column I
        const existingProductUrl = String(row[13] || "").trim(); // Column N
        const existingAsin = extractAsin(existingProductUrl);

        const isOrderMatch = associatedOrderIds.length === 0 || associatedOrderIds.includes(existingOrderNum);
        const hasQuota = existingAsin && (availableAsins[existingAsin] || 0) > 0;

        if (isOrderMatch && hasQuota) {
          const rowIndex = idx + 2;
          updatedRowIndexes.add(rowIndex);

          const existingTrackingUrl = String(row[5] || "").trim();
          if (pageUrl && existingTrackingUrl !== pageUrl) {
            sheet.getRange(rowIndex, 6).setValue(pageUrl);
          }

          if (deliveryDetailsStr !== "") {
            sheet.getRange(rowIndex, 4).setValue(deliveryDetailsStr);
          }

          const statusCell = sheet.getRange(rowIndex, 10);
          let newStatus = deliveryStatus;
          if (!newStatus) {
            newStatus = trackingId ? "Shipped" : "Ordered";
          }
          statusCell.setValue(newStatus);

          sheet.getRange(rowIndex, 11).setValue(lastUpdateStr);

          if (trackingId !== "") {
            const trackingCell = sheet.getRange(rowIndex, 12);
            const oldLabel = String(trackingCell.getValue() || "").trim();

            const richText = SpreadsheetApp.newRichTextValue()
              .setText(trackingId)
              .setLinkUrl(pageUrl)
              .build();

            trackingCell.clearContent();
            trackingCell.setRichTextValue(richText);

            if (oldLabel !== trackingId) {
              sheet.getRange(rowIndex, 13).setValue(true);
            }
          }

          const historyCell = sheet.getRange(rowIndex, 16);
          const oldHistory = String(historyCell.getValue() || "").trim();
          const newRec = `${historyTimestamp} Upd|${newStatus}|${deliveryDetailsStr}`;
          historyCell.setValue(oldHistory ? `${oldHistory}\n${newRec}` : newRec);

          availableAsins[existingAsin] -= rowQty;
          totalUpdatedRows++;
        }
      });

      // Pass 2: Split Package Cleanup
      if (pageUrl) {
        data.forEach((row, idx) => {
          const rowIndex = idx + 2;
          const existingTrackingUrl = String(row[5] || "").trim();

          if (existingTrackingUrl === pageUrl && !updatedRowIndexes.has(rowIndex)) {
            const formulaStr = colEFormulas[idx] ? colEFormulas[idx][0] : "";
            const richTextVal = colERichTexts[idx] ? colERichTexts[idx][0] : null;
            const rawCellVal = String(row[4] || "").trim();
            
            const orderDetailsUrl = extractUrlFromCell(formulaStr, rawCellVal, richTextVal);

            sheet.getRange(rowIndex, 6).setValue(orderDetailsUrl); 
            sheet.getRange(rowIndex, 10).setValue("");             
            sheet.getRange(rowIndex, 13).setValue(true);           

            const historyCell = sheet.getRange(rowIndex, 16);
            const oldHistory = String(historyCell.getValue() || "").trim();
            const newRec = `${historyTimestamp} Detached from tracking page (Split package -> Replaced URL with Order Details link)`;
            historyCell.setValue(oldHistory ? `${oldHistory}\n${newRec}` : newRec);
          }
        });
      }
    });

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      processedItems: itemsList.length,
      updatedRowsCount: totalUpdatedRows,
      insertedRowsCount: totalInsertedRows
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logIncident(ss, startTime, "update_tracking", `Exception: ${err.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Helper to extract raw URL from `=HYPERLINK("url", "label")` formula, RichText link, or plain text URL.
 */
function extractUrlFromCell(formulaStr, valStr, richText) {
  if (formulaStr) {
    const match = formulaStr.match(/HYPERLINK\(\s*"([^"]+)"/i) || formulaStr.match(/HYPERLINK\(\s*'([^']+)'/i);
    if (match) return match[1];
  }
  if (richText && typeof richText.getLinkUrl === "function" && richText.getLinkUrl()) {
    return richText.getLinkUrl();
  }
  if (valStr && valStr.toLowerCase().startsWith("http")) {
    return valStr;
  }
  return "";
}

/**
 * Extracts 10-character ASIN/ISBN from clean text, URL, or HYPERLINK formula in a cell.
 */
function extractAsin(url) {
  if (!url) return "";
  const str = String(url).trim();
  
  if (/^[A-Z0-9]{10}$/i.test(str)) {
    return str.toUpperCase();
  }

  const match = str.match(/(?:dp|product|gp\/product|\/d)\/([A-Z0-9]{10})/i) 
             || str.match(/\/([A-Z0-9]{10})(?:[\/?#]|$)/i)
             || str.match(/\b([B0-9][A-Z0-9]{9})\b/i);

  return match ? match[1].toUpperCase() : "";
}

/**
 * Logs errors and invalid payloads into 'Incidents' tab.
 */
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
    // Silent catch for logging errors
  }
}
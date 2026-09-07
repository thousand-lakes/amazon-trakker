function handleGetShipped(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1EnJB26zuZjXNrHnZQwcB01yacs5_0gohzsPfuaQPGJA");
    const sheet = ss.getSheetByName("Amazon");

    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Tab 'Amazon' missing" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Read limit parameter from URL (defaults to 100 if omitted)
    const limit = (e && e.parameter && e.parameter.limit) 
      ? parseInt(e.parameter.limit, 10) 
      : 100;

    // Real last row based strictly on Column B (Order #)
    const colBValues = sheet.getRange("B:B").getValues();
    let lastRow = 1;
    for (let i = colBValues.length - 1; i >= 0; i--) {
      if (colBValues[i][0] && String(colBValues[i][0]).trim() !== "") {
        lastRow = i + 1;
        break;
      }
    }

    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify([{ links: [] }]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();

    // 1. Filter: Status (Col J / Index 9) is "Shipped" OR "Out for delivery", AND Tracking link (Col F / Index 5) is non-empty
    const filteredRows = data.filter(row => {
      const status = String(row[9] || "").trim().toLowerCase();
      const trackingLink = String(row[5] || "").trim();

      const isMatch = (status === "shipped" || status === "out for delivery");
      return isMatch && trackingLink !== "";
    });

    // 2. Sort 1 level: Last update (Col K / Index 10), oldest date first
    filteredRows.sort((a, b) => {
      const dateA = a[10] instanceof Date ? a[10].getTime() : (new Date(a[10]).getTime() || 0);
      const dateB = b[10] instanceof Date ? b[10].getTime() : (new Date(b[10]).getTime() || 0);

      return dateA - dateB;
    });

    // Apply limit & extract links array
    const slicedRows = filteredRows.slice(0, limit);
    const linksArray = slicedRows.map(row => String(row[5]).trim());

    const responsePayload = [
      {
        "links": linksArray
      }
    ];

    return ContentService.createTextOutput(JSON.stringify(responsePayload, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.log("Error in handleGetShipped:", err.toString());
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
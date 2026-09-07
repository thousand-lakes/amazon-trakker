function handleGetOrdered(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById("1EnJB26zuZjXNrHnZQwcB01yacs5_0gohzsPfuaQPGJA");
    const sheet = ss.getSheetByName("Amazon");

    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Tab 'Amazon' missing" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Read limit from URL query parameter (default to 100 if omitted)
    const limit = (e && e.parameter && e.parameter.limit) 
      ? parseInt(e.parameter.limit, 10) 
      : 100;

    // Calculate real last row based strictly on Column B
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

    // Filter rows: Status is "" OR "Ordered", AND Column F (Tracking link) is not empty
    const filteredRows = data.filter(row => {
      const status = String(row[9] || "").trim();
      const trackingLink = String(row[5] || "").trim();
      return (status === "" || status.toLowerCase() === "ordered") && trackingLink !== "";
    });

    // 2-Level Sort: Status "" first, "Ordered" second, then Last update (Col K) oldest first
    filteredRows.sort((a, b) => {
      const statusA = String(a[9] || "").trim().toLowerCase();
      const statusB = String(b[9] || "").trim().toLowerCase();

      const priorityA = (statusA === "") ? 0 : 1;
      const priorityB = (statusB === "") ? 0 : 1;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      const dateA = a[10] instanceof Date ? a[10].getTime() : (new Date(a[10]).getTime() || 0);
      const dateB = b[10] instanceof Date ? b[10].getTime() : (new Date(b[10]).getTime() || 0);

      return dateA - dateB;
    });

    // Apply dynamic limit
    const slicedRows = filteredRows.slice(0, limit);
    const linksArray = slicedRows.map(row => String(row[5]).trim());

    console.log(`Matched ${filteredRows.length} total rows. Returning top ${linksArray.length} links.`);

    const responsePayload = [
      {
        "links": linksArray
      }
    ];

    return ContentService.createTextOutput(JSON.stringify(responsePayload, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.log("Error in handleGetOrdered:", err.toString());
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
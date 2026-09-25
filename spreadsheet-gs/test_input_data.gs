function handleTestRawLog(e) {
  try {
    console.log("--- Processing Action: test_log ---");
    const rawContent = (e && e.postData && e.postData.contents) ? e.postData.contents : "";

    let parsedData = null;
    let structureType = "Empty / Non-JSON";

    if (rawContent) {
      try {
        parsedData = JSON.parse(rawContent);
        structureType = Array.isArray(parsedData) 
          ? `Array [length: ${parsedData.length}]` 
          : `Object { keys: ${Object.keys(parsedData).join(", ")} }`;
      } catch (_) {
        structureType = "Raw Text / Non-JSON";
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      let sheet = ss.getSheetByName("Raw Logs");
      if (!sheet) {
        sheet = ss.insertSheet("Raw Logs");
        sheet.appendRow(["Timestamp", "Structure Type", "Raw Body"]);
      }
      sheet.appendRow([new Date(), structureType, rawContent]);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      action: "test_log",
      detectedStructure: structureType,
      parsedPayload: parsedData
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.log("Error in handleTestRawLog:", err.toString());
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
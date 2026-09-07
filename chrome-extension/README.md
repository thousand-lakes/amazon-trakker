# Amazon Tracker 📦

A lightweight, modern Google Chrome extension (Manifest V3) that extracts readable text content from open browser tabs and sends it directly to configured test or live webhooks. 

Perfect for archiving pages, feeding content into automated workflows, syncing with note-taking tools, or backing up active tab sessions.

---

## 🚀 Features

- **💡 Single-Page Sending**: Sends only the active tab. Fetched links are opened, made active, processed, and closed sequentially.
- **🌐 Workflow Webhooks**: Configure a dedicated send-results destination for General, Amazon, and each additional workflow.
- **⚡ Multiple Trigger Options**:
  - Global Keyboard Shortcuts: assign hotkeys for General, Amazon, and all three additional workflows in **Settings → Keyboard Shortcuts**. General defaults to `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (macOS).
  - Browser Toolbar: Click the extension icon and choose Amazon Orders, General, or any enabled additional workflow.
- **⏹️ Graceful Stop**: Stop an active sequence from the toolbar popup or with `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS). The open page still waits, sends to its webhook, and closes before the sequence ends.
- **🔢 Amazon Sequence Widget**: Active Amazon sequence tabs show a compact countdown and current/total page position while they are being processed.
- **📦 Amazon Orders Launcher**: Enter a page count and process that many Amazon order-history pages in descending order, ending at page `0`, without requesting a URL list from the links-source webhook.
- **🔀 Three Additional Workflows**: Configure independent get-pages and send-results webhooks, popup names/colors, enable switches, and daily/weekly schedule rules.
- **🚦 Priority Queue**: Runs one workflow at a time. Amazon has highest priority, additional workflows are second, and General is lowest. Pending work is kept only for the current browser session.
- **⏰ Automatic Launching**: Run every configured number of minutes, optionally only on selected days/in a local-time window and only after the PC has been idle for a configured duration.
- **🖥️ PC-Local Configuration**: All webhook, scheduling, and behavior settings stay on the computer where the unpacked extension is installed and are not stored in Chrome Sync.
- **🌀 Live Visual Feedback**: The extension icon shows an animated activity badge while content is being processed and transmitted.
- **🛡️ Deep DOM Parsing**: Traverses nested elements, ignores scripts/styles, and extracts text from elements residing within **Shadow DOMs** (`shadowRoot`).

---

## 📁 File Structure

```
chrome-extension/
├── manifest.json              # Extension configurations & keyboard shortcuts
├── background.js              # Background worker handling queues, tab management & webhook sync
├── amazon-order-list.js       # Amazon order history DOM parser
├── amazon-tracking.js         # Amazon package tracking DOM parser
├── options.html               # Options page HTML dashboard
├── options.css                # Options page styling
├── options.js                 # Settings synchronization with chrome.storage
├── popup.html                 # Toolbar popup controls
├── popup.css                  # Toolbar popup styles
└── popup.js                   # Workflow triggers, status badges & queue requests
```

---

## 🛠️ Installation & Assembly

See the root [README.md](../README.md) for the complete end-to-end assembly guide (Google Sheet setup, Apps Script deployment, and webhook URLs).

To install the extension manually in **Developer Mode**:

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. In the top-right corner, toggle **Developer mode** to **On**.
3. In the top-left corner, click **Load unpacked**.
4. Select this `chrome-extension` folder.
5. The extension will appear in your extensions list.

---

## ⚙️ Configuration

1. Click the extensions puzzle icon in your browser toolbar and click **Amazon Tracker** (or right-click it and choose **Options**).
2. Configure your workflows with your deployed Apps Script Web App URL:
   - **Get new orders settings**:
     - Send-results Webhook URL: `YOUR_WEB_APP_URL?action=amazon_orders`
     - Order pages: `1` (or count of pages to scan)
   - **Check Order Delivery status settings (General Workflow)**:
     - Fetch link list: **ON**
     - Fetching URL: `YOUR_WEB_APP_URL?action=get_ordered`
     - Send-results Webhook URL: `YOUR_WEB_APP_URL?action=update_tracking`
   - **Additional Workflows (e.g. Check Shipped)**:
     - Enable Additional Workflow 1: **ON**
     - Fetching URL: `YOUR_WEB_APP_URL?action=get_shipped`
     - Send-results Webhook URL: `YOUR_WEB_APP_URL?action=update_tracking`
3. Configure general settings:
   - Page open times (min/max seconds) to introduce natural delays between pages.
   - Toggle **Close workflow tabs after sending** to keep your workspace clean.
   - Optionally enable **Launch automatically** or **Require PC to be idle** for unattended tracking.
4. Settings are saved automatically as you edit.

---

## 📄 License

This project is licensed under the MIT License.


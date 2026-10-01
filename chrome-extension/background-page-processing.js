'use strict';

function isAmazonOrdersPage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAmazon = host === 'www.amazon.com' || host === 'amazon.com';
    return isAmazon && (
      parsed.pathname.startsWith('/your-orders/orders') ||
      parsed.pathname.startsWith('/gp/css/order-history')
    );
  } catch (e) {
    return (
      url.startsWith('https://www.amazon.com/your-orders/orders') ||
      url.startsWith('http://www.amazon.com/your-orders/orders') ||
      url.startsWith('https://amazon.com/your-orders/orders') ||
      url.startsWith('https://www.amazon.com/gp/css/order-history') ||
      url.startsWith('http://www.amazon.com/gp/css/order-history') ||
      url.startsWith('https://amazon.com/gp/css/order-history')
    );
  }
}

function isAmazonOrderDetailsPage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAmazon = host === 'www.amazon.com' || host === 'amazon.com';
    const path = parsed.pathname.replace(/\/+$/, '');
    return isAmazon && (
      path === '/your-orders/order-details' ||
      path === '/gp/your-account/order-details'
    );
  } catch (_) {
    return /^(?:https?:\/\/)?(?:www\.)?amazon\.com\/(?:your-orders\/order-details|gp\/your-account\/order-details)(?:[/?#]|$)/i.test(url);
  }
}

function isAmazonTrackingPage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAmazon = host === 'www.amazon.com' || host === 'amazon.com';
    return isAmazon && (
      parsed.pathname.startsWith('/gp/your-account/ship-track') ||
      parsed.pathname.startsWith('/progress-tracker/package')
    );
  } catch (e) {
    return (
      url.startsWith('https://www.amazon.com/gp/your-account/ship-track') ||
      url.startsWith('http://www.amazon.com/gp/your-account/ship-track') ||
      url.startsWith('https://amazon.com/gp/your-account/ship-track') ||
      url.startsWith('https://www.amazon.com/progress-tracker/package') ||
      url.startsWith('http://www.amazon.com/progress-tracker/package') ||
      url.startsWith('https://amazon.com/progress-tracker/package')
    );
  }
}

function isAmazonDomain(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'amazon.com' || host.endsWith('.amazon.com');
  } catch (_) {
    return false;
  }
}

async function processAndSendTab(tabId, url, webhookUrl, signal) {
  throwIfWorkflowStopped(signal);
  // Amazon may redirect the saved legacy ship-track URL to the newer
  // progress-tracker route. Classify using either URL while retaining the
  // original URL in the webhook payload so it still matches the sheet row.
  let loadedUrl = url;
  try {
    const loadedTab = await chrome.tabs.get(tabId);
    if (loadedTab && loadedTab.url) loadedUrl = loadedTab.url;
  } catch (_) { }

  // Amazon currently serves order details from both its newer /your-orders
  // route and the legacy /gp/your-account route. Either route can redirect to
  // the other, so classify both the requested and final URL.
  if (isAmazonOrderDetailsPage(url) || isAmazonOrderDetailsPage(loadedUrl)) {
    console.log(`Detected Amazon order details page: ${loadedUrl}. Parsing structured order details...`);
    throwIfWorkflowStopped(signal);
    const [result] = await waitForOperation(chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: parseAmazonOrderDetails
    }), signal);
    throwIfWorkflowStopped(signal);

    const orderData = result ? result.result : null;
    if (!orderData) {
      throw new Error(`Could not find an Amazon order number on details page ${loadedUrl}.`);
    }
    console.log(`Parsed Amazon order details for ${orderData.number} from tab ${tabId}.`);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        "page url": url,
        "page content": orderData
      }),
      signal,
    });

    if (response.ok) {
      console.log(`Successfully sent Amazon order details: ${url}`);
    } else {
      console.error(`Failed to send Amazon order details: ${url}. Status: ${response.status}`);
    }
    return;
  }

  if (isAmazonTrackingPage(url) || isAmazonTrackingPage(loadedUrl)) {
    console.log(`Detected Amazon tracking page: ${url}. Parsing tracking details...`);
    throwIfWorkflowStopped(signal);
    const [result] = await waitForOperation(chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: parseAmazonTrackingPage
    }), signal);
    throwIfWorkflowStopped(signal);

    const trackingData = (result && result.result) || {};
    console.log(`Parsed Amazon tracking data from tab ${tabId}:`, trackingData);

    const data = {
      "page url": url,
      "page content": trackingData
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal,
    });

    if (response.ok) {
      console.log(`Successfully sent Amazon tracking data: ${url}`);
    } else {
      console.error(`Failed to send Amazon tracking data: ${url}. Status: ${response.status}`);
    }
    return;
  }

  // Amazon's account navigation can enter through the legacy
  // /gp/css/order-history route and redirect to /your-orders/orders (or the
  // other way around during experiments). Check both the requested and final
  // URL so either route receives the structured order parser.
  if (isAmazonOrdersPage(url) || isAmazonOrdersPage(loadedUrl)) {
    console.log(`Detected Amazon orders page: ${loadedUrl}. Parsing structured orders...`);
    throwIfWorkflowStopped(signal);
    const [result] = await waitForOperation(chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: parseAmazonOrders
    }), signal);
    throwIfWorkflowStopped(signal);

    const ordersData = (result && result.result) || [];
    console.log(`Parsed ${ordersData.length} Amazon order(s) from tab ${tabId}.`);

    // Webhook JSON Payload with structured order data
    const data = {
      "page url": url,
      "page content": ordersData
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal,
    });

    if (response.ok) {
      console.log(`Successfully sent Amazon orders: ${url}`);
    } else {
      console.error(`Failed to send Amazon orders: ${url}. Status: ${response.status}`);
    }
    return;
  }

  throwIfWorkflowStopped(signal);
  const [result] = await waitForOperation(chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      if (!document.documentElement) {
        return { chunks: [], length: 0, removedRakutenNodes: 0 };
      }

      // Work on a detached copy so filtering never changes the page the user
      // is viewing. Rakuten injects very large font/style blocks and popup UI
      // into the merchant DOM; those are extension data, not page content.
      const documentCopy = document.documentElement.cloneNode(true);
      const rakutenExtensionId = 'chhjbpecpncaggjpdakmflnfcopglcmi';
      const rakutenSelectors = [
        '#rr-style-fonts',
        '#rr-style-content',
        '[id^="rr-style-content-"]',
        'style[data-emotion^="rr"]',
        '.ebates-notification',
        '.ebates-notification-request-backdrop',
        '#rr-skip-link',
        `[src^="chrome-extension://${rakutenExtensionId}/"]`,
        `[href^="chrome-extension://${rakutenExtensionId}/"]`
      ];

      const rakutenNodes = new Set(documentCopy.querySelectorAll(rakutenSelectors.join(',')));
      for (const node of documentCopy.querySelectorAll('[aria-label*="Rakuten" i], [role="status"]')) {
        if (/rakuten/i.test(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`)) {
          rakutenNodes.add(node);
        }
      }
      rakutenNodes.forEach(node => node.remove());

      const html = documentCopy.outerHTML;
      // Chrome's script-result transport truncates a single very large string
      // (it can arrive as "IMTString(<length>): ..."). Keep every transported
      // string comfortably below that limit and rebuild it in the worker.
      const chunkSize = 64 * 1024;
      const chunks = [];
      for (let offset = 0; offset < html.length; offset += chunkSize) {
        chunks.push(html.slice(offset, offset + chunkSize));
      }
      return { chunks, length: html.length, removedRakutenNodes: rakutenNodes.size };
    },
  }), signal);
  throwIfWorkflowStopped(signal);

  const extraction = result && result.result;
  if (!extraction || !Array.isArray(extraction.chunks)) {
    throw new Error(`Failed to extract HTML from tab ${tabId}.`);
  }

  const htmlContent = extraction.chunks.join('');
  if (htmlContent.length !== extraction.length) {
    throw new Error(
      `Incomplete HTML extraction for tab ${tabId}: expected ${extraction.length} characters, received ${htmlContent.length}.`
    );
  }
  console.log(`Removed ${extraction.removedRakutenNodes || 0} Rakuten-injected node(s) before sending.`);

  // Webhook JSON Payload
  const data = {
    "page url": url,
    "page content": htmlContent
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal,
  });

  if (response.ok) {
    console.log(`Successfully sent tab: ${url}`);
  } else {
    console.error(`Failed to send tab: ${url}. Status: ${response.status}`);
  }
}


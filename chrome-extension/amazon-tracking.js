/**
 * Universal Amazon Package Tracking Page Parser
 * Standardized data extraction across all desktop & mobile Amazon tracking layouts
 * (pre-shipment, in-transit, delivered, delayed/exception, multi-order, multi-item).
 */
function parseAmazonTrackingPage() {
    function cleanText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function toAbsoluteUrl(href) {
        if (!href) return '';
        try {
            return new URL(href, window.location.origin || document.baseURI).href;
        } catch (_) {
            return href;
        }
    }

    const doc = window.document;
    const pageUrl = window.location.href;

    // Amazon includes embedded page state in an a-state JSON node
    let pageState = null;
    const pageStateNode = doc.querySelector('script[type="a-state"][data-a-state*="page-state"]');
    if (pageStateNode) {
        try {
            pageState = JSON.parse(pageStateNode.textContent || '');
        } catch (_) { }
    }

    // 1. Associated Order IDs (Strict extraction to avoid picking up Session IDs)
    const orderIdsSet = new Set();

    // Strategy A: URL query parameters
    try {
        const urlObj = new URL(pageUrl);
        const paramId = urlObj.searchParams.get('orderId') || urlObj.searchParams.get('orderID');
        if (paramId) orderIdsSet.add(paramId);
    } catch (_) { }

    // Strategy B: Anchor href attributes (Order details links, Breadcrumbs, Returns)
    doc.querySelectorAll('a[href*="orderID="], a[href*="orderId="]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (match) orderIdsSet.add(match[0]);
    });

    // Strategy C: Dedicated UI headers & containers
    doc.querySelectorAll('.widgetHeader, h4, .ordersInPackage-doubleOrders-row, #ordersInPackage-container, #breadcrumbs').forEach(el => {
        const match = el.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/g);
        if (match) match.forEach(id => orderIdsSet.add(id));
    });

    // Strategy D: Page State JSON node
    if (pageState && pageState.orderId) {
        orderIdsSet.add(String(pageState.orderId));
    }

    // Strategy E: Safe body text fallback (Excludes script/style tags to ignore JS session tokens)
    if (orderIdsSet.size === 0 && doc.body) {
        const clone = doc.body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(node => node.remove());
        const cleanBodyText = clone.textContent || '';
        const matches = cleanBodyText.match(/\b\d{3}-\d{7}-\d{7}\b/g) || [];
        matches.forEach(id => orderIdsSet.add(id));
    }

    // 2. Primary Package Status Message
    let packageStatus = '';
    const packageStatusSelectors = [
        'h1.pt-promise-main-slot',
        '#primaryStatus',
        '#primaryStatusMessage',
        '.pt-promise-message',
        '.top-banner-card .a-size-large',
        '.top-banner-card .a-size-medium',
        '.promise-card h1',
        '.status-card .a-size-large'
    ];

    for (const sel of packageStatusSelectors) {
        const el = doc.querySelector(sel);
        if (el) {
            const txt = cleanText(el.textContent);
            if (txt && txt.length > 2 && !txt.includes('Your Account') && !txt.includes('Cart') && !txt.includes('See all orders')) {
                packageStatus = txt;
                break;
            }
        }
    }
    if (!packageStatus && pageState && pageState.promise && pageState.promise.promiseMessage) {
        packageStatus = cleanText(pageState.promise.promiseMessage);
    }

    // 3. Tracking ID
    let trackingId = '';
    const trackingIdSelectors = [
        '.carrierRelatedInfo-trackingId-text',
        '.pt-delivery-card-trackingId',
        '.tracking-event-trackingId-text',
        '[data-test-id="tracking-id"]',
        '#tracking-id'
    ];

    for (const sel of trackingIdSelectors) {
        const el = doc.querySelector(sel);
        if (el) {
            const text = cleanText(el.textContent);
            const match = text.match(/(?:Tracking\s*(?:ID|Number|#)?\s*:\s*)?([A-Z0-9-]{8,35})/i);
            if (match) {
                trackingId = match[1].trim();
                break;
            }
        }
    }
    if (!trackingId && pageState && pageState.trackingId) {
        trackingId = cleanText(String(pageState.trackingId));
    }

    // 4. Carrier Name
    const carrierEl = doc.querySelector('.tracking-event-carrier-header, .delivery-card h3, #carrierRelatedInfo-container .widgetHeader');
    const carrierName = cleanText(carrierEl ? carrierEl.textContent : '');

    // 5. Normalized Delivery Status ('Ordered' | 'Shipped' | 'Out for delivery' | 'Delivered')
    let deliveryStatus = 'Ordered';
    const milestoneNodes = Array.from(doc.querySelectorAll('.pt-status-milestone'));

    if (milestoneNodes.length > 0) {
        let lastReached = '';
        for (const m of milestoneNodes) {
            const isReached = m.getAttribute('data-reached') === 'true' ||
                m.getAttribute('data-last-reached') === 'true' ||
                m.classList.contains('active') ||
                m.classList.contains('current') ||
                (m.innerHTML && m.innerHTML.includes('Complete') && !m.innerHTML.includes('Incomplete'));

            const labelNode = m.querySelector('.pt-status-milestone-label');
            const label = cleanText(labelNode ? labelNode.textContent : m.textContent);
            if (isReached && label) lastReached = label;
        }

        if (/Delivered/i.test(lastReached)) deliveryStatus = 'Delivered';
        else if (/Out for delivery/i.test(lastReached)) deliveryStatus = 'Out for delivery';
        else if (/Shipped/i.test(lastReached)) deliveryStatus = 'Shipped';
        else if (/Ordered/i.test(lastReached)) deliveryStatus = 'Ordered';
    } else {
        const docBodyText = doc.body ? doc.body.textContent : '';
        const combinedStatusText = `${packageStatus} ${carrierName} ${docBodyText}`;
        if (/\bDelivered\b/i.test(packageStatus) || /Delivered in/i.test(docBodyText)) {
            deliveryStatus = 'Delivered';
        } else if (/\bOut for delivery\b/i.test(packageStatus)) {
            deliveryStatus = 'Out for delivery';
        } else if (/\bShipped\b/i.test(combinedStatusText) || trackingId.length > 0) {
            deliveryStatus = 'Shipped';
        }
    }

    // 6. Delivery Photo URL (Proof of Delivery)
    const podImg = doc.querySelector('.photo-on-delivery-img-thumb, .photo-on-delivery-img');
    const deliveryPhotoUrl = podImg ? (podImg.getAttribute('src') || podImg.getAttribute('data-src') || '') : '';

    // 7. Items in Package (Expanded selectors for block/inline carousels & Buy-Again payload)
    const items = [];
    const seenAsins = new Set();
    const itemAnchors = Array.from(doc.querySelectorAll(
        '#promise-card-asin-image-carousel a[href*="/product/"], #promise-card-asin-image-carousel a[href*="/dp/"], ' +
        '#itemImagesCarousel-container a[href*="/product/"], #itemImagesCarousel-container a[href*="/dp/"], ' +
        '#itemImagesCarousel a[href*="/product/"], #itemImagesCarousel a[href*="/dp/"], ' +
        '.itemImagesCarouselCard a[href*="/product/"], .itemImagesCarouselCard a[href*="/dp/"], ' +
        '.itemImages-inline a[href*="/product/"], .itemImages-inline a[href*="/dp/"], ' +
        '.promise-card-carousel-container a[href*="/product/"], .promise-card-carousel-container a[href*="/dp/"], ' +
        '.image-wrapper[href*="/product/"], .image-wrapper[href*="/dp/"]'
    ));

    itemAnchors.forEach(a => {
        const href = a.getAttribute('href') || '';
        const img = a.querySelector('img');
        const asinMatch = href.match(/\/(?:dp|product)\/([A-Z0-9]{10})/i);

        if (asinMatch && !seenAsins.has(asinMatch[1])) {
            seenAsins.add(asinMatch[1]);
            const qtyNode = a.querySelector('.images-quantity-label');
            const quantity = qtyNode ? (parseInt(qtyNode.textContent.trim(), 10) || 1) : 1;

            items.push({
                asin: asinMatch[1],
                title: cleanText(img ? img.getAttribute('alt') : ''),
                quantity: quantity,
                imageUrl: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '',
                productUrl: toAbsoluteUrl(href)
            });
        }
    });

    // Fallback: Pre-shipment layouts with no item carousel -> decode Base64 payload in 'Buy again' link
    if (items.length === 0) {
        const buyAgainLink = doc.querySelector('a[href*="buyagain?ats="]');
        if (buyAgainLink) {
            try {
                const url = new URL(buyAgainLink.href, window.location.origin || 'https://www.amazon.com');
                const atsParam = url.searchParams.get('ats');
                if (atsParam) {
                    const decodedJson = JSON.parse(atob(atsParam));
                    const asins = (decodedJson.explicitCandidates || '').split(',').filter(Boolean);
                    asins.forEach(asin => {
                        if (!seenAsins.has(asin)) {
                            seenAsins.add(asin);
                            items.push({
                                asin: asin,
                                title: '',
                                quantity: 1,
                                imageUrl: '',
                                productUrl: `${window.location.origin || 'https://www.amazon.com'}/dp/${asin}`
                            });
                        }
                    });
                }
            } catch (_) { }
        }
    }

    // 8. Shipping Address & Geocode Metadata
    const addressEl = doc.querySelector('.pt-shipping-address, .shippingAddress');
    const mapAttr = doc.querySelector('.map-attributes');
    const shippingAddress = {
        fullAddress: cleanText(addressEl ? addressEl.textContent : ''),
        latitude: mapAttr ? mapAttr.getAttribute('data-address-geocode-latitude') : null,
        longitude: mapAttr ? mapAttr.getAttribute('data-address-geocode-longitude') : null
    };

    // 9. Detailed Scan Events History (Deduplicated)
    const trackingEvents = [];
    let currentDate = '';

    doc.querySelectorAll('#tracking-events-container .tracking-event-date-header, #tracking-events-container .a-row.a-spacing-large').forEach(row => {
        const dateEl = row.querySelector('.tracking-event-date');
        if (dateEl) {
            currentDate = cleanText(dateEl.textContent);
            return;
        }

        const timeEl = row.querySelector('.tracking-event-time');
        const msgEl = row.querySelector('.tracking-event-message');
        const locEl = row.querySelector('.tracking-event-location');

        if (msgEl) {
            const time = cleanText(timeEl ? timeEl.textContent : '');
            const message = cleanText(msgEl.textContent);
            const location = cleanText(locEl ? locEl.textContent : '');

            // Prevent duplicate scan records caused by nested DOM rows
            const lastEvent = trackingEvents[trackingEvents.length - 1];
            if (!lastEvent || lastEvent.date !== currentDate || lastEvent.time !== time || lastEvent.message !== message || lastEvent.location !== location) {
                trackingEvents.push({
                    date: currentDate,
                    time: time,
                    message: message,
                    location: location
                });
            }
        }
    });

    // Standardized Output Schema
    return {
        pageUrl: pageUrl,
        associatedOrderIds: Array.from(orderIdsSet),
        packageStatus: packageStatus,
        deliveryStatus: deliveryStatus,
        trackingId: trackingId,
        carrierName: carrierName,
        deliveryPhotoUrl: deliveryPhotoUrl,
        shippingAddress: shippingAddress,
        itemsInThisPackage: items,
        trackingEvents: trackingEvents
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAmazonTrackingPage };
}
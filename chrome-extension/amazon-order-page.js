/**
 * amazon-order-page.js
 * Content script for parsing Amazon "Order Details" pages.
 */

function parseAmazonOrderDetails() {
    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function extractTextWithBr(element) {
        if (!element) return null;
        const html = element.innerHTML || '';
        const cleanedHtml = html.replace(/<br\s*\/?>/gi, ' ');
        const temp = document.createElement('div');
        temp.innerHTML = cleanedHtml;
        return normalizeText(temp.textContent);
    }

    function toAbsoluteUrl(href) {
        if (!href) return null;
        try {
            return new URL(href, window.location.origin).href;
        } catch (_) {
            return href;
        }
    }

    function extractProductId(url) {
        if (!url) return null;
        const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        return match ? match[1] : null;
    }

    function getBestImageUrl(imgNode) {
        if (!imgNode) return null;
        const hires = imgNode.getAttribute('data-a-hires');
        if (hires) return hires;

        const dynamicImgAttr = imgNode.getAttribute('data-a-dynamic-image');
        if (dynamicImgAttr) {
            try {
                const parsed = JSON.parse(dynamicImgAttr);
                const urls = Object.keys(parsed);
                if (urls.length > 0) {
                    urls.sort((a, b) => (parsed[b][0] || 0) - (parsed[a][0] || 0));
                    return urls[0];
                }
            } catch (_) { }
        }
        return imgNode.getAttribute('src');
    }

    // --- 1. ORDER NUMBER ---
    let orderNumber = (window.location.href || '').match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0];

    if (!orderNumber) {
        const orderIdContainer = document.querySelector('[data-component="orderId"], .od-order-id, .yohtmlc-order-id');
        if (orderIdContainer) {
            const match = (orderIdContainer.textContent || '').match(/\b\d{3}-\d{7}-\d{7}\b/);
            if (match) orderNumber = match[0];
        }
    }

    if (!orderNumber && document.body) {
        const match = document.body.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (match) orderNumber = match[0];
    }

    if (!orderNumber) return null;

    // --- 2. ORDER DATE ---
    let orderDate = null;
    const dateContainer = document.querySelector('[data-component="orderDate"]');
    if (dateContainer) {
        const text = normalizeText(dateContainer.textContent);
        const match = text.match(/(?:[A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
        if (match) orderDate = match[0];
    }
    if (!orderDate && document.body) {
        const bodyText = normalizeText(document.body.textContent);
        const match = bodyText.match(/(?:Order placed|Order date|Placed on|Ordered on)\s*:?\s*(?:on\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
        if (match) orderDate = match[1];
    }

    // --- 3. SHIP TO ADDRESS ---
    let shipTo = null;
    const recipientPreload = document.querySelector('[data-component="shippingAddress"] .a-popover-preload, .yohtmlc-recipient .a-popover-preload');

    if (recipientPreload) {
        shipTo = extractTextWithBr(recipientPreload);
    } else {
        const addressContainer = document.querySelector('[data-component="shippingAddress"]');
        if (addressContainer) {
            shipTo = extractTextWithBr(addressContainer);
            shipTo = shipTo.replace(/^Ship to\s*/i, '').trim();
        }
    }

    // --- 4. PAYMENT METHOD ---
    let paymentMethod = null;
    const paymentContainer = document.querySelector('[data-component="viewPaymentPlanSummaryWidget"]');
    if (paymentContainer) {
        const nameNode = paymentContainer.querySelector('[data-testid="payment-instrument-name"]');
        const numberNode = paymentContainer.querySelector('[data-testid="payment-instrument-number"]');
        const prefixNode = paymentContainer.querySelector('[data-testid="payment-instrument-prefix"]');

        if (nameNode) {
            const name = normalizeText(nameNode.textContent);
            const prefix = prefixNode ? normalizeText(prefixNode.textContent) : '••••';
            const num = numberNode ? normalizeText(numberNode.textContent) : '';
            paymentMethod = `${name} ${prefix} ${num}`.trim();
        } else {
            const text = normalizeText(paymentContainer.textContent);
            paymentMethod = text.replace(/^Payment method\s*/i, '').replace(/View related transactions.*$/i, '').trim();
        }
    }

    // --- 5. CHARGE SUMMARY ---
    const summary = {
        itemSubtotal: null,
        shippingAndHandling: null,
        totalBeforeTax: null,
        tax: null,
        grandTotal: null
    };

    const summaryContainer = document.querySelector('[data-component="chargeSummary"], #od-subtotals');
    if (summaryContainer) {
        const rows = summaryContainer.querySelectorAll('.od-line-item-row, tr, .a-row');
        rows.forEach(row => {
            const labelEl = row.querySelector('.od-line-item-row-label, td:first-child');
            const valEl = row.querySelector('.od-line-item-row-content, td:last-child');
            if (!labelEl || !valEl) return;

            const label = normalizeText(labelEl.textContent).toLowerCase();
            const val = normalizeText(valEl.textContent);

            if (label.includes('item(s) subtotal')) summary.itemSubtotal = val;
            else if (label.includes('shipping') || label.includes('handling')) summary.shippingAndHandling = val;
            else if (label.includes('total before tax')) summary.totalBeforeTax = val;
            else if (label.includes('tax')) summary.tax = val;
            else if (label.includes('grand total')) summary.grandTotal = val;
        });
    }

    // --- 6. SHIPMENTS & PACKAGES ---
    const packages = [];

    // Select specific shipment boxes inside the group wrapper
    let shipmentContainers = Array.from(document.querySelectorAll(
        '[data-component="shipments"] > .a-box-group > .a-box, ' +
        '.delivery-box'
    ));

    if (shipmentContainers.length === 0) {
        const fallbackContainers = new Set();
        document.querySelectorAll('[data-component="purchasedItems"], [data-component="purchasedItemsLeftGrid"]')
            .forEach(itemsNode => fallbackContainers.add(itemsNode.closest('.a-box-group > .a-box, .delivery-box') || itemsNode));
        shipmentContainers = Array.from(fallbackContainers);
    }

    shipmentContainers.forEach((shipmentBox, boxIndex) => {
        const statusNode = shipmentBox.querySelector('[data-component="shipmentStatus"] .od-status-message, [data-component="shipmentStatus"], .yohtmlc-shipment-status-primaryText');
        const estDeliveryDate = statusNode ? normalizeText(statusNode.textContent) : null;

        const trackingLinkNode = shipmentBox.querySelector(
            '[data-component="shipmentConnections"] a[href*="progress-tracker"], ' +
            'a[href*="progress-tracker"], a[href*="ship-track"]'
        );
        const trackingLink = trackingLinkNode ? toAbsoluteUrl(trackingLinkNode.getAttribute('href')) : null;

        let packageId = null;
        if (trackingLink) {
            try {
                const parsedUrl = new URL(trackingLink, window.location.origin);
                packageId = parsedUrl.searchParams.get('shipmentId') ||
                    parsedUrl.searchParams.get('packageId') ||
                    parsedUrl.searchParams.get('trackingId') ||
                    parsedUrl.searchParams.get('itemId');
            } catch (_) { }
        }
        if (!packageId) {
            packageId = `${orderNumber}-pkg-${boxIndex + 1}`;
        }

        const items = [];
        const itemWrappers = shipmentBox.querySelectorAll('.a-fixed-left-grid-inner, .item-box');

        itemWrappers.forEach(itemRow => {
            let titleNode = itemRow.querySelector('[data-component="itemTitle"] a, .yohtmlc-product-title a, a[href*="/dp/"], a[href*="/gp/product/"]');

            if (titleNode && titleNode.querySelector('img')) {
                const allLinks = Array.from(itemRow.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]'));
                titleNode = allLinks.find(a => !a.querySelector('img')) || titleNode;
            }

            const imgNode = itemRow.querySelector('[data-component="itemImage"] img, .product-image img, img');
            const priceNode = itemRow.querySelector('[data-component="unitPrice"] .a-offscreen, [data-component="unitPrice"]');
            const merchantNode = itemRow.querySelector('[data-component="orderedMerchant"]');
            const qtyNode = itemRow.querySelector('.od-item-view-qty, .product-image__qty, .item-view-qty, [data-component="quantity"]');

            if (titleNode || imgNode) {
                const name = titleNode ? normalizeText(titleNode.textContent) : normalizeText(imgNode.getAttribute('alt'));
                const imageLink = imgNode ? imgNode.closest('a') : null;
                const productHref = titleNode ? titleNode.getAttribute('href') : (imageLink ? imageLink.getAttribute('href') : null);
                const productAbsUrl = productHref ? toAbsoluteUrl(productHref) : null;

                let seller = null;
                if (merchantNode) {
                    const sellerLink = merchantNode.querySelector('a');
                    seller = sellerLink ? normalizeText(sellerLink.textContent) : normalizeText(merchantNode.textContent).replace(/^Sold by:\s*/i, '');
                }

                let quantity = 1;
                if (qtyNode) {
                    const parsedQty = parseInt((qtyNode.textContent || '').replace(/\D/g, ''), 10);
                    if (!isNaN(parsedQty) && parsedQty > 0) quantity = parsedQty;
                }

                let price = null;
                if (priceNode) {
                    const priceMatch = normalizeText(priceNode.textContent).match(/\$\d+(?:\.\d{2})?/);
                    if (priceMatch) price = priceMatch[0];
                }

                const rawImageUrl = getBestImageUrl(imgNode);
                if (name || extractProductId(productAbsUrl || productHref)) {
                    items.push({
                        name: name,
                        productId: extractProductId(productAbsUrl || productHref),
                        productLink: productAbsUrl,
                        image: rawImageUrl ? toAbsoluteUrl(rawImageUrl) : null,
                        quantity: quantity,
                        price: price,
                        seller: seller
                    });
                }
            }
        });

        if (items.length > 0) {
            packages.push({
                id: packageId,
                estDeliveryDate: estDeliveryDate,
                trackingLink: trackingLink,
                items: items
            });
        }
    });

    return {
        number: orderNumber,
        date: orderDate,
        shipTo: shipTo,
        paymentMethod: paymentMethod,
        summary: summary,
        packages: packages
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAmazonOrderDetails };
}
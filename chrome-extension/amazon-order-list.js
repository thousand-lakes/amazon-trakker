/**
 * Parses Amazon Order pages and extracts order, package, and product details.
 * Call this function from your content script once the DOM is fully rendered.
 */
function parseAmazonOrders() {
    const ordersData = [];

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    // Amazon has used all of these labels in different versions of the orders page.
    const orderDateLabelPattern = '(?:Order\\s+placed|Order\\s+date|Placed\\s+on|Ordered\\s+on|Ordered)';
    const dateValuePattern = '(?:[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4})';

    function findDate(value, requireOrderLabel) {
        const text = normalizeText(value);
        const pattern = requireOrderLabel
            ? new RegExp(`${orderDateLabelPattern}\\s*:?\\s*(?:on\\s+)?(${dateValuePattern})`, 'i')
            : new RegExp(`\\b(${dateValuePattern})\\b`, 'i');
        const match = text.match(pattern);
        return match ? match[1].trim() : null;
    }

    // Helper to resolve absolute URLs
    function toAbsoluteUrl(href) {
        if (!href) return null;
        try {
            return new URL(href, window.location.origin).href;
        } catch (_) {
            return href;
        }
    }

    // Select all order cards on the page (supports various Amazon DOM versions)
    const orderCards = document.querySelectorAll('.order-card, .order, .js-order-card, [id^="orderCard"], .your-orders-card');

    orderCards.forEach(card => {
        // --- 1. ORDER LEVEL DATA ---
        // Extract order number (must match Amazon order number pattern \d{3}-\d{7}-\d{7})
        let orderNumber = null;

        // 1. Check data-csa-c-slot-id attribute (e.g. amzn1.yourorders.order-card.113-9267098-9983451)
        const slotId = card.getAttribute('data-csa-c-slot-id') || '';
        const slotMatch = slotId.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (slotMatch) {
            orderNumber = slotMatch[0];
        }

        // 2. Check dedicated order ID container
        if (!orderNumber) {
            const orderIdContainer = card.querySelector('.yohtmlc-order-id, .yohtmlc-order-number');
            if (orderIdContainer) {
                const text = orderIdContainer.textContent || '';
                const match = text.match(/\b\d{3}-\d{7}-\d{7}\b/);
                if (match) orderNumber = match[0];
            }
        }

        // 3. Check order details links
        if (!orderNumber) {
            const detailsLinkNode = card.querySelector('a[href*="orderID="], a[href*="orderId="]');
            if (detailsLinkNode) {
                const href = detailsLinkNode.getAttribute('href') || '';
                const match = href.match(/orderID=([0-9-]{17,})/i);
                if (match) orderNumber = match[1];
            }
        }

        // 4. Fallback search across card text
        if (!orderNumber && card.textContent) {
            const match = card.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/);
            if (match) orderNumber = match[0];
        }

        // Skip invalid/empty cards without a recognized order number
        if (!orderNumber) return;

        // Extract order date
        let orderDate = null;
        const dateContainer = card.querySelector('.yohtmlc-order-date, [data-order-date]');
        if (dateContainer) {
            const dateAttribute = dateContainer.getAttribute('data-order-date') ||
                                  dateContainer.getAttribute('datetime');
            orderDate = findDate(dateAttribute, false) ||
                        findDate(dateContainer.textContent, false);
        }

        if (!orderDate) {
            const orderHeader = card.querySelector('.order-header, .yohtmlc-order-header, [data-component="order-header"]');
            if (orderHeader) {
                // Reading the complete header handles layouts where the label and value
                // are in sibling elements instead of two `.a-row` elements.
                orderDate = findDate(orderHeader.textContent, true) ||
                            findDate(orderHeader.textContent, false);

                if (!orderDate) {
                    const timeNode = orderHeader.querySelector('time[datetime]');
                    if (timeNode) {
                        orderDate = findDate(timeNode.getAttribute('datetime'), false) ||
                                    normalizeText(timeNode.textContent) || null;
                    }
                }
            }
        }

        if (!orderDate && card.textContent) {
            orderDate = findDate(card.textContent, true);
        }

        // Order details link
        const orderDetailsLinkNode = card.querySelector('a[href*="/order-details"], a[href*="order-details"], a[href*="your-orders/order-details"], .yohtmlc-order-details-link a');
        const orderDetailsLink = orderDetailsLinkNode ? toAbsoluteUrl(orderDetailsLinkNode.getAttribute('href')) : null;

        const orderInfo = {
            number: orderNumber,
            date: orderDate,
            orderDetailsLink: orderDetailsLink,
            packages: []
        };

        // --- 2. PACKAGE LEVEL DATA ---
        let deliveryBoxes = Array.from(card.querySelectorAll('.delivery-box, .shipment, [data-component="shipment"]'));

        if (deliveryBoxes.length === 0) {
            deliveryBoxes = [card];
        }

        deliveryBoxes.forEach((box, boxIndex) => {
            const estimationNode = box.querySelector('.delivery-box__primary-text, .yohtmlc-shipment-status-primaryText, .delivery-box .a-size-medium, .js-shipment-status, .delivery-status-message, .shipment-status-title') ||
                                   card.querySelector('.delivery-box__primary-text, .yohtmlc-shipment-status-primaryText, .delivery-box .a-size-medium, .js-shipment-status, .delivery-status-message');
            const trackingLinkNode = box.querySelector('a[href*="ship-track"], a[href*="progress-tracker"], a[href*="tracking"]') ||
                                     card.querySelector('a[href*="ship-track"], a[href*="progress-tracker"], a[href*="tracking"]');

            const trackingLink = trackingLinkNode ? toAbsoluteUrl(trackingLinkNode.getAttribute('href')) : null;
            const arrivingEstimation = estimationNode ? (estimationNode.textContent || '').replace(/\s+/g, ' ').trim() : null;

            // Package ID extraction: prioritize itemId, shipmentId, packageId, trackingId from tracking link
            let packageId = null;
            if (trackingLink) {
                try {
                    const parsedUrl = new URL(trackingLink, window.location.origin);
                    packageId = parsedUrl.searchParams.get('itemId') ||
                                parsedUrl.searchParams.get('shipmentId') ||
                                parsedUrl.searchParams.get('packageId') ||
                                parsedUrl.searchParams.get('trackingId');
                } catch (_) {
                    const match = trackingLink.match(/(?:itemId|shipmentId|packageId|trackingId)=([^&]+)/i);
                    if (match && match[1]) {
                        packageId = decodeURIComponent(match[1]).trim();
                    }
                }
            }

            if (!packageId && box !== card) {
                packageId = box.getAttribute('data-shipment-id') ||
                            box.getAttribute('data-package-id') ||
                            box.getAttribute('data-item-id') ||
                            (box.dataset && (box.dataset.shipmentId || box.dataset.packageId || box.dataset.itemId)) ||
                            (box.id && !box.id.startsWith('delivery-box-') && box.id.length > 3 ? box.id.trim() : null);
            }

            if (!packageId) {
                packageId = `${orderNumber}-pkg-${boxIndex + 1}`;
            }

            const packageItems = [];

            // --- 3. PRODUCT / ITEM LEVEL DATA ---
            // A shipment can mix standard, carousel, and flex cards. Collect every
            // layout rather than choosing one and silently dropping the others.
            const itemSelector = '.yo-enhanced-card, .yo-enhanced-flex-card, .item-box, .yo-enhanced-items, .yohtmlc-item';
            const itemCandidates = Array.from(box.querySelectorAll(itemSelector));
            const itemElements = itemCandidates.length > 0
                // Keep leaf item containers only when Amazon nests one supported
                // container inside another; this avoids emitting the same product twice.
                ? itemCandidates.filter(candidate => !candidate.querySelector(itemSelector))
                : [box];

            itemElements.forEach(item => {
                const nameNode = item.querySelector('.yohtmlc-product-title a, .yo-enhanced-title a, a[href*="/dp/"], a[href*="/gp/product/"]');
                const imgNode = item.querySelector('img[data-a-hires], img.yo-critical-feature, img');
                const qtyNode = item.querySelector('.item-view-qty, .yohtmlc-item-quantity, .yohtmlc-item-count');

                let name = '';
                if (nameNode) {
                    name = (nameNode.textContent || '').replace(/\s+/g, ' ').trim();
                }
                if (!name && imgNode) {
                    name = (imgNode.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
                }

                if (nameNode || imgNode) {
                    let quantity = 1;
                    if (qtyNode) {
                        const parsedQty = parseInt((qtyNode.textContent || '').replace(/\D/g, ''), 10);
                        if (!isNaN(parsedQty) && parsedQty > 0) {
                            quantity = parsedQty;
                        }
                    } else if (item.textContent) {
                        const textMatch = item.textContent.replace(/\s+/g, ' ').match(/(?:Qty|Quantity):\s*(\d+)/i);
                        if (textMatch && textMatch[1]) {
                            const parsedQty = parseInt(textMatch[1], 10);
                            if (!isNaN(parsedQty) && parsedQty > 0) {
                                quantity = parsedQty;
                            }
                        }
                    }

                    const imageLink = imgNode ? (imgNode.getAttribute('data-a-hires') || imgNode.getAttribute('src')) : null;
                    const productLink = nameNode ? toAbsoluteUrl(nameNode.getAttribute('href')) : (imgNode && imgNode.closest('a') ? toAbsoluteUrl(imgNode.closest('a').getAttribute('href')) : null);

                    packageItems.push({
                        name: name,
                        image: imageLink ? toAbsoluteUrl(imageLink) : null,
                        quantity: quantity,
                        productLink: productLink
                    });
                }
            });

            const packageInfo = {
                id: packageId,
                estDeliveryDate: arrivingEstimation,
                trackingLink: trackingLink,
                orderDetailsLink: orderDetailsLink,
                items: packageItems
            };

            orderInfo.packages.push(packageInfo);
        });

        ordersData.push(orderInfo);
    });

    return ordersData;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAmazonOrders };
}

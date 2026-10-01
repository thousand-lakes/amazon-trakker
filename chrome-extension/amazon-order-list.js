function parseAmazonOrders() {
    const ordersData = [];

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function extractTextWithBr(element) {
        if (!element) return null;
        // Replace <br> tags with spaces before reading textContent to preserve line breaks
        const html = element.innerHTML || '';
        const cleanedHtml = html.replace(/<br\s*\/?>/gi, ' ');
        const temp = document.createElement('div');
        temp.innerHTML = cleanedHtml;
        return normalizeText(temp.textContent);
    }

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

    function extractProductId(url) {
        if (!url) return null;
        const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        return match ? match[1] : null;
    }

    function toAbsoluteUrl(href) {
        if (!href) return null;
        try {
            return new URL(href, window.location.origin).href;
        } catch (_) {
            return href;
        }
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

    const orderCards = document.querySelectorAll('.order-card, .order, .js-order-card, [id^="orderCard"], .your-orders-card');

    orderCards.forEach(card => {
        // --- 1. ORDER LEVEL DATA ---
        let orderNumber = null;

        const slotId = card.getAttribute('data-csa-c-slot-id') || '';
        const slotMatch = slotId.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (slotMatch) {
            orderNumber = slotMatch[0];
        }

        if (!orderNumber) {
            const orderIdContainer = card.querySelector('.yohtmlc-order-id, .yohtmlc-order-number');
            if (orderIdContainer) {
                const match = (orderIdContainer.textContent || '').match(/\b\d{3}-\d{7}-\d{7}\b/);
                if (match) orderNumber = match[0];
            }
        }

        if (!orderNumber) {
            const detailsLinkNode = card.querySelector('a[href*="orderID="], a[href*="orderId="]');
            if (detailsLinkNode) {
                const href = detailsLinkNode.getAttribute('href') || '';
                const match = href.match(/orderID=([0-9-]{17,})/i);
                if (match) orderNumber = match[1];
            }
        }

        if (!orderNumber && card.textContent) {
            const match = card.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/);
            if (match) orderNumber = match[0];
        }

        if (!orderNumber) return;

        // --- Order Date ---
        let orderDate = null;
        const dateContainer = card.querySelector('.yohtmlc-order-date, [data-order-date]');
        if (dateContainer) {
            const dateAttribute = dateContainer.getAttribute('data-order-date') || dateContainer.getAttribute('datetime');
            orderDate = findDate(dateAttribute, false) || findDate(dateContainer.textContent, false);
        }

        if (!orderDate) {
            const orderHeader = card.querySelector('.order-header, .yohtmlc-order-header, [data-component="order-header"]');
            if (orderHeader) {
                const dateListItem = Array.from(orderHeader.querySelectorAll('.order-header__header-list-item'))
                    .find(item => /Order\s+placed/i.test(item.textContent));

                if (dateListItem) {
                    orderDate = findDate(dateListItem.textContent, false);
                }

                if (!orderDate) {
                    orderDate = findDate(orderHeader.textContent, true) || findDate(orderHeader.textContent, false);
                }
            }
        }

        if (!orderDate && card.textContent) {
            orderDate = findDate(card.textContent, true);
        }

        // --- Ship To Address ---
        let shipTo = null;
        const recipientPreload = card.querySelector('.yohtmlc-recipient .a-popover-preload, .yohtmlc-recipient [id*="popover-shippingAddress"]');
        if (recipientPreload) {
            shipTo = extractTextWithBr(recipientPreload);
        } else {
            const recipientContainer = card.querySelector('.yohtmlc-recipient');
            if (recipientContainer) {
                shipTo = normalizeText(recipientContainer.textContent);
            }
        }

        const orderDetailsLinkNode = card.querySelector('a[href*="/order-details"], a[href*="order-details"], a[href*="your-orders/order-details"], .yohtmlc-order-details-link a');
        const orderDetailsLink = orderDetailsLinkNode ? toAbsoluteUrl(orderDetailsLinkNode.getAttribute('href')) : null;

        const orderInfo = {
            number: orderNumber,
            date: orderDate,
            shipTo: shipTo,
            orderDetailsLink: orderDetailsLink,
            packages: []
        };

        // --- 2. PACKAGE LEVEL DATA ---
        let deliveryBoxes = Array.from(card.querySelectorAll('.delivery-box, .shipment, [data-component="shipment"]'));

        if (deliveryBoxes.length === 0) {
            deliveryBoxes = [card];
        }

        deliveryBoxes.forEach((box, boxIndex) => {
            const estimationNode = box.querySelector('.delivery-box__primary-text, .yohtmlc-shipment-status-primaryText, .delivery-box .a-size-medium, .js-shipment-status, .delivery-status-message, .shipment-status-title');
            const trackingLinkNode = box.querySelector('a[href*="ship-track"], a[href*="progress-tracker"], a[href*="tracking"]');

            const trackingLink = trackingLinkNode ? toAbsoluteUrl(trackingLinkNode.getAttribute('href')) : null;
            const arrivingEstimation = estimationNode ? normalizeText(estimationNode.textContent) : null;

            let packageId = null;
            if (trackingLink) {
                try {
                    const parsedUrl = new URL(trackingLink, window.location.origin);
                    packageId = parsedUrl.searchParams.get('shipmentId') ||
                        parsedUrl.searchParams.get('packageId') ||
                        parsedUrl.searchParams.get('trackingId') ||
                        parsedUrl.searchParams.get('itemId');
                } catch (_) {
                    const match = trackingLink.match(/(?:shipmentId|packageId|trackingId|itemId)=([^&]+)/i);
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
            const itemSelector = '.yo-enhanced-card, .yo-enhanced-flex-card, .item-box, .yo-enhanced-items, .yohtmlc-item';
            const itemCandidates = Array.from(box.querySelectorAll(itemSelector));
            const itemElements = itemCandidates.length > 0
                ? itemCandidates.filter(candidate => !candidate.querySelector(itemSelector))
                : [box];

            itemElements.forEach(item => {
                let nameNode = item.querySelector('.yohtmlc-product-title a, .yo-enhanced-title a');
                if (!nameNode) {
                    const allLinks = Array.from(item.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]'));
                    nameNode = allLinks.find(a => !a.querySelector('img') && !a.closest('.product-image')) || allLinks[0];
                }

                const imgNode = item.querySelector('img[data-a-hires], img[data-a-dynamic-image], img.yo-critical-feature, img');
                const qtyNode = item.querySelector('.product-image__qty, .item-view-qty, .yohtmlc-item-quantity, .yohtmlc-item-count');

                let name = '';
                if (nameNode) {
                    name = normalizeText(nameNode.textContent);
                }
                if (!name && imgNode) {
                    name = normalizeText(imgNode.getAttribute('alt'));
                }

                if (nameNode || imgNode) {
                    let quantity = 1;
                    if (qtyNode) {
                        const parsedQty = parseInt((qtyNode.textContent || '').replace(/\D/g, ''), 10);
                        if (!isNaN(parsedQty) && parsedQty > 0) {
                            quantity = parsedQty;
                        }
                    } else if (item.textContent) {
                        const textMatch = item.textContent.replace(/\s+/g, ' ').match(/(?:Qty|Quantity)[\s:]*(\d+)|\b(\d+)\s+of\b/i);
                        const matchedVal = textMatch ? (textMatch[1] || textMatch[2]) : null;
                        if (matchedVal) {
                            const parsedQty = parseInt(matchedVal, 10);
                            if (!isNaN(parsedQty) && parsedQty > 0) {
                                quantity = parsedQty;
                            }
                        }
                    }

                    const rawImgUrl = getBestImageUrl(imgNode);
                    const productHref = nameNode
                        ? nameNode.getAttribute('href')
                        : (imgNode && imgNode.closest('a') ? imgNode.closest('a').getAttribute('href') : null);

                    const productAbsUrl = productHref ? toAbsoluteUrl(productHref) : null;

                    packageItems.push({
                        name: name,
                        image: rawImgUrl ? toAbsoluteUrl(rawImgUrl) : null,
                        quantity: quantity,
                        productLink: productAbsUrl,
                        productId: extractProductId(productAbsUrl || productHref)
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
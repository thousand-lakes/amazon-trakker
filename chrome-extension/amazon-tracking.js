/**
 * Parses Amazon tracking pages (https://www.amazon.com/gp/your-account/ship-track*)
 * Supports multiple layouts (with and without milestone timelines).
 */
function parseAmazonTrackingPage() {
    function cleanText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function toAbsoluteUrl(href) {
        if (!href) return '';
        try {
            return new URL(href, document.baseURI || window.location.href).href;
        } catch (_) {
            return href;
        }
    }

    const pageUrl = window.location.href;

    // Amazon includes the same data used to render both tracking layouts in
    // this state node. It is a useful fallback while the visible DOM is still
    // loading or when Amazon changes a presentation-only class name.
    let pageState = null;
    const pageStateNode = document.querySelector('script[type="a-state"][data-a-state*="page-state"]');
    if (pageStateNode) {
        try {
            pageState = JSON.parse(pageStateNode.textContent || '');
        } catch (_) {}
    }

    // 1. Order ID from URL query parameters (fallback to body text)
    let orderId = '';
    try {
        const urlObj = new URL(pageUrl);
        orderId = urlObj.searchParams.get('orderId') || urlObj.searchParams.get('orderID') || '';
    } catch (_) {}

    if (!orderId && pageState && pageState.orderId) {
        orderId = String(pageState.orderId);
    }
    if (!orderId && document.body) {
        const match = document.body.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (match) {
            orderId = match[0];
        }
    }

    // 2. Package Status
    let packageStatus = '';
    const statusSelectors = [
        'h1.pt-promise-main-slot',
        '#primaryStatus',
        '#primaryStatusMessage',
        '.pt-promise-message',
        '.top-banner-card .a-size-large',
        '.top-banner-card .a-size-medium',
        '.promise-card .a-size-large',
        '.promise-card .a-size-medium',
        '.promise-card h1',
        '.status-card .a-size-large',
        '.status-card .a-size-medium',
        '.pt-delivery-card-header .a-size-large',
        '.pt-delivery-card-header .a-size-medium',
        '.js-shipment-status',
        '.delivery-status-message'
    ];

    for (const sel of statusSelectors) {
        const el = document.querySelector(sel);
        if (el) {
            const txt = cleanText(el.textContent);
            if (txt && txt.length > 2 && !txt.includes('Your Account') && !txt.includes('Cart') && !txt.includes('See all orders')) {
                packageStatus = txt;
                break;
            }
        }
    }
    if (!packageStatus && pageState && pageState.promise) {
        packageStatus = cleanText(pageState.promise.promiseMessage);
    }

    // 3. Tracking ID (empty string if unavailable)
    let trackingId = '';
    const trackingIdSelectors = [
        '.carrierRelatedInfo-trackingId-text',
        '.pt-delivery-card-trackingId',
        '.tracking-event-trackingId-text',
        '[data-test-id="tracking-id"]',
        '#tracking-id'
    ];

    for (const sel of trackingIdSelectors) {
        const el = document.querySelector(sel);
        if (el) {
            const text = cleanText(el.textContent);
            const match = text.match(/Tracking\s*(?:ID|Number|#)?\s*:\s*(.+)$/i) || text.match(/\b([A-Z0-9][A-Z0-9-]{7,})\b/i);
            if (match) {
                trackingId = (match[1] || match[0]).trim();
                break;
            }
        }
    }

    if (!trackingId && pageState && pageState.trackingId) {
        trackingId = cleanText(String(pageState.trackingId));
    }

    // 4. Order Status if timeline available: strongly one of 'Ordered', 'Shipped', 'Out for delivery', 'Delivered'
    let orderStatus = '';
    const milestoneNodes = Array.from(document.querySelectorAll('.pt-status-milestone'));
    if (milestoneNodes.length > 0) {
        let lastReachedMilestone = cleanText(document.querySelector('.pt-status-main-status')?.textContent);
        for (const m of milestoneNodes) {
            const isReached = m.getAttribute('data-reached') === 'true' ||
                              m.getAttribute('data-last-reached') === 'true' ||
                              m.classList.contains('pt-status-milestone-current') ||
                              m.classList.contains('current') ||
                              m.classList.contains('active') ||
                              (m.innerHTML && m.innerHTML.includes('Complete') && !m.innerHTML.includes('Incomplete'));

            const label = m.querySelector('.pt-status-milestone-label');
            const labelText = cleanText(label ? label.textContent : m.textContent);

            if (isReached && labelText) {
                lastReachedMilestone = labelText;
            }
        }

        if (/Delivered/i.test(lastReachedMilestone)) orderStatus = 'Delivered';
        else if (/Out for delivery/i.test(lastReachedMilestone)) orderStatus = 'Out for delivery';
        else if (/Shipped/i.test(lastReachedMilestone)) orderStatus = 'Shipped';
        else if (/Ordered/i.test(lastReachedMilestone)) orderStatus = 'Ordered';
    }

    // 5. Array of product links
    const productLinks = [];
    const linkSelectors = [
        'a[href*="/gp/product/"][href*="ppx_pt2_dt_b_prod_image"]',
        'a[href*="/dp/"][href*="ppx_pt2_dt_b_prod_image"]',
        '.promise-card-carousel-container a[href*="/product/"], .promise-card-carousel-container a[href*="/dp/"]',
        '.itemImages-inline a[href*="/product/"], .itemImages-inline a[href*="/dp/"]',
        '.itemImagesCarouselCard a[href*="/product/"], .itemImagesCarouselCard a[href*="/dp/"]',
        '#promise-card-asin-image-carousel a[href*="/product/"], #promise-card-asin-image-carousel a[href*="/dp/"]',
        '.pt-card.promise-card a.image-wrapper'
    ];

    const foundAnchors = Array.from(document.querySelectorAll(linkSelectors.join(', ')));

    // Fallback: search primary cards avoiding recommendation carousels / footers
    if (foundAnchors.length === 0) {
        const candidateAnchors = Array.from(document.querySelectorAll('.pt-card a[href*="/product/"], .pt-card a[href*="/dp/"], .top-banner-card a[href*="/product/"], .top-banner-card a[href*="/dp/"]'))
            .filter(a => {
                const href = a.getAttribute('href') || '';
                const insideExcluded = a.closest('.a-carousel, #rhf, [class*="recommendation"], [id*="recommendation"], #nav-subnav, #nav-main, #nav-footer, .nav_a, .rhf-border');
                return !insideExcluded && !href.includes('plattr=') && !href.includes('wlr_d_sccl') && !href.includes('feedback');
            });
        foundAnchors.push(...candidateAnchors);
    }

    foundAnchors.forEach(a => {
        const href = a.getAttribute('href');
        if (href) {
            const fullUrl = toAbsoluteUrl(href);
            if (fullUrl && !productLinks.includes(fullUrl)) {
                productLinks.push(fullUrl);
            }
        }
    });

    return {
        orderId: orderId,
        packageStatus: packageStatus,
        trackingId: trackingId,
        orderStatus: orderStatus,
        productLinks: productLinks
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAmazonTrackingPage };
}

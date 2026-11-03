/* Zebra Domus Inn: moving around the site without the page sliding by itself.

   1. Booking buttons ("Check availability", "Book Your Stay", "Book now", "Book this room")
      open the booking page (book.html), taking the dates, guests and room the guest already
      chose, for example book.html?room=deluxe-room&in=2026-11-20&out=2026-11-23&guests=2.
      The browser's Back button brings the guest back to where they were.
   2. Menu and quick links (Rooms, About, Photos, Find us…) go straight to that part of the
      page with a short fade, instead of a long visible scroll. The top bar stays in place.
   Guests who ask their phone for less motion get the jump without the fade. */
(function () {
    "use strict";

    var FADE_OUT = 140; /* milliseconds; matches .is-leaving in style.css */

    function byId(id) { return document.getElementById(id); }

    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /* ---------- 1. booking page links ---------- */

    /* book.html plus whatever the guest has already chosen */
    function bookingUrl(roomId) {
        var params = [];
        var checkIn = byId("checkIn");
        var checkOut = byId("checkOut");
        var guests = byId("guests");
        if (roomId) params.push("room=" + encodeURIComponent(roomId));
        if (checkIn && checkIn.value) params.push("in=" + encodeURIComponent(checkIn.value));
        if (checkOut && checkOut.value) params.push("out=" + encodeURIComponent(checkOut.value));
        if (guests && guests.value) params.push("guests=" + encodeURIComponent(guests.value));
        return "book.html" + (params.length ? "?" + params.join("&") : "");
    }

    /* used by script.js ("Book now") and room-details.js ("Book this room") */
    window.zdBookingUrl = bookingUrl;
    window.zdGoToBooking = function (roomId) { window.location.href = bookingUrl(roomId); };

    /* ---------- 2. same-page links ---------- */

    function headerOffset() {
        var padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
        return isFinite(padding) ? padding : 0;
    }

    function arrive(target, hash) {
        var top = target.id === "home" ? 0 : target.getBoundingClientRect().top + window.scrollY - headerOffset();
        window.scrollTo(0, Math.max(0, Math.round(top)));
        try { history.pushState(null, "", hash); } catch (error) { /* the address just doesn't change */ }
        /* move keyboard focus there too, without another scroll */
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
    }

    function jumpTo(target, hash) {
        var root = document.documentElement;
        if (reduceMotion()) { arrive(target, hash); return; }
        root.classList.add("is-leaving");
        setTimeout(function () {
            arrive(target, hash);
            /* fade back in on the next frame, at the new place */
            requestAnimationFrame(function () { root.classList.remove("is-leaving"); });
        }, FADE_OUT);
    }

    document.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        var link = event.target.closest("a[href]");
        if (!link || link.closest("dialog")) return;
        var href = link.getAttribute("href");

        /* booking page: add the stay the guest already chose */
        if (/^book\.html(\?.*)?$/.test(href) && href.indexOf("?") === -1) {
            event.preventDefault();
            window.location.href = bookingUrl(link.dataset.room || "");
            return;
        }

        /* a part of this page */
        if (href.charAt(0) === "#" && href.length > 1) {
            var target = byId(decodeURIComponent(href.slice(1)));
            if (!target) return;
            event.preventDefault();
            jumpTo(target, href);
        }
    });
})();

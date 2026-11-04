/* Zebra Dormus Inn: Marriott-style extras at the top of the page.
   1. The quick links along the bottom of the photo (shown on computers) follow the
      language chosen in the header.
   2. On a computer, once the guest has scrolled past the search box, a slim white
      search bar (dates, guests, "Check availability") takes the top bar's place while
      they scroll down; scrolling up brings the menu back. The bar uses the same dates
      and guests as the search box, so everything stays in step. */
(function () {
    "use strict";

    var TEXT = {
        en: { rooms: "Rooms", amenities: "At the inn", photos: "Photos", policies: "Good to know", contact: "Find us", links: "Explore the inn", bar: "Search rooms" },
        rw: { rooms: "Ibyumba", amenities: "Serivisi", photos: "Amafoto", policies: "Ibyo ukwiye kumenya", contact: "Aho turi", links: "Menya icumbi", bar: "Shaka icyumba" },
        fr: { rooms: "Chambres", amenities: "Services", photos: "Photos", policies: "Bon à savoir", contact: "Nous trouver", links: "Découvrir l'auberge", bar: "Rechercher une chambre" }
    };

    var DESKTOP = "(min-width: 1024px)";

    function byId(id) { return document.getElementById(id); }

    function el(tag, className) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    }

    function lang() {
        var select = byId("languageSelect");
        var value = (select && select.value) || "en";
        return TEXT[value] ? value : "en";
    }

    /* ---------- 1. quick links ---------- */

    function labelLinks() {
        var t = TEXT[lang()];
        var nav = document.querySelector(".hero-links");
        if (!nav) return;
        nav.setAttribute("aria-label", t.links);
        Array.prototype.forEach.call(nav.querySelectorAll("a[data-link]"), function (link) {
            var span = link.querySelector("span");
            if (span && t[link.dataset.link]) span.textContent = t[link.dataset.link];
        });
    }

    /* ---------- 2. sticky search bar (computers) ---------- */

    var bar = null;
    var parts = {};

    function buildBar() {
        var mainGuests = byId("guests");
        var mainButton = document.querySelector(".search-card .btn");
        if (!mainGuests || !mainButton || !window.ZDDateRange) return;

        bar = el("div", "sticky-search");
        bar.setAttribute("role", "search");
        var inner = el("div", "sticky-search-inner");

        var logo = document.querySelector(".header .logo");
        var logoCopy = logo ? logo.cloneNode(true) : null;
        if (logoCopy) logoCopy.classList.add("sticky-search-logo");

        var dates = window.ZDDateRange.makeTrigger();

        var guestsField = el("div", "search-field sticky-guests");
        var guestsLabel = el("label");
        guestsLabel.htmlFor = "stickyGuests";
        var control = el("span", "control");
        var guests = el("select");
        guests.id = "stickyGuests";
        var mainControl = mainGuests.parentNode;
        var icons = mainControl.querySelectorAll("svg");
        if (icons[0]) control.appendChild(icons[0].cloneNode(true));
        control.appendChild(guests);
        if (icons[1]) control.appendChild(icons[1].cloneNode(true));
        guestsField.append(guestsLabel, control);

        var button = el("a", "btn btn-primary sticky-search-button");
        button.href = mainButton.getAttribute("href") || "#rooms";

        inner.append(logoCopy || el("span"), dates, guestsField, button);
        bar.appendChild(inner);
        document.body.appendChild(bar);
        parts = { guests: guests, guestsLabel: guestsLabel, button: button, mainGuests: mainGuests, mainButton: mainButton };

        guests.addEventListener("change", function () {
            mainGuests.value = guests.value;
            mainGuests.dispatchEvent(new Event("change", { bubbles: true }));
        });
        mainGuests.addEventListener("change", function () { guests.value = mainGuests.value; });

        fillBar();
        show(false);
    }

    /* copy the words from the search box, so the bar is always in the chosen language */
    function fillBar() {
        if (!bar) return;
        var mainLabel = document.querySelector('label[for="guests"]');
        parts.guestsLabel.textContent = mainLabel ? mainLabel.textContent : "Guests";
        parts.guests.replaceChildren.apply(parts.guests, Array.prototype.map.call(parts.mainGuests.options, function (option) {
            var copy = el("option");
            copy.value = option.value;
            copy.textContent = option.textContent;
            return copy;
        }));
        parts.guests.value = parts.mainGuests.value;
        parts.button.textContent = parts.mainButton.textContent;
        bar.setAttribute("aria-label", TEXT[lang()].bar);
    }

    var shown = false;
    function show(on) {
        if (!bar) return;
        if (on === shown && bar.hasAttribute("aria-hidden")) return;
        shown = on;
        document.documentElement.classList.toggle("sticky-search-on", on);
        bar.setAttribute("aria-hidden", on ? "false" : "true");
        bar.inert = !on;
    }

    var lastY = 0;
    var ticking = false;
    function onScroll() {
        ticking = false;
        var y = window.scrollY;
        var card = document.querySelector(".search-card");
        var past = window.matchMedia(DESKTOP).matches && card && card.getBoundingClientRect().bottom < 0;
        if (!past) show(false);
        else if (y > lastY + 4) show(true);   /* scrolling down: search bar */
        else if (y < lastY - 4) show(false);  /* scrolling up: menu */
        lastY = y;
    }

    function init() {
        labelLinks();
        buildBar();

        var language = byId("languageSelect");
        if (language) {
            language.addEventListener("change", function () {
                /* let translations.js change the page words first */
                setTimeout(function () { labelLinks(); fillBar(); }, 0);
            });
        }

        if (bar) {
            lastY = window.scrollY;
            window.addEventListener("scroll", function () {
                if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
            }, { passive: true });
            window.addEventListener("resize", onScroll);
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

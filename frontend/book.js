/* Zebra Domus Inn: the booking page (book.html).
   Guests arrive from "Check availability", "Book Your Stay", "Book now" or "Book this room".
   This script:
   - fills in what they already chose, from the address: ?room=…&in=YYYY-MM-DD&out=YYYY-MM-DD&guests=N
   - shows the rooms as cards to choose from (the hidden #roomType list that script.js uses
     for the price and the booking is kept in step)
   - shows the chosen room's photo and stay beside the total
   - makes "Back to the inn" return to exactly where the guest was.
   Prices, the total and sending the booking are still done by script.js. */
(function () {
    "use strict";

    var TEXT = {
        en: {
            back: "Back to the inn", backHome: "Back to Zebra Domus",
            yourStay: "Your stay", chooseRoom: "Choose your room", yourDetails: "Your details",
            upTo: function (n) { return "Up to " + n + (n === 1 ? " guest" : " guests"); },
            perNight: "per night",
            total: function (amount, n) { return amount + " for " + n + (n === 1 ? " night" : " nights"); },
            nightsGuests: function (n, g) { return n + (n === 1 ? " night" : " nights") + " · " + g + (g === 1 ? " guest" : " guests"); },
            tooSmall: function (n) { return "Fits up to " + n + (n === 1 ? " guest" : " guests"); },
            addDates: "Add your dates to see the total"
        },
        rw: {
            back: "Subira ku icumbi", backHome: "Subira kuri Zebra Domus",
            yourStay: "Amakuru y'urugendo rwawe", chooseRoom: "Hitamo icyumba", yourDetails: "Amakuru yawe",
            upTo: function (n) { return n === 1 ? "Umushyitsi 1 gusa" : "Kugeza ku bashyitsi " + n; },
            perNight: "ku ijoro",
            total: function (amount, n) { return amount + " · " + (n === 1 ? "ijoro 1" : "amajoro " + n); },
            nightsGuests: function (n, g) { return (n === 1 ? "ijoro 1" : "amajoro " + n) + " · " + (g === 1 ? "umushyitsi 1" : "abashyitsi " + g); },
            tooSmall: function (n) { return n === 1 ? "Cyakira umushyitsi 1 gusa" : "Cyakira abashyitsi " + n + " gusa"; },
            addDates: "Hitamo amatariki urebe igiteranyo"
        },
        fr: {
            back: "Retour à l'auberge", backHome: "Retour à Zebra Domus",
            yourStay: "Votre séjour", chooseRoom: "Choisissez votre chambre", yourDetails: "Vos coordonnées",
            upTo: function (n) { return "Jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs"); },
            perNight: "par nuit",
            total: function (amount, n) { return amount + " pour " + n + (n === 1 ? " nuit" : " nuits"); },
            nightsGuests: function (n, g) { return n + (n === 1 ? " nuit" : " nuits") + " · " + g + (g === 1 ? " voyageur" : " voyageurs"); },
            tooSmall: function (n) { return "Jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs") + " seulement"; },
            addDates: "Ajoutez vos dates pour voir le total"
        }
    };

    function byId(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function lang() {
        var select = byId("languageSelect");
        var value = (select && select.value) || "en";
        return TEXT[value] ? value : "en";
    }

    function tx() { return TEXT[lang()]; }

    function rooms() {
        return typeof zebradormusRooms !== "undefined" && Array.isArray(zebradormusRooms) ? zebradormusRooms : [];
    }

    function roomInfo(room) {
        var translated = typeof getRoomTranslations === "function" ? getRoomTranslations(room) : { name: room.name || "", image: "images/room-standard.jpg" };
        return {
            id: typeof getRoomId === "function" ? getRoomId(room) : String(room._id || room.id || ""),
            name: translated.name,
            image: translated.image,
            price: typeof getRoomPrice === "function" ? getRoomPrice(room) : Number(room.pricePerNight),
            capacity: Number(room.capacity) || 2
        };
    }

    function money(amount) {
        return typeof formatRwf === "function" ? formatRwf(amount) : "RWF " + Number(amount).toLocaleString("en-US");
    }

    function stay() {
        return typeof getStay === "function" ? getStay() : { checkIn: null, checkOut: null, nights: 0, guests: 2 };
    }

    /* set a field and tell the rest of the page, as if the guest had changed it */
    function setField(id, value) {
        var field = byId(id);
        if (!field || field.value === value) return;
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function isoDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
        var p = value.split("-").map(Number);
        var date = new Date(p[0], p[1] - 1, p[2]);
        return date.getMonth() === p[1] - 1 ? date : null;
    }

    /* ---------- what the guest already chose ---------- */

    var pendingRoom = "";

    function applyAddress() {
        var params = new URLSearchParams(window.location.search);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var checkIn = isoDate(params.get("in"));
        var checkOut = isoDate(params.get("out"));
        if (checkIn && checkIn >= today) {
            setField("checkIn", params.get("in"));
            if (checkOut && checkOut > checkIn) setField("checkOut", params.get("out"));
        }
        var guests = params.get("guests");
        if (/^[1-6]$/.test(guests || "")) setField("guests", guests);
        pendingRoom = params.get("room") || "";
    }

    /* ---------- the room cards ---------- */

    var box = null;
    var select = null;

    function render() {
        if (!box || !select) return;
        var list = rooms();
        var t = tx();
        var s = stay();
        var hadFocus = box.contains(document.activeElement);

        /* pick the room from the address once the rooms have arrived */
        if (pendingRoom && Array.prototype.some.call(select.options, function (o) { return o.value === pendingRoom; })) {
            var wanted = pendingRoom;
            pendingRoom = "";
            setField("roomType", wanted);
            return; /* the change above calls render() again */
        }

        var cards = list.map(function (room) {
            var info = roomInfo(room);
            var tooSmall = s.guests > info.capacity;

            var card = el("label", "room-option");
            var radio = el("input");
            radio.type = "radio";
            radio.name = "roomChoice";
            radio.value = info.id;
            radio.checked = select.value === info.id;
            radio.disabled = tooSmall && !radio.checked;

            var photo = el("span", "room-option-photo");
            var image = el("img");
            image.src = info.image;
            image.alt = "";
            image.loading = "lazy";
            photo.appendChild(image);

            var text = el("span", "room-option-text");
            text.appendChild(el("strong", "room-option-name", info.name));
            text.appendChild(el("span", "room-option-meta", t.upTo(info.capacity)));
            if (info.price !== null && isFinite(info.price)) {
                var rate = el("span", "room-option-rate");
                rate.append(el("b", null, money(info.price)), document.createTextNode(" " + t.perNight));
                text.appendChild(rate);
                if (tooSmall) text.appendChild(el("span", "room-option-warning", t.tooSmall(info.capacity)));
                else if (s.nights > 0) text.appendChild(el("span", "room-option-total", t.total(money(info.price * s.nights), s.nights)));
            }

            var check = el("span", "room-option-check");
            check.setAttribute("aria-hidden", "true");

            card.append(radio, photo, text, check);
            card.classList.toggle("is-selected", radio.checked);
            card.classList.toggle("is-disabled", radio.disabled);
            radio.addEventListener("change", function () {
                if (radio.checked) setField("roomType", info.id);
            });
            return card;
        });

        if (!cards.length) cards = [el("p", "room-status", select.options[0] ? select.options[0].textContent : "")];
        box.replaceChildren.apply(box, cards);

        if (hadFocus) {
            var checked = box.querySelector("input:checked") || box.querySelector("input:not(:disabled)");
            if (checked) checked.focus({ preventScroll: true });
        }
        renderSummary();
    }

    /* the chosen room's photo and stay, above the total */
    function renderSummary() {
        var holder = byId("summaryRoom");
        if (!holder || !select) return;
        var room = null;
        rooms().forEach(function (r) { if (roomInfo(r).id === select.value) room = r; });
        holder.hidden = !room;
        if (!room) { holder.replaceChildren(); return; }

        var info = roomInfo(room);
        var t = tx();
        var s = stay();
        var image = el("img");
        image.src = info.image;
        image.alt = "";
        var text = el("div", "summary-room-text");
        text.appendChild(el("strong", null, info.name));
        if (s.checkIn && s.checkOut && s.nights > 0) {
            var shortDate = window.ZDDateRange && window.ZDDateRange.shortDate;
            if (shortDate) text.appendChild(el("span", null, shortDate(s.checkIn) + " – " + shortDate(s.checkOut)));
            text.appendChild(el("span", null, t.nightsGuests(s.nights, s.guests)));
        } else {
            text.appendChild(el("span", null, t.addDates));
        }
        holder.replaceChildren(image, text);
    }

    /* ---------- words on this page ---------- */

    function translate() {
        var t = tx();
        Array.prototype.forEach.call(document.querySelectorAll("[data-book]"), function (node) {
            var key = node.dataset.book;
            if (typeof t[key] === "string") node.textContent = t[key];
        });
    }

    /* ---------- "Back to the inn" goes back to where the guest was ---------- */

    function setUpBack() {
        var back = byId("backLink");
        if (!back) return;
        back.addEventListener("click", function (event) {
            var cameFromSite = false;
            try { cameFromSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch (error) { /* keep the plain link */ }
            if (cameFromSite && window.history.length > 1) {
                event.preventDefault();
                window.history.back();
            }
        });
    }

    function init() {
        box = byId("roomOptions");
        select = byId("roomType");
        translate();
        setUpBack();
        applyAddress();

        if (select) {
            /* script.js refills the list when the rooms arrive and when the language changes */
            if ("MutationObserver" in window) new MutationObserver(render).observe(select, { childList: true });
            select.addEventListener("change", render);
        }
        ["checkIn", "checkOut", "guests"].forEach(function (id) {
            var field = byId(id);
            if (field) field.addEventListener("change", render);
        });
        var language = byId("languageSelect");
        if (language) language.addEventListener("change", function () { setTimeout(function () { translate(); render(); }, 0); });

        render();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

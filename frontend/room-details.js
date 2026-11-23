/* Zebra Domus Inn: room details.
   Tapping a room card (anywhere except "Book now") opens a full-screen view of that room:
   one photo of the room, its price, the guest's dates, what's included and the house rules.
   "Book this room" opens the booking page (book.html) with this room, the dates and the guests.

   The dates and guests in this view are the same as the ones in the search box at the top,
   so the two always agree; the dates use the shared calendar in date-range.js.
   The phone's back button closes the view instead of leaving the site,
   and each room has its own link (for example .../#room-deluxe) that can be shared on WhatsApp.
   Text follows the language chosen in the header (EN / RW / FR). */
(function () {
    "use strict";

    /* The one photo shown for each room type (a file in the images folder). */
    var ROOM_PHOTO = {
        standard: "images/room-standard.jpg",
        deluxe: "images/room-deluxe.jpg",
        family: "images/room-family.jpg"
    };

    var TEXT = {
        en: {
            more: "See details",
            close: "Close",
            nights: function (n) { return n + (n === 1 ? " night" : " nights"); },
            guests: function (n) { return n + (n === 1 ? " guest" : " guests"); },
            upTo: function (n) { return "Up to " + n + (n === 1 ? " guest" : " guests"); },
            perNight: "per night",
            yourStay: "Your stay",
            addDatesHint: "Add your dates to see the total price.",
            total: "Total",
            noFees: "No booking-site fees. You book directly with the inn.",
            tooMany: function (n) { return "This room fits up to " + n + (n === 1 ? " guest" : " guests") + ". Choose fewer guests or another room."; },
            datesError: "Check-out must be after check-in.",
            during: "During your stay",
            wifi: "Free Wi-Fi",
            parking: "Free parking",
            pools: "Two outdoor pools and the garden",
            restaurant: "Restaurant and bar",
            spa: "Spa and sauna",
            goodToKnow: "Good to know",
            checkInTimes: "Check-in from 10:00 to 23:00",
            checkOutTime: "Check-out by 10:00",
            payWays: "Pay with MTN MoMo, Airtel Money, card, or at the inn when you arrive.",
            changes: "Need to change or cancel? Contact the inn as early as possible.",
            book: "Book this room",
            chooseDates: "Choose dates",
            changeGuests: "Change guests"
        },
        rw: {
            more: "Reba ibisobanuro",
            close: "Funga",
            nights: function (n) { return (n === 1 ? "ijoro " : "amajoro ") + n; },
            guests: function (n) { return (n === 1 ? "umushyitsi " : "abashyitsi ") + n; },
            upTo: function (n) { return n === 1 ? "Umushyitsi 1 gusa" : "Kugeza ku bashyitsi " + n; },
            perNight: "ku ijoro",
            yourStay: "Amakuru y'urugendo rwawe",
            addDatesHint: "Hitamo amatariki urebe igiteranyo cy'igiciro.",
            total: "Igiteranyo",
            noFees: "Nta mafaranga y'inyongera y'imbuga zo kubika. Ubikira ku icumbi ubwaryo.",
            tooMany: function (n) { return "Iki cyumba cyakira " + (n === 1 ? "umushyitsi 1" : "abashyitsi " + n) + " gusa. Gabanya umubare w'abashyitsi cyangwa uhitemo ikindi cyumba."; },
            datesError: "Itariki yo kugenda igomba gukurikiraho iy'ukuhagera.",
            during: "Mu gihe uri hano",
            wifi: "Wi-Fi y'ubuntu",
            parking: "Parikingi y'ubuntu",
            pools: "Ibidendezi bibiri byo koga n'ubusitani",
            restaurant: "Resitora n'akabari",
            spa: "Spa na sauna",
            goodToKnow: "Ibyo ukwiye kumenya",
            checkInTimes: "Kwakirwa: kuva saa 10:00 kugeza saa 23:00",
            checkOutTime: "Kuvamo: bitarenze saa 10:00",
            payWays: "Wishyura ukoresheje MTN MoMo, Airtel Money, ikarita, cyangwa ukishyurira ku icumbi ugeze yo.",
            changes: "Ukeneye guhindura cyangwa guhagarika? Vugana n'icumbi hakiri kare.",
            book: "Bika iki cyumba",
            chooseDates: "Hitamo amatariki",
            changeGuests: "Hindura umubare w'abashyitsi"
        },
        fr: {
            more: "Voir les détails",
            close: "Fermer",
            nights: function (n) { return n + (n === 1 ? " nuit" : " nuits"); },
            guests: function (n) { return n + (n === 1 ? " voyageur" : " voyageurs"); },
            upTo: function (n) { return "Jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs"); },
            perNight: "par nuit",
            yourStay: "Votre séjour",
            addDatesHint: "Ajoutez vos dates pour voir le prix total.",
            total: "Total",
            noFees: "Aucuns frais de plateforme : vous réservez directement auprès de l'auberge.",
            tooMany: function (n) { return "Cette chambre accueille jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs") + ". Réduisez le nombre de voyageurs ou choisissez une autre chambre."; },
            datesError: "La date de départ doit être après la date d'arrivée.",
            during: "Pendant votre séjour",
            wifi: "Wi-Fi gratuit",
            parking: "Parking gratuit",
            pools: "Deux piscines extérieures et le jardin",
            restaurant: "Restaurant et bar",
            spa: "Spa et sauna",
            goodToKnow: "Bon à savoir",
            checkInTimes: "Arrivée de 10h00 à 23h00",
            checkOutTime: "Départ avant 10h00",
            payWays: "Payez par MTN MoMo, Airtel Money, carte, ou à l'auberge à votre arrivée.",
            changes: "Besoin de modifier ou d'annuler ? Contactez l'auberge le plus tôt possible.",
            book: "Réserver cette chambre",
            chooseDates: "Choisir les dates",
            changeGuests: "Modifier les voyageurs"
        }
    };

    /* Icons: fixed markup, no guest data goes in here. */
    var SVG = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var ICONS = {
        close: '<svg ' + SVG + '><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
        arrow: '<svg ' + SVG + '><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
        guests: '<svg ' + SVG + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
        chevron: '<svg ' + SVG + '><path d="M6 9l6 6 6-6"/></svg>',
        wifi: '<svg ' + SVG + '><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M1.5 9a16 16 0 0 1 21 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><path d="M12 20h.01"/></svg>',
        parking: '<svg ' + SVG + '><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>',
        pool: '<svg ' + SVG + '><path d="M2 12c2 0 2-1.5 4-1.5S8 12 10 12s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 17c2 0 2-1.5 4-1.5S8 17 10 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M8 9V4a2 2 0 0 1 4 0"/><path d="M16 9V4a2 2 0 0 0-4 0"/></svg>',
        restaurant: '<svg ' + SVG + '><path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/></svg>',
        spa: '<svg ' + SVG + '><path d="M12 22c4-2.5 6-6 6-10a6 6 0 0 0-12 0c0 4 2 7.5 6 10z"/><path d="M12 22V12"/><path d="M12 15l-3-3M12 13l3-3"/></svg>',
        clockIn: '<svg ' + SVG + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        clockOut: '<svg ' + SVG + '><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg>',
        wallet: '<svg ' + SVG + '><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
        info: '<svg ' + SVG + '><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
        tag: '<svg ' + SVG + '><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>'
    };

    function icon(name, size) {
        var template = document.createElement("template");
        template.innerHTML = ICONS[name] || "";
        var svg = template.content.firstElementChild;
        if (svg && size) {
            svg.setAttribute("width", size);
            svg.setAttribute("height", size);
        }
        return svg;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function lang() {
        var select = document.getElementById("languageSelect");
        var value = (select && select.value) || "en";
        return TEXT[value] ? value : "en";
    }

    function tx() { return TEXT[lang()]; }

    function pageText() {
        return typeof getCurrentTranslations === "function" ? getCurrentTranslations() : {};
    }

    function money(amount) {
        return typeof formatRwf === "function"
            ? formatRwf(amount)
            : "RWF " + Number(amount).toLocaleString("en-US");
    }

    function allRooms() {
        return typeof zebradormusRooms !== "undefined" && Array.isArray(zebradormusRooms) ? zebradormusRooms : [];
    }

    function idOf(room) { return String(room._id != null ? room._id : room.id != null ? room.id : ""); }

    function keyOf(room) {
        var name = String(room.name || room.roomType || "").toLowerCase();
        if (name.indexOf("standard") > -1) return "standard";
        if (name.indexOf("deluxe") > -1) return "deluxe";
        if (name.indexOf("family") > -1) return "family";
        return idOf(room).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    }

    function roomByKey(key) {
        var rooms = allRooms();
        for (var i = 0; i < rooms.length; i++) {
            if (keyOf(rooms[i]) === key) return rooms[i];
        }
        return null;
    }

    function capacityOf(room) { return Number(room.capacity) || 2; }

    function priceOf(room) {
        var amount = Number(room.pricePerNight != null ? room.pricePerNight : room.price);
        return isFinite(amount) && amount >= 0 ? amount : null;
    }

    function nameOf(room) {
        return typeof getRoomTranslations === "function"
            ? getRoomTranslations(room).name
            : room.name || "";
    }

    /* In Kinyarwanda and French use the translated description; in English the inn's own text. */
    function descriptionOf(room) {
        var key = keyOf(room);
        var translated = pageText()[key + "Description"];
        if (lang() !== "en" && translated) return translated;
        return room.description || translated || "";
    }

    function photoOf(room) {
        var own = ROOM_PHOTO[keyOf(room)];
        if (own) return own;
        return typeof room.image === "string" && /^(https?:\/\/|images\/)/i.test(room.image.trim())
            ? room.image.trim()
            : "images/room-standard.jpg";
    }

    function stay() {
        if (typeof getStay === "function") return getStay();
        return { checkIn: null, checkOut: null, nights: 0, guests: 1 };
    }

    function main(id) { return document.getElementById(id); }

    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }


    /* =========================================
       THE DETAILS VIEW (built once, filled per room)
    ========================================= */

    var dialog = null;
    var els = {};
    var currentKey = null;
    var pushedHistory = false;
    var afterClose = null;
    var returnFocus = null;
    var pendingKey = null;

    function listItem(iconName) {
        var item = el("li");
        var text = el("span");
        item.append(icon(iconName, 18), text);
        return { item: item, text: text };
    }

    function build() {
        if (dialog) return;

        dialog = el("dialog", "room-sheet");
        dialog.setAttribute("aria-labelledby", "rsTitle");

        var scroller = el("div", "rs-scroll");

        /* One photo of the room, with a see-through close button */
        var gallery = el("div", "rs-gallery");
        var figure = el("figure", "rs-photo");
        var photo = el("img");
        photo.decoding = "async";
        photo.addEventListener("error", function () { figure.classList.add("is-missing"); });
        photo.addEventListener("load", function () { figure.classList.remove("is-missing"); });
        figure.appendChild(photo);
        var close = el("button", "glass-button rs-close");
        close.type = "button";
        close.append(icon("close", 20));
        gallery.append(figure, close);

        /* Name, price, capacity, description */
        var body = el("div", "rs-body");
        var title = el("h2", "rs-title");
        title.id = "rsTitle";
        title.tabIndex = -1;
        var price = el("p", "rs-rate");
        var capacity = el("p", "rs-meta");
        var capacityText = el("span");
        capacity.append(icon("guests", 16), capacityText);
        var description = el("p", "rs-description");

        /* Your stay */
        var staySection = el("section", "rs-section rs-stay");
        var stayTitle = el("h3");
        /* one "Check-in – Check-out" field that opens the calendar (date-range.js) */
        var dates = window.ZDDateRange ? window.ZDDateRange.makeTrigger() : el("div");

        var guestsField = el("div", "search-field");
        var guestsLabel = el("label");
        guestsLabel.htmlFor = "rsGuests";
        var guestsControl = el("span", "control");
        var guests = el("select");
        guests.id = "rsGuests";
        var chevron = icon("chevron", 18);
        chevron.classList.add("chevron");
        guestsControl.append(icon("guests", 16), guests, chevron);
        guestsField.append(guestsLabel, guestsControl);

        var warning = el("p", "rs-warning");
        warning.setAttribute("role", "status");
        var breakdown = el("div", "rs-breakdown");
        breakdown.setAttribute("aria-live", "polite");
        var fees = el("p", "rs-fees");
        var feesText = el("span");
        fees.append(icon("tag", 16), feesText);
        staySection.append(stayTitle, dates, guestsField, warning, breakdown, fees);

        /* During your stay */
        var duringSection = el("section", "rs-section");
        var duringTitle = el("h3");
        var duringList = el("ul", "rs-list");
        var during = {
            wifi: listItem("wifi"),
            parking: listItem("parking"),
            pools: listItem("pool"),
            restaurant: listItem("restaurant"),
            spa: listItem("spa")
        };
        Object.keys(during).forEach(function (k) { duringList.appendChild(during[k].item); });
        duringSection.append(duringTitle, duringList);

        /* Good to know */
        var rulesSection = el("section", "rs-section");
        var rulesTitle = el("h3");
        var rulesList = el("ul", "rs-list");
        var rules = {
            checkInTimes: listItem("clockIn"),
            checkOutTime: listItem("clockOut"),
            payWays: listItem("wallet"),
            changes: listItem("info")
        };
        Object.keys(rules).forEach(function (k) { rulesList.appendChild(rules[k].item); });
        rulesSection.append(rulesTitle, rulesList);

        body.append(title, price, capacity, description, staySection, duringSection, rulesSection);
        scroller.append(gallery, body);

        /* Bar that stays at the bottom: price and the booking button */
        var bar = el("div", "rs-bar");
        var barPrice = el("div", "rs-bar-price");
        var barAmount = el("strong");
        var barNote = el("span");
        barPrice.append(barAmount, barNote);
        var book = el("button", "btn btn-primary rs-book");
        book.type = "button";
        bar.append(barPrice, book);

        dialog.append(scroller, bar);
        document.body.appendChild(dialog);

        els = {
            scroller: scroller, photo: photo, close: close,
            title: title, price: price, capacityText: capacityText, description: description,
            stayTitle: stayTitle, dates: dates, guests: guests, guestsLabel: guestsLabel,
            warning: warning, breakdown: breakdown, feesText: feesText, staySection: staySection,
            duringTitle: duringTitle, during: during, rulesTitle: rulesTitle, rules: rules,
            barAmount: barAmount, barNote: barNote, book: book
        };

        /* Closing: the X, the Escape key, a tap outside the page column on a wide screen */
        close.addEventListener("click", function () { requestClose(); });
        dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            requestClose();
        });
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) requestClose();
        });

        /* Guests: write them into the search box, which the booking form uses
           (the calendar writes the dates there itself) */
        guests.addEventListener("change", function () { copyToMain("guests", guests.value); });

        book.addEventListener("click", bookRoom);
    }

    function copyToMain(id, value) {
        var field = main(id);
        if (!field) return;
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
        renderStay();
    }

    function renderPhoto(room) {
        var src = photoOf(room);
        if (els.photo.getAttribute("src") !== src) els.photo.src = src;
        els.photo.alt = nameOf(room);
    }

    function renderStay() {
        if (!dialog || !currentKey) return;
        var room = roomByKey(currentKey);
        if (!room) return;

        var t = tx();
        var page = pageText();
        var s = stay();
        var amount = priceOf(room);
        var capacity = capacityOf(room);

        /* Labels and fields */
        els.stayTitle.textContent = t.yourStay;
        els.guestsLabel.textContent = page.guests || "Guests";

        var mainGuests = main("guests");
        if (mainGuests) {
            els.guests.replaceChildren.apply(els.guests, Array.prototype.map.call(mainGuests.options, function (option) {
                var copy = el("option", null, option.textContent);
                copy.value = option.value;
                return copy;
            }));
            els.guests.value = mainGuests.value;
        }

        /* Problems with the stay */
        var problem = "";
        if (s.checkIn && s.checkOut && s.nights <= 0) problem = t.datesError;
        else if (s.guests > capacity) problem = t.tooMany(capacity);
        els.warning.textContent = problem;
        els.warning.hidden = !problem;

        /* Price breakdown */
        var rows = [];
        if (amount !== null && s.nights > 0) {
            var line = el("div", "rs-row");
            line.append(el("span", null, money(amount) + " × " + t.nights(s.nights)), el("span", null, money(amount * s.nights)));
            var totalLine = el("div", "rs-row rs-total");
            totalLine.append(el("span", null, t.total), el("span", null, money(amount * s.nights)));
            rows.push(line, totalLine);
        } else {
            rows.push(el("p", "rs-hint", t.addDatesHint));
        }
        els.breakdown.replaceChildren.apply(els.breakdown, rows);
        els.feesText.textContent = t.noFees;

        /* Bottom bar */
        if (amount === null) {
            els.barAmount.textContent = page.priceUnavailable || "Price unavailable";
            els.barNote.textContent = "";
        } else if (s.nights > 0) {
            els.barAmount.textContent = money(amount * s.nights);
            els.barNote.textContent = t.nights(s.nights) + " · " + t.guests(s.guests);
        } else {
            els.barAmount.textContent = money(amount);
            els.barNote.textContent = t.perNight;
        }

        var action = "book";
        if (s.nights <= 0) action = "dates";
        else if (s.guests > capacity) action = "guests";
        els.book.dataset.action = action;
        els.book.textContent = action === "dates" ? t.chooseDates : action === "guests" ? t.changeGuests : t.book;
    }

    function renderAll() {
        var room = roomByKey(currentKey);
        if (!room) return;
        var t = tx();
        var amount = priceOf(room);

        dialog.setAttribute("lang", lang());
        els.close.setAttribute("aria-label", t.close);
        els.title.textContent = nameOf(room);
        els.price.replaceChildren();
        if (amount !== null) {
            els.price.append(el("strong", null, money(amount)), el("span", null, " " + t.perNight));
        }
        els.capacityText.textContent = t.upTo(capacityOf(room));
        els.description.textContent = descriptionOf(room);
        els.description.hidden = !els.description.textContent;

        els.duringTitle.textContent = t.during;
        Object.keys(els.during).forEach(function (k) { els.during[k].text.textContent = t[k]; });
        els.rulesTitle.textContent = t.goodToKnow;
        Object.keys(els.rules).forEach(function (k) { els.rules[k].text.textContent = t[k]; });

        renderPhoto(room);
        renderStay();
    }


    /* =========================================
       OPEN, CLOSE, BOOK
    ========================================= */

    function open(key, fromHistory) {
        if (!roomByKey(key)) return false;
        build();

        var switching = currentKey !== key;
        currentKey = key;
        renderAll();

        if (!dialog.open) {
            returnFocus = document.activeElement;
            dialog.showModal();
            document.documentElement.classList.add("rs-lock");
            els.title.focus({ preventScroll: true });
        }
        if (switching) {
            els.scroller.scrollTop = 0;
        }

        if (!fromHistory) {
            try {
                history.pushState({ zdRoom: key }, "", "#room-" + key);
                pushedHistory = true;
            } catch (error) {
                pushedHistory = false;
            }
        }
        return true;
    }

    function finishClose() {
        pushedHistory = false;
        if (dialog && dialog.open) dialog.close();
        document.documentElement.classList.remove("rs-lock");

        var next = afterClose;
        afterClose = null;
        if (next) {
            /* wait a moment so the browser's own scroll restoring doesn't undo ours */
            requestAnimationFrame(function () { setTimeout(next, 0); });
        } else if (returnFocus && document.contains(returnFocus) && returnFocus.focus) {
            returnFocus.focus({ preventScroll: true });
        }
        returnFocus = null;
    }

    function requestClose(then) {
        afterClose = then || null;
        if (pushedHistory && history.state && history.state.zdRoom) {
            history.back(); /* the popstate handler below finishes closing */
        } else {
            finishClose();
            if (/^#room-/.test(location.hash)) {
                try { history.replaceState(null, "", location.pathname + location.search); } catch (error) { /* fine */ }
            }
        }
    }

    window.addEventListener("popstate", function () {
        var match = /^#room-(.+)$/.exec(location.hash);
        var isOpen = dialog && dialog.open;
        if (isOpen && !(history.state && history.state.zdRoom)) {
            finishClose();
        } else if (match && !isOpen) {
            open(decodeURIComponent(match[1]), true);
        }
    });

    function bookRoom() {
        var room = roomByKey(currentKey);
        if (!room) return;
        var action = els.book.dataset.action;

        if (action === "dates") {
            els.staySection.scrollIntoView({ behavior: "auto", block: "start" });
            if (window.ZDDateRange) window.ZDDateRange.open(els.dates);
            return;
        }
        if (action === "guests") {
            els.staySection.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
            els.guests.focus({ preventScroll: true });
            return;
        }

        /* Open the booking page with this room and the chosen dates and guests */
        var roomId = idOf(room);
        if (typeof window.zdGoToBooking === "function") window.zdGoToBooking(roomId);
        else window.location.href = "book.html?room=" + encodeURIComponent(roomId);
    }


    /* =========================================
       ROOM CARDS: make them open the details view
    ========================================= */

    function enhanceCards() {
        var grid = main("roomGrid");
        if (!grid) return;
        var t = tx();

        Array.prototype.forEach.call(grid.querySelectorAll(".room-card"), function (card) {
            if (card.dataset.roomKey) return;
            var button = card.querySelector(".room-button");
            var id = card.dataset.roomId || (button && button.dataset.roomId) || "";
            var room = null;
            if (id) {
                allRooms().forEach(function (r) { if (idOf(r) === id) room = r; });
            }
            if (!room) return;

            var key = keyOf(room);
            card.dataset.roomKey = key;
            card.classList.add("has-details");

            /* older cards with a price row get a "See details" link; the photo cards don't need one */
            var bottom = card.querySelector(".room-bottom");
            if (bottom && bottom.parentNode) {
                var more = el("button", "room-more");
                more.type = "button";
                more.append(el("span", null, t.more), icon("arrow", 16));
                bottom.parentNode.insertBefore(more, bottom);
            }
        });

        /* Someone opened a shared room link, e.g. .../#room-deluxe */
        if (pendingKey && roomByKey(pendingKey)) {
            var key = pendingKey;
            pendingKey = null;
            open(key, true);
        }
    }

    function init() {
        var grid = main("roomGrid");
        if (!grid) return;

        var match = /^#room-(.+)$/.exec(location.hash);
        if (match) pendingKey = decodeURIComponent(match[1]);

        /* A tap anywhere on a room card opens its details; "Book now" keeps its own job */
        grid.addEventListener("click", function (event) {
            if (event.target.closest(".room-button")) return;
            var card = event.target.closest(".room-card");
            if (!card || !grid.contains(card) || !card.dataset.roomKey) return;
            if (window.getSelection && String(window.getSelection()).length) return; /* guest is selecting text */
            open(card.dataset.roomKey);
        });

        /* script.js rebuilds the cards whenever dates, guests or language change */
        if ("MutationObserver" in window) {
            new MutationObserver(enhanceCards).observe(grid, { childList: true });
        }
        enhanceCards();

        var language = main("languageSelect");
        if (language) {
            language.addEventListener("change", function () {
                if (dialog && dialog.open) renderAll();
            });
        }

        /* dates picked in the calendar: update the price and the button */
        ["checkIn", "checkOut"].forEach(function (id) {
            var field = main(id);
            if (field) field.addEventListener("change", function () {
                if (dialog && dialog.open) renderStay();
            });
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

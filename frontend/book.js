/* Zebra Dormus Inn: the booking page (book.html).
   Guests arrive from "Check availability", "Book Your Stay", "Book now" or "Book this room".
   This script:
   - fills in what they already chose, from the address: ?room=…&in=YYYY-MM-DD&out=YYYY-MM-DD&guests=N
   - shows the rooms as cards to choose from (the hidden #roomType list that script.js uses
     for the price and the booking is kept in step)
   - shows the chosen room's photo and stay beside the total
   - asks the booking server which rooms are free for the chosen dates, marks booked
     rooms and points the guest to the rooms still free
   - makes "Back to the inn" return to exactly where the guest was.
   Prices, the total and sending the booking are still done by script.js. */
(function () {
    "use strict";

    var TEXT = {
        en: {
            back: "Back to the inn", backHome: "Back to Zebra Dormus",
            yourStay: "Your stay", chooseRoom: "Choose your room", yourDetails: "Your details",
            upTo: function (n) { return "Up to " + n + (n === 1 ? " guest" : " guests"); },
            perNight: "per night",
            total: function (amount, n) { return amount + " for " + n + (n === 1 ? " night" : " nights"); },
            nightsGuests: function (n, g) { return n + (n === 1 ? " night" : " nights") + " · " + g + (g === 1 ? " guest" : " guests"); },
            tooSmall: function (n) { return "Fits up to " + n + (n === 1 ? " guest" : " guests"); },
            addDates: "Add your dates to see the total",
            free: "Free for your dates",
            left: function (n) { return n === 1 ? "Only 1 left for your dates" : "Only " + n + " left for your dates"; },
            booked: "Booked for your dates",
            taken: function (name) { return "The " + name + " is booked for your dates."; },
            stillFree: function (names) { return "Still free: " + names + "."; },
            noneFit: function (g) { return "No free room fits " + g + (g === 1 ? " guest" : " guests") + " on these dates. Please try other dates."; },
            allBooked: "All rooms are booked for these dates. Please choose other dates."
        },
        rw: {
            back: "Subira ku icumbi", backHome: "Subira kuri Zebra Dormus",
            yourStay: "Amakuru y'urugendo rwawe", chooseRoom: "Hitamo icyumba", yourDetails: "Amakuru yawe",
            upTo: function (n) { return n === 1 ? "Umushyitsi 1 gusa" : "Kugeza ku bashyitsi " + n; },
            perNight: "ku ijoro",
            total: function (amount, n) { return amount + " · " + (n === 1 ? "ijoro 1" : "amajoro " + n); },
            nightsGuests: function (n, g) { return (n === 1 ? "ijoro 1" : "amajoro " + n) + " · " + (g === 1 ? "umushyitsi 1" : "abashyitsi " + g); },
            tooSmall: function (n) { return n === 1 ? "Cyakira umushyitsi 1 gusa" : "Cyakira abashyitsi " + n + " gusa"; },
            addDates: "Hitamo amatariki urebe igiteranyo",
            free: "Kirahari kuri ayo matariki",
            left: function (n) { return "Hasigaye " + n + " gusa kuri ayo matariki"; },
            booked: "Cyafashwe kuri ayo matariki",
            taken: function (name) { return name + " cyafashwe kuri ayo matariki."; },
            stillFree: function (names) { return "Ibikiri ubusa: " + names + "."; },
            noneFit: function (g) { return "Nta cyumba kiri ubusa cyakira " + (g === 1 ? "umushyitsi 1" : "abashyitsi " + g) + " kuri ayo matariki. Gerageza andi matariki."; },
            allBooked: "Ibyumba byose byafashwe kuri ayo matariki. Hitamo andi matariki."
        },
        fr: {
            back: "Retour à l'auberge", backHome: "Retour à Zebra Dormus",
            yourStay: "Votre séjour", chooseRoom: "Choisissez votre chambre", yourDetails: "Vos coordonnées",
            upTo: function (n) { return "Jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs"); },
            perNight: "par nuit",
            total: function (amount, n) { return amount + " pour " + n + (n === 1 ? " nuit" : " nuits"); },
            nightsGuests: function (n, g) { return n + (n === 1 ? " nuit" : " nuits") + " · " + g + (g === 1 ? " voyageur" : " voyageurs"); },
            tooSmall: function (n) { return "Jusqu'à " + n + (n === 1 ? " voyageur" : " voyageurs") + " seulement"; },
            addDates: "Ajoutez vos dates pour voir le total",
            free: "Disponible à vos dates",
            left: function (n) { return n === 1 ? "Plus qu'une seule à vos dates" : "Plus que " + n + " à vos dates"; },
            booked: "Déjà réservée à vos dates",
            taken: function (name) { return name + " : déjà réservée à vos dates."; },
            stillFree: function (names) { return "Encore disponibles : " + names + "."; },
            noneFit: function (g) { return "Aucune chambre libre pour " + g + (g === 1 ? " voyageur" : " voyageurs") + " à ces dates. Essayez d'autres dates."; },
            allBooked: "Toutes les chambres sont réservées à ces dates. Choisissez d'autres dates."
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
        if (/^[1-4]$/.test(guests || "")) setField("guests", guests);
        pendingRoom = params.get("room") || "";
    }

    /* ---------- which rooms are free for the chosen dates ---------- */

    var REFRESH_MS = 90 * 1000;
    var availability = { key: "", rooms: null };   /* rooms: { roomId: { available, totalRooms } } */
    var availabilityRequest = 0;
    var takenRoom = null;                          /* id of the room the guest had chosen, now booked */

    function dateKey() {
        var checkIn = byId("checkIn");
        var checkOut = byId("checkOut");
        var a = checkIn ? checkIn.value : "";
        var b = checkOut ? checkOut.value : "";
        return /^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && b > a ? a + "|" + b : "";
    }

    /* Only rooms that came from the booking server can be checked
       (the built-in list is shown when the server can't be reached). */
    function serverRooms() {
        var list = rooms();
        return list.length > 0 && list.every(function (room) { return /^[0-9a-f]{24}$/i.test(roomInfo(room).id); });
    }

    function roomAvailability(id) {
        return availability.rooms && availability.key === dateKey() ? availability.rooms[id] || null : null;
    }

    function checkAvailability() {
        var key = dateKey();

        if (key !== availability.key) {
            availability = { key: key, rooms: null };
            takenRoom = null;
        }

        render();

        if (!key || !serverRooms() || !window.ZD_API || !window.fetch) return;

        var request = ++availabilityRequest;
        var parts = key.split("|");
        var address = window.ZD_API + "/availability?checkIn=" + encodeURIComponent(parts[0]) + "&checkOut=" + encodeURIComponent(parts[1]);

        fetch(address, { cache: "no-store" })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (result) {
                if (request !== availabilityRequest || dateKey() !== key) return; /* the guest changed the dates meanwhile */
                if (!result || !result.success || !Array.isArray(result.rooms)) return;

                var byRoom = {};
                result.rooms.forEach(function (room) {
                    byRoom[String(room._id)] = { available: Number(room.available) || 0, totalRooms: Number(room.totalRooms) || 0 };
                });

                /* a room type that guests can no longer book is not in the answer: treat it as booked */
                rooms().forEach(function (room) {
                    var id = roomInfo(room).id;
                    if (!byRoom[id]) byRoom[id] = { available: 0, totalRooms: 0 };
                });

                availability = { key: key, rooms: byRoom };
                render();
            })
            .catch(function () { /* no answer: just don't show availability */ });
    }

    /* script.js sends this when the server says the room was taken while the guest filled in the form */
    function roomTaken(event) {
        var detail = (event && event.detail) || {};
        var id = String(detail.roomId || "");
        var key = dateKey();

        if (id && key) {
            if (!availability.rooms || availability.key !== key) availability = { key: key, rooms: {} };
            availability.rooms[id] = { available: 0, totalRooms: (availability.rooms[id] || {}).totalRooms || 0 };
            render();
        }

        checkAvailability();
    }

    /* the note above the room cards */
    function renderNote(list, s) {
        if (!note) return;
        var t = tx();
        var text = "";

        if (availability.rooms && availability.key === dateKey() && list.length) {
            var infos = list.map(roomInfo);
            var free = infos.filter(function (info) {
                var a = roomAvailability(info.id);
                return a && a.available > 0;
            });
            var fits = free.filter(function (info) { return s.guests <= info.capacity; });
            var allKnown = infos.every(function (info) { return roomAvailability(info.id); });

            if (allKnown && !free.length) text = t.allBooked;
            else if (takenRoom) {
                var takenInfo = infos.filter(function (info) { return info.id === takenRoom; })[0];
                text = t.taken(takenInfo ? takenInfo.name : "");
                if (fits.length) text += " " + t.stillFree(fits.map(function (info) { return info.name; }).join(", "));
                else if (allKnown) text += " " + t.noneFit(s.guests);
            } else if (allKnown && !fits.length) text = t.noneFit(s.guests);
        }

        note.textContent = text;
        note.hidden = !text;
    }

    /* ---------- the room cards ---------- */

    var box = null;
    var select = null;
    var note = null;

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

        /* the chosen room is booked for these dates: let it go and show what is still free */
        var chosen = select.value ? roomAvailability(select.value) : null;
        if (chosen && chosen.available <= 0) {
            takenRoom = select.value;
            setField("roomType", "");
            return; /* the change above calls render() again */
        }

        var cards = list.map(function (room) {
            var info = roomInfo(room);
            var tooSmall = s.guests > info.capacity;
            var free = roomAvailability(info.id);
            var booked = !!free && free.available <= 0;

            var card = el("label", "room-option");
            var radio = el("input");
            radio.type = "radio";
            radio.name = "roomChoice";
            radio.value = info.id;
            radio.checked = select.value === info.id;
            radio.disabled = (tooSmall || booked) && !radio.checked;

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
            }
            if (booked) {
                text.appendChild(el("span", "room-option-status is-booked", t.booked));
            } else if (tooSmall) {
                text.appendChild(el("span", "room-option-warning", t.tooSmall(info.capacity)));
            } else {
                if (free) {
                    var few = free.totalRooms > 1 && free.available <= 2;
                    text.appendChild(el("span", "room-option-status is-free", few ? t.left(free.available) : t.free));
                }
                if (s.nights > 0 && info.price !== null && isFinite(info.price)) {
                    text.appendChild(el("span", "room-option-total", t.total(money(info.price * s.nights), s.nights)));
                }
            }

            var check = el("span", "room-option-check");
            check.setAttribute("aria-hidden", "true");

            card.append(radio, photo, text, check);
            card.classList.toggle("is-selected", radio.checked);
            card.classList.toggle("is-disabled", radio.disabled);
            card.classList.toggle("is-booked", booked);
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
        renderNote(list, s);
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
        if (box) {
            note = el("p", "room-availability");
            note.id = "roomAvailability";
            note.setAttribute("role", "status");
            note.hidden = true;
            box.parentNode.insertBefore(note, box);
        }
        translate();
        setUpBack();
        applyAddress();

        if (select) {
            /* script.js refills the list when the rooms arrive and when the language changes */
            if ("MutationObserver" in window) {
                new MutationObserver(function () {
                    render();
                    if (dateKey() && !availability.rooms) checkAvailability();
                }).observe(select, { childList: true });
            }
            select.addEventListener("change", function () {
                if (select.value) takenRoom = null;
                render();
            });
        }
        ["checkIn", "checkOut"].forEach(function (id) {
            var field = byId(id);
            if (field) field.addEventListener("change", checkAvailability);
        });
        var guestsField = byId("guests");
        if (guestsField) guestsField.addEventListener("change", render);
        document.addEventListener("zd:room-taken", roomTaken);

        /* rooms get booked while guests fill in the form: look again now and then */
        setInterval(function () {
            if (document.visibilityState === "visible" && dateKey()) checkAvailability();
        }, REFRESH_MS);
        var language = byId("languageSelect");
        if (language) language.addEventListener("change", function () { setTimeout(function () { translate(); render(); }, 0); });

        render();
        checkAvailability();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

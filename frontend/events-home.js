/* Zebra Domus Inn: the events on the home page (#events).
   The house party and the swimming competition are shown like the rooms:
   white cards with a photo, the name, the price and when the next day is free.
   On a phone they slide sideways; with a mouse the card grows a little.
   Tapping a card opens a full-screen view of the event (the same look as a room):
   the photo, the price, a day to choose, what's at the inn and the house rules.
   "Book this event" opens events.html with the event and the day.
   Each event has its own link (…/#event-house-party) and the phone's back button
   closes the view. Prices and taken days come from the booking server.
   Text follows the language chosen in the header (EN / RW / FR). */
(function () {
    "use strict";

    var PHOTO = { "house-party": "images/932183308.jpg", "swimming-competition": "images/pool.jpg" };
    var ORDER = ["house-party", "swimming-competition"];

    var RW_DAYS = ["Ku cyumweru", "Ku wa mbere", "Ku wa kabiri", "Ku wa gatatu", "Ku wa kane", "Ku wa gatanu", "Ku wa gatandatu"];
    var RW_MONTHS = ["Mutarama", "Gashyantare", "Werurwe", "Mata", "Gicurasi", "Kamena", "Nyakanga", "Kanama", "Nzeri", "Ukwakira", "Ugushyingo", "Ukuboza"];

    var TEXT = {
        en: {
            intro: "House parties and swimming competitions. One event per day, confirmed by the inn.",
            from: function (amount) { return "From " + amount + " per event · one event per day"; },
            types: {
                "house-party": {
                    name: "House party",
                    place: "The garden and the main house",
                    text: "Celebrate a birthday, a family gathering or a party with friends in the inn's green garden, with the main house beside it."
                },
                "swimming-competition": {
                    name: "Swimming competition",
                    place: "The outdoor pools",
                    text: "Hold a school, club or friendly swimming competition at the inn's outdoor pool, with room around it for swimmers and supporters."
                }
            },
            perEvent: "per event",
            askPrice: "Ask us for the price",
            freeTomorrow: "Free tomorrow",
            nextFree: function (d) { return "Next free day: " + d; },
            close: "Close",
            yourEvent: "Your event",
            day: "Day",
            dayFree: function (d) { return d + " is free."; },
            dayTaken: function (d) { return d + " already has an event. Please choose another day."; },
            booked: function (list) { return "Already booked: " + list + "."; },
            atTheInn: "At the inn",
            garden: "The green garden and the main house",
            pools: "Two outdoor pools",
            restaurant: "Restaurant and bar",
            parking: "Free parking",
            wifi: "Free Wi-Fi",
            goodToKnow: "Good to know",
            oneADay: "One event per day at the inn",
            times: "Choose your times between 06:00 and 23:30",
            confirm: "The inn calls you to confirm. You pay once it is confirmed.",
            noFees: "No booking-site fees. You book directly with the inn.",
            book: "Book this event",
            chooseDay: "Choose a day",
            otherDay: "Choose another day"
        },
        rw: {
            intro: "Ibirori n'amarushanwa yo koga. Igikorwa kimwe ku munsi, cyemezwa n'icumbi.",
            from: function (amount) { return "Guhera kuri " + amount + " ku gikorwa · igikorwa kimwe ku munsi"; },
            types: {
                "house-party": {
                    name: "Ibirori",
                    place: "Ubusitani n'inzu nkuru",
                    text: "Izihiza isabukuru, guhura kw'umuryango cyangwa ibirori n'inshuti mu busitani bw'icumbi, iruhande rw'inzu nkuru."
                },
                "swimming-competition": {
                    name: "Irushanwa ryo koga",
                    place: "Pisine zo hanze",
                    text: "Kora irushanwa ryo koga ry'ishuri, ry'ikipe cyangwa ry'inshuti muri pisine y'icumbi, hari n'umwanya w'aboga n'ababashyigikiye."
                }
            },
            perEvent: "ku gikorwa",
            askPrice: "Tubaze igiciro",
            freeTomorrow: "Ejo harahari",
            nextFree: function (d) { return "Umunsi ukurikira uboneka: " + d; },
            close: "Funga",
            yourEvent: "Igikorwa cyawe",
            day: "Umunsi",
            dayFree: function (d) { return d + ": uyu munsi uraboneka."; },
            dayTaken: function (d) { return d + ": uyu munsi ufite ikindi gikorwa. Hitamo undi munsi."; },
            booked: function (list) { return "Iminsi yafashwe: " + list + "."; },
            atTheInn: "Ku icumbi",
            garden: "Ubusitani n'inzu nkuru",
            pools: "Pisine ebyiri zo hanze",
            restaurant: "Resitora n'akabari",
            parking: "Parikingi y'ubuntu",
            wifi: "Wi-Fi y'ubuntu",
            goodToKnow: "Ibyo ukwiye kumenya",
            oneADay: "Igikorwa kimwe ku munsi ku icumbi",
            times: "Hitamo amasaha hagati ya 06:00 na 23:30",
            confirm: "Icumbi rizaguhamagara rikwemerere. Uzishyura bimaze kwemezwa.",
            noFees: "Nta mafaranga y'inyongera y'imbuga zo kubika. Ubikira ku icumbi ubwaryo.",
            book: "Bika iki gikorwa",
            chooseDay: "Hitamo umunsi",
            otherDay: "Hitamo undi munsi"
        },
        fr: {
            intro: "Fêtes privées et compétitions de natation. Un seul événement par jour, confirmé par l'auberge.",
            from: function (amount) { return "À partir de " + amount + " l'événement · un seul par jour"; },
            types: {
                "house-party": {
                    name: "Fête privée",
                    place: "Le jardin et la maison principale",
                    text: "Fêtez un anniversaire, une réunion de famille ou une soirée entre amis dans le jardin verdoyant de l'auberge, à côté de la maison principale."
                },
                "swimming-competition": {
                    name: "Compétition de natation",
                    place: "Les piscines extérieures",
                    text: "Organisez une compétition de natation d'école, de club ou entre amis à la piscine extérieure de l'auberge, avec de la place autour pour les nageurs et leurs supporters."
                }
            },
            perEvent: "l'événement",
            askPrice: "Prix sur demande",
            freeTomorrow: "Libre demain",
            nextFree: function (d) { return "Prochain jour libre : " + d; },
            close: "Fermer",
            yourEvent: "Votre événement",
            day: "Jour",
            dayFree: function (d) { return d + " est libre."; },
            dayTaken: function (d) { return d + " a déjà un événement. Choisissez un autre jour."; },
            booked: function (list) { return "Déjà réservés : " + list + "."; },
            atTheInn: "À l'auberge",
            garden: "Le jardin verdoyant et la maison principale",
            pools: "Deux piscines extérieures",
            restaurant: "Restaurant et bar",
            parking: "Parking gratuit",
            wifi: "Wi-Fi gratuit",
            goodToKnow: "Bon à savoir",
            oneADay: "Un seul événement par jour à l'auberge",
            times: "Choisissez vos horaires entre 06:00 et 23:30",
            confirm: "L'auberge vous appelle pour confirmer. Vous payez une fois l'événement confirmé.",
            noFees: "Pas de frais de site de réservation. Vous réservez directement auprès de l'auberge.",
            book: "Réserver cet événement",
            chooseDay: "Choisir un jour",
            otherDay: "Choisir un autre jour"
        }
    };

    /* Icons: fixed markup, no guest data goes in here. */
    var SVG = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var ICONS = {
        close: '<svg ' + SVG + '><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
        calendar: '<svg ' + SVG + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
        place: '<svg ' + SVG + '><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
        garden: '<svg ' + SVG + '><path d="M12 22c4-2.5 6-6 6-10a6 6 0 0 0-12 0c0 4 2 7.5 6 10z"/><path d="M12 22V12"/><path d="M12 15l-3-3M12 13l3-3"/></svg>',
        pool: '<svg ' + SVG + '><path d="M2 12c2 0 2-1.5 4-1.5S8 12 10 12s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 17c2 0 2-1.5 4-1.5S8 17 10 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M8 9V4a2 2 0 0 1 4 0"/><path d="M16 9V4a2 2 0 0 0-4 0"/></svg>',
        restaurant: '<svg ' + SVG + '><path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/></svg>',
        parking: '<svg ' + SVG + '><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>',
        wifi: '<svg ' + SVG + '><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M1.5 9a16 16 0 0 1 21 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><path d="M12 20h.01"/></svg>',
        oneDay: '<svg ' + SVG + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4"/></svg>',
        clock: '<svg ' + SVG + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        phone: '<svg ' + SVG + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
        tag: '<svg ' + SVG + '><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>'
    };

    var data = { types: {}, taken: [], firstDay: "", lastDay: "", loaded: false };

    function byId(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

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

    function lang() {
        var select = byId("languageSelect");
        var value = (select && select.value) || "en";
        return TEXT[value] ? value : "en";
    }

    function tx() { return TEXT[lang()]; }

    function money(amount) {
        return "RWF " + Number(amount).toLocaleString("en-US");
    }

    /* "Sat 21 Nov" in the chosen language */
    function dayWords(text) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text || "")) return "";
        var date = new Date(text + "T00:00:00Z");
        if (lang() === "rw") return RW_DAYS[date.getUTCDay()] + ", " + date.getUTCDate() + " " + RW_MONTHS[date.getUTCMonth()];
        return date.toLocaleDateString(lang() === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    }

    function addDay(text, n) {
        var date = new Date(text + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + n);
        return date.toISOString().slice(0, 10);
    }

    function nextFreeDay() {
        if (!data.firstDay) return "";
        for (var day = data.firstDay, i = 0; i < 400 && day <= data.lastDay; i += 1, day = addDay(day, 1)) {
            if (data.taken.indexOf(day) < 0) return day;
        }
        return "";
    }

    function info(key) { return tx().types[key]; }
    function priceOf(key) { return data.types[key] ? data.types[key].price : null; }
    function isOpen(key) { return !data.types[key] || data.types[key].open !== false; }

    /* =========================================
       THE CARDS (like the room cards)
    ========================================= */

    function renderIntro() {
        var intro = byId("eventsIntro");
        if (!intro) return;
        var prices = ORDER.map(priceOf).filter(function (p) { return p; });
        intro.textContent = prices.length ? tx().from(money(Math.min.apply(null, prices))) : tx().intro;
    }

    function renderCards() {
        var grid = byId("eventGrid");
        if (!grid) return;
        var t = tx();
        var free = nextFreeDay();
        var fragment = document.createDocumentFragment();

        ORDER.forEach(function (key) {
            var about = info(key);
            var card = el("article", "room-card event-card has-details");
            card.dataset.eventKey = key;

            var imageBox = el("div", "room-image");
            var image = el("img");
            image.src = PHOTO[key];
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            imageBox.appendChild(image);

            var content = el("div", "room-content");
            var title = el("h3", "room-title");
            var open = el("button", "room-open", about.name);
            open.type = "button";
            title.appendChild(open);

            var meta = el("p", "room-meta");
            var rate = el("span", "room-rate");
            var price = priceOf(key);
            if (price) rate.append(el("strong", null, money(price)), " " + t.perEvent);
            else rate.append(el("strong", null, t.askPrice));
            meta.append(rate, el("span", "room-guests", about.place));
            content.append(title, meta);

            if (data.loaded && isOpen(key) && free) {
                content.appendChild(el("p", "room-avail is-free", free === data.firstDay ? t.freeTomorrow : t.nextFree(dayWords(free))));
            }

            card.append(imageBox, content);
            fragment.appendChild(card);
        });

        grid.replaceChildren(fragment);
    }

    /* =========================================
       THE DETAILS VIEW (the same look as a room's)
    ========================================= */

    var dialog = null;
    var els = {};
    var currentKey = null;
    var pushedHistory = false;
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

        dialog = el("dialog", "room-sheet event-sheet");
        dialog.setAttribute("aria-labelledby", "esTitle");

        var scroller = el("div", "rs-scroll");

        var gallery = el("div", "rs-gallery");
        var figure = el("figure", "rs-photo");
        var photo = el("img");
        photo.decoding = "async";
        figure.appendChild(photo);
        var close = el("button", "glass-button rs-close");
        close.type = "button";
        close.append(icon("close", 20));
        gallery.append(figure, close);

        var body = el("div", "rs-body");
        var title = el("h2", "rs-title");
        title.id = "esTitle";
        title.tabIndex = -1;
        var price = el("p", "rs-rate");
        var place = el("p", "rs-meta");
        var placeText = el("span");
        place.append(icon("place", 16), placeText);
        var description = el("p", "rs-description");

        /* Your event: the day */
        var daySection = el("section", "rs-section rs-stay");
        var dayTitle = el("h3");
        var dayField = el("div", "search-field");
        var dayLabel = el("label");
        dayLabel.htmlFor = "esDay";
        var dayControl = el("span", "control");
        var day = el("input");
        day.type = "date";
        day.id = "esDay";
        dayControl.append(icon("calendar", 16), day);
        dayField.append(dayLabel, dayControl);
        var dayStatus = el("p", "event-sheet-status");
        dayStatus.setAttribute("role", "status");
        var booked = el("p", "rs-hint");
        var fees = el("p", "rs-fees");
        var feesText = el("span");
        fees.append(icon("tag", 16), feesText);
        daySection.append(dayTitle, dayField, dayStatus, booked, fees);

        /* At the inn */
        var innSection = el("section", "rs-section");
        var innTitle = el("h3");
        var innList = el("ul", "rs-list");
        var inn = {
            place: listItem("garden"),
            restaurant: listItem("restaurant"),
            parking: listItem("parking"),
            wifi: listItem("wifi")
        };
        Object.keys(inn).forEach(function (k) { innList.appendChild(inn[k].item); });
        innSection.append(innTitle, innList);

        /* Good to know */
        var rulesSection = el("section", "rs-section");
        var rulesTitle = el("h3");
        var rulesList = el("ul", "rs-list");
        var rules = {
            oneADay: listItem("oneDay"),
            times: listItem("clock"),
            confirm: listItem("phone")
        };
        Object.keys(rules).forEach(function (k) { rulesList.appendChild(rules[k].item); });
        rulesSection.append(rulesTitle, rulesList);

        body.append(title, price, place, description, daySection, innSection, rulesSection);
        scroller.append(gallery, body);

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
            scroller: scroller, photo: photo, close: close, figure: figure,
            title: title, price: price, placeText: placeText, description: description,
            daySection: daySection, dayTitle: dayTitle, dayLabel: dayLabel, day: day, dayStatus: dayStatus,
            booked: booked, feesText: feesText, innTitle: innTitle, inn: inn, rulesTitle: rulesTitle, rules: rules,
            barAmount: barAmount, barNote: barNote, book: book
        };

        if (typeof window.ZDDateDisplay === "function") window.ZDDateDisplay(day);

        close.addEventListener("click", function () { requestClose(); });
        dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            requestClose();
        });
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) requestClose();
        });
        day.addEventListener("change", renderDay);
        day.addEventListener("input", renderDay);
        book.addEventListener("click", bookEvent);
    }

    function renderDay() {
        if (!dialog || !currentKey) return;
        var t = tx();
        var value = els.day.value;
        var taken = value && data.taken.indexOf(value) >= 0;
        var inRange = value && (!data.firstDay || (value >= data.firstDay && value <= data.lastDay));

        els.day.min = data.firstDay || "";
        els.day.max = data.lastDay || "";

        els.dayStatus.className = "event-sheet-status";
        if (taken) {
            els.dayStatus.textContent = t.dayTaken(dayWords(value));
            els.dayStatus.classList.add("is-taken");
        } else if (inRange) {
            els.dayStatus.textContent = t.dayFree(dayWords(value));
            els.dayStatus.classList.add("room-avail", "is-free");
        } else {
            els.dayStatus.textContent = "";
        }
        els.dayStatus.hidden = !els.dayStatus.textContent;

        var upcoming = data.taken.slice(0, 5).map(dayWords).join(", ");
        els.booked.textContent = upcoming ? t.booked(upcoming) : "";
        els.booked.hidden = !upcoming;

        var action = !inRange ? "day" : taken ? "other" : "book";
        els.book.dataset.action = action;
        els.book.textContent = action === "day" ? t.chooseDay : action === "other" ? t.otherDay : t.book;
    }

    function renderAll() {
        var t = tx();
        var about = info(currentKey);
        var price = priceOf(currentKey);

        dialog.setAttribute("lang", lang());
        els.close.setAttribute("aria-label", t.close);
        if (els.photo.getAttribute("src") !== PHOTO[currentKey]) els.photo.src = PHOTO[currentKey];
        els.photo.alt = about.name;
        els.title.textContent = about.name;
        els.price.replaceChildren();
        if (price) els.price.append(el("strong", null, money(price)), el("span", null, " " + t.perEvent));
        else els.price.append(el("strong", null, t.askPrice));
        els.placeText.textContent = about.place;
        els.description.textContent = about.text;

        els.dayTitle.textContent = t.yourEvent;
        els.dayLabel.textContent = t.day;
        els.feesText.textContent = t.noFees;

        els.innTitle.textContent = t.atTheInn;
        els.inn.place.text.textContent = currentKey === "swimming-competition" ? t.pools : t.garden;
        els.inn.place.item.replaceChild(icon(currentKey === "swimming-competition" ? "pool" : "garden", 18), els.inn.place.item.firstChild);
        els.inn.restaurant.text.textContent = t.restaurant;
        els.inn.parking.text.textContent = t.parking;
        els.inn.wifi.text.textContent = t.wifi;

        els.rulesTitle.textContent = t.goodToKnow;
        Object.keys(els.rules).forEach(function (k) { els.rules[k].text.textContent = t[k]; });

        els.barAmount.textContent = price ? money(price) : t.askPrice;
        els.barNote.textContent = price ? t.perEvent : "";

        renderDay();
    }

    function open(key, fromHistory) {
        if (ORDER.indexOf(key) < 0) return false;
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
        if (switching) els.scroller.scrollTop = 0;

        if (!fromHistory) {
            try {
                history.pushState({ zdEvent: key }, "", "#event-" + key);
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
        if (returnFocus && document.contains(returnFocus) && returnFocus.focus) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
    }

    function requestClose() {
        if (pushedHistory && history.state && history.state.zdEvent) {
            history.back(); /* the popstate handler below finishes closing */
        } else {
            finishClose();
            if (/^#event-/.test(location.hash)) {
                try { history.replaceState(null, "", location.pathname + location.search + "#events"); } catch (error) { /* fine */ }
            }
        }
    }

    window.addEventListener("popstate", function () {
        var match = /^#event-(.+)$/.exec(location.hash);
        var isOpenNow = dialog && dialog.open;
        if (isOpenNow && !(history.state && history.state.zdEvent)) finishClose();
        else if (match && !isOpenNow) open(decodeURIComponent(match[1]), true);
    });

    function bookEvent() {
        var action = els.book.dataset.action;
        if (action !== "book") {
            els.daySection.scrollIntoView({ block: "start" });
            els.day.focus({ preventScroll: true });
            try { if (els.day.showPicker) els.day.showPicker(); } catch (error) { /* the field still opens on tap */ }
            return;
        }
        window.location.href = "events.html?type=" + encodeURIComponent(currentKey) + "&day=" + encodeURIComponent(els.day.value);
    }

    /* =========================================
       START
    ========================================= */

    function load() {
        return fetch((window.ZD_API || "/api") + "/events")
            .then(function (response) { return response.json(); })
            .then(function (result) {
                if (!result || !result.success) return;
                data.types = {};
                (result.types || []).forEach(function (type) { data.types[type.key] = type; });
                data.taken = result.takenDays || [];
                data.firstDay = result.firstDay || "";
                data.lastDay = result.lastDay || "";
                data.loaded = true;
                renderIntro();
                renderCards();
                if (dialog && dialog.open) renderAll();
            })
            .catch(function () { /* the cards keep "Ask us for the price" */ });
    }

    function init() {
        var grid = byId("eventGrid");
        if (!grid) return;

        var match = /^#event-(.+)$/.exec(location.hash);
        if (match) pendingKey = decodeURIComponent(match[1]);

        /* a tap anywhere on a card opens its details */
        grid.addEventListener("click", function (event) {
            var card = event.target.closest(".event-card");
            if (!card || !grid.contains(card)) return;
            if (window.getSelection && String(window.getSelection()).length) return; /* guest is selecting text */
            open(card.dataset.eventKey);
        });

        var language = byId("languageSelect");
        if (language) {
            language.addEventListener("change", function () {
                renderIntro();
                renderCards();
                if (dialog && dialog.open) renderAll();
            });
        }

        renderIntro();
        renderCards();
        if (pendingKey) open(pendingKey, true);
        load();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

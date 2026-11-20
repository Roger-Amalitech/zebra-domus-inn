/* Zebra Dormus Inn: "The Zebra Dormus experience" on the home page (#about).
   The card opens a full-screen view with the same look as a room's:
   photos of the inn to swipe through, what guests can enjoy, good-to-know notes,
   and "Book your stay" at the bottom with the lowest room price.
   A tap anywhere on the card opens it ("Book your stay" on the card keeps its own job).
   The view has its own link (…/#experience) and the phone's back button closes it.
   Text follows the language chosen in the header (EN / RW / FR). */
(function () {
    "use strict";

    /* The photos in the view, in order, with the caption key from translations.js */
    var PHOTOS = [
        { src: "images/main-house.jpg", caption: "capMainHouse", alt: "The main house of Zebra Dormus Inn and its garden" },
        { src: "images/pool.jpg", caption: "capPool", alt: "The outdoor pool" },
        { src: "images/pool-second.jpg", caption: "capPool2", alt: "Second swimming pool beside the inn" },
        { src: "images/lounge.jpg", caption: "capLounge", alt: "Bright lounge with cream sofas" },
        { src: "images/outdoor-seating.jpg", caption: "capGreen", alt: "Covered seating area with green sofas" },
        { src: "images/932183052.jpg", caption: "capGarden", alt: "The garden path with flowers and a golden arch" }
    ];

    var TEXT = {
        en: {
            explore: "Explore the inn",
            close: "Close",
            prev: "Previous photo",
            next: "Next photo",
            gallery: "Photos of the inn",
            of: function (i, n) { return i + " / " + n; },
            place: "Huye, Rwanda",
            enjoy: "What you can enjoy",
            pools: "Two outdoor pools",
            spa: "Spa and sauna",
            restaurant: "Restaurant and bar",
            lounge: "Lounge with an outdoor fireplace",
            bicycles: "Free bicycles for guests",
            garden: "The garden",
            wifi: "Free Wi-Fi",
            parking: "Free parking",
            goodToKnow: "Good to know",
            checkInTimes: "Check-in from 10:00 to 23:00",
            checkOutTime: "Check-out by 10:00",
            payWays: "Pay with MTN MoMo, Airtel Money, card, or at the inn when you arrive.",
            events: "House parties and swimming competitions: only when booked and confirmed by the inn.",
            from: function (amount) { return "From " + amount; },
            perNight: "per night",
            direct: "Book directly",
            noFees: "No booking-site fees",
            book: "Book your stay"
        },
        rw: {
            explore: "Reba ibiri ku icumbi",
            close: "Funga",
            prev: "Ifoto ibanza",
            next: "Ifoto ikurikira",
            gallery: "Amafoto y'icumbi",
            of: function (i, n) { return i + " / " + n; },
            place: "Huye, Rwanda",
            enjoy: "Ibyo wishimira hano",
            pools: "Ibidendezi bibiri byo koga byo hanze",
            spa: "Spa na sauna",
            restaurant: "Resitora n'akabari",
            lounge: "Aho kwicarira hari n'umuriro wo hanze",
            bicycles: "Amagare y'ubuntu ku bashyitsi",
            garden: "Ubusitani",
            wifi: "Wi-Fi y'ubuntu",
            parking: "Parikingi y'ubuntu",
            goodToKnow: "Ibyo ukwiye kumenya",
            checkInTimes: "Kwakirwa: kuva saa 10:00 kugeza saa 23:00",
            checkOutTime: "Kuvamo: bitarenze saa 10:00",
            payWays: "Wishyura ukoresheje MTN MoMo, Airtel Money, ikarita, cyangwa ukishyurira ku icumbi ugeze yo.",
            events: "Ibirori n'amarushanwa yo koga: byemewe gusa iyo byabanje kubikwa kandi icumbi rikabyemeza.",
            from: function (amount) { return "Guhera kuri " + amount; },
            perNight: "ku ijoro",
            direct: "Bikira ku icumbi",
            noFees: "Nta mafaranga y'imbuga zo kubika",
            book: "Bika icyumba cyawe"
        },
        fr: {
            explore: "Découvrir l'auberge",
            close: "Fermer",
            prev: "Photo précédente",
            next: "Photo suivante",
            gallery: "Photos de l'auberge",
            of: function (i, n) { return i + " / " + n; },
            place: "Huye, Rwanda",
            enjoy: "Ce qui vous attend",
            pools: "Deux piscines extérieures",
            spa: "Spa et sauna",
            restaurant: "Restaurant et bar",
            lounge: "Salon avec cheminée extérieure",
            bicycles: "Vélos gratuits pour les clients",
            garden: "Le jardin",
            wifi: "Wi-Fi gratuit",
            parking: "Parking gratuit",
            goodToKnow: "Bon à savoir",
            checkInTimes: "Arrivée de 10h00 à 23h00",
            checkOutTime: "Départ avant 10h00",
            payWays: "Payez par MTN MoMo, Airtel Money, carte, ou à l'auberge à votre arrivée.",
            events: "Fêtes privées et compétitions de natation : uniquement sur réservation confirmée par l'auberge.",
            from: function (amount) { return "À partir de " + amount; },
            perNight: "par nuit",
            direct: "Réservez en direct",
            noFees: "Aucuns frais de plateforme",
            book: "Réservez votre séjour"
        }
    };

    /* Icons: fixed markup, no guest data goes in here. */
    var SVG = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    var ICONS = {
        close: '<svg ' + SVG + '><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
        prev: '<svg ' + SVG + '><path d="M15 18l-6-6 6-6"/></svg>',
        next: '<svg ' + SVG + '><path d="M9 6l6 6-6 6"/></svg>',
        arrow: '<svg ' + SVG + '><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
        place: '<svg ' + SVG + '><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
        pool: '<svg ' + SVG + '><path d="M2 12c2 0 2-1.5 4-1.5S8 12 10 12s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 17c2 0 2-1.5 4-1.5S8 17 10 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M8 9V4a2 2 0 0 1 4 0"/><path d="M16 9V4a2 2 0 0 0-4 0"/></svg>',
        spa: '<svg ' + SVG + '><path d="M12 22c4-2.5 6-6 6-10a6 6 0 0 0-12 0c0 4 2 7.5 6 10z"/><path d="M12 22V12"/><path d="M12 15l-3-3M12 13l3-3"/></svg>',
        restaurant: '<svg ' + SVG + '><path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/></svg>',
        fire: '<svg ' + SVG + '><path d="M12 22a7 7 0 0 0 7-7c0-4-3-6.5-4-10-2 1.5-3 3.5-3 6-1-1-2-2-2.5-3.5C7.5 9.5 5 12 5 15a7 7 0 0 0 7 7z"/><path d="M12 22a3 3 0 0 0 3-3c0-2-1.5-3-3-5-1.5 2-3 3-3 5a3 3 0 0 0 3 3z"/></svg>',
        bicycle: '<svg ' + SVG + '><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17L9 9h6l3.5 8"/><path d="M9 9l3 8h-6.5"/><path d="M8 6h3"/><path d="M15 9l-1-3h2.5"/></svg>',
        garden: '<svg ' + SVG + '><path d="M12 22V11"/><path d="M12 11c0-4 2.5-7 7-7 0 4.5-3 7-7 7z"/><path d="M12 15c0-3-2-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z"/><path d="M5 22h14"/></svg>',
        wifi: '<svg ' + SVG + '><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M1.5 9a16 16 0 0 1 21 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><path d="M12 20h.01"/></svg>',
        parking: '<svg ' + SVG + '><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>',
        clockIn: '<svg ' + SVG + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        clockOut: '<svg ' + SVG + '><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg>',
        wallet: '<svg ' + SVG + '><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>',
        party: '<svg ' + SVG + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4"/></svg>'
    };

    /* what you can enjoy, in order: [text key, icon] */
    var AMENITIES = [
        ["pools", "pool"], ["spa", "spa"], ["restaurant", "restaurant"], ["lounge", "fire"],
        ["bicycles", "bicycle"], ["garden", "garden"], ["wifi", "wifi"], ["parking", "parking"]
    ];
    var NOTES = [["checkInTimes", "clockIn"], ["checkOutTime", "clockOut"], ["payWays", "wallet"], ["events", "party"]];

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

    /* the page's own words (title, text, photo captions) from translations.js */
    function pageWord(key, fallback) {
        var words = typeof getCurrentTranslations === "function" ? getCurrentTranslations() : null;
        return (words && words[key]) || fallback;
    }

    function money(amount) {
        return typeof formatRwf === "function" ? formatRwf(amount) : "RWF " + Number(amount).toLocaleString("en-US");
    }

    /* the cheapest room per night, from the rooms the page already loaded */
    function lowestPrice() {
        var rooms = typeof zebradormusRooms !== "undefined" && Array.isArray(zebradormusRooms) ? zebradormusRooms : [];
        var lowest = null;
        rooms.forEach(function (room) {
            var amount = Number(room.pricePerNight != null ? room.pricePerNight : room.price);
            if (isFinite(amount) && amount > 0 && (lowest === null || amount < lowest)) lowest = amount;
        });
        return lowest;
    }

    /* =========================================
       THE VIEW
    ========================================= */

    var dialog = null;
    var els = {};
    var index = 0;
    var target = null; // the photo the arrows are sliding to
    var targetTimer = null;
    var pushed = false;
    var returnFocus = null;

    function listItem(iconName) {
        var item = el("li");
        var text = el("span");
        item.append(icon(iconName, 20), text);
        return { item: item, text: text };
    }

    function build() {
        if (dialog) return;

        dialog = el("dialog", "room-sheet xp-sheet");
        dialog.setAttribute("aria-labelledby", "xpTitle");

        var scroller = el("div", "rs-scroll");

        /* photos: swipe sideways, or the arrows on a computer */
        var gallery = el("div", "rs-gallery xp-gallery");
        var track = el("div", "xp-track");
        track.tabIndex = 0;
        track.setAttribute("role", "region");
        var slides = PHOTOS.map(function (p) {
            var figure = el("figure", "xp-slide");
            var img = el("img");
            img.src = p.src;
            img.alt = p.alt;
            img.decoding = "async";
            img.draggable = false;
            img.loading = "lazy";
            figure.appendChild(img);
            track.appendChild(figure);
            return figure;
        });
        var close = el("button", "glass-button rs-close");
        close.type = "button";
        close.append(icon("close", 20));
        var prev = el("button", "glass-button xp-arrow xp-prev");
        prev.type = "button";
        prev.append(icon("prev", 22));
        var next = el("button", "glass-button xp-arrow xp-next");
        next.type = "button";
        next.append(icon("next", 22));
        var caption = el("p", "glass-pill xp-caption");
        var count = el("p", "glass-pill xp-count");
        count.setAttribute("aria-live", "polite");
        gallery.append(track, close, prev, next, caption, count);

        var body = el("div", "rs-body");
        var eyebrow = el("p", "xp-eyebrow");
        var title = el("h2", "rs-title");
        title.id = "xpTitle";
        title.tabIndex = -1;
        var place = el("p", "rs-meta");
        var placeText = el("span");
        place.append(icon("place", 16), placeText);
        var description = el("p", "rs-description");

        var enjoySection = el("section", "rs-section");
        var enjoyTitle = el("h3");
        var enjoyList = el("ul", "rs-list xp-amenities");
        var enjoy = {};
        AMENITIES.forEach(function (a) {
            enjoy[a[0]] = listItem(a[1]);
            enjoyList.appendChild(enjoy[a[0]].item);
        });
        enjoySection.append(enjoyTitle, enjoyList);

        var notesSection = el("section", "rs-section");
        var notesTitle = el("h3");
        var notesList = el("ul", "rs-list");
        var notes = {};
        NOTES.forEach(function (n) {
            notes[n[0]] = listItem(n[1]);
            notesList.appendChild(notes[n[0]].item);
        });
        notesSection.append(notesTitle, notesList);

        body.append(eyebrow, title, place, description, enjoySection, notesSection);
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
            scroller: scroller, track: track, slides: slides, close: close, prev: prev, next: next,
            caption: caption, count: count, eyebrow: eyebrow, title: title, placeText: placeText,
            description: description, enjoyTitle: enjoyTitle, enjoy: enjoy, notesTitle: notesTitle,
            notes: notes, barAmount: barAmount, barNote: barNote, book: book
        };

        close.addEventListener("click", requestClose);
        dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            requestClose();
        });
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) requestClose();
        });
        prev.addEventListener("click", function () { go(index - 1); });
        next.addEventListener("click", function () { go(index + 1); });
        dialog.addEventListener("keydown", function (event) {
            if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
            if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        });

        /* the counter follows the swipe */
        var ticking = false;
        track.addEventListener("scroll", function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () {
                ticking = false;
                var width = track.clientWidth || 1;
                var now = Math.round(track.scrollLeft / width);
                if (target !== null) {
                    if (now !== target) return; // still sliding to the photo asked for
                    target = null;
                }
                if (now !== index) {
                    index = Math.max(0, Math.min(PHOTOS.length - 1, now));
                    renderPhoto();
                }
            });
        }, { passive: true });

        /* drag with the mouse on a computer, like a swipe */
        var startX = null;
        var startLeft = 0;
        track.addEventListener("pointerdown", function (event) {
            if (event.pointerType !== "mouse") return;
            startX = event.clientX;
            startLeft = track.scrollLeft;
        });
        window.addEventListener("pointerup", function (event) {
            if (startX === null) return;
            var dx = event.clientX - startX;
            startX = null;
            if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
            else track.scrollTo({ left: startLeft });
        });

        book.addEventListener("click", function () {
            if (typeof window.zdGoToBooking === "function") window.zdGoToBooking();
            else window.location.href = "book.html";
        });
    }

    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function go(i) {
        var n = PHOTOS.length;
        index = (i + n) % n; // after the last photo comes the first
        target = index;
        clearTimeout(targetTimer);
        targetTimer = setTimeout(function () { target = null; }, 1000);
        els.track.scrollTo({ left: index * els.track.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
        renderPhoto();
    }

    function renderPhoto() {
        var p = PHOTOS[index];
        els.caption.textContent = pageWord(p.caption, "");
        els.caption.hidden = !els.caption.textContent;
        els.count.textContent = tx().of(index + 1, PHOTOS.length);
        els.slides.forEach(function (slide, j) {
            slide.setAttribute("aria-hidden", j === index ? "false" : "true");
        });
        // the next photo is ready before it is asked for
        var nextSlide = els.slides[(index + 1) % PHOTOS.length];
        if (nextSlide) nextSlide.firstChild.loading = "eager";
    }

    function renderAll() {
        var t = tx();
        dialog.setAttribute("lang", lang());
        els.close.setAttribute("aria-label", t.close);
        els.prev.setAttribute("aria-label", t.prev);
        els.next.setAttribute("aria-label", t.next);
        els.track.setAttribute("aria-label", t.gallery);

        els.eyebrow.textContent = pageWord("experience", "The Zebra Dormus experience");
        els.title.textContent = pageWord("aboutTitle", "More than a stay. A place to feel at home.");
        els.placeText.textContent = t.place;
        els.description.textContent = pageWord("aboutDescription", "");

        els.enjoyTitle.textContent = t.enjoy;
        Object.keys(els.enjoy).forEach(function (k) { els.enjoy[k].text.textContent = t[k]; });
        els.notesTitle.textContent = t.goodToKnow;
        Object.keys(els.notes).forEach(function (k) { els.notes[k].text.textContent = t[k]; });

        var lowest = lowestPrice();
        els.barAmount.textContent = lowest ? t.from(money(lowest)) : t.direct;
        els.barNote.textContent = lowest ? t.perNight : t.noFees;
        els.book.textContent = t.book;

        renderPhoto();
    }

    function open(fromHistory) {
        build();
        renderAll();
        if (!dialog.open) {
            returnFocus = document.activeElement;
            dialog.showModal();
            document.documentElement.classList.add("rs-lock");
            index = 0;
            els.track.scrollLeft = 0;
            els.scroller.scrollTop = 0;
            renderPhoto();
            els.title.focus({ preventScroll: true });
        }
        if (!fromHistory) {
            try {
                history.pushState({ zdExperience: true }, "", "#experience");
                pushed = true;
            } catch (error) {
                pushed = false;
            }
        }
    }

    function finishClose() {
        pushed = false;
        if (dialog && dialog.open) dialog.close();
        document.documentElement.classList.remove("rs-lock");
        if (returnFocus && document.contains(returnFocus) && returnFocus.focus) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
    }

    function requestClose() {
        if (pushed && history.state && history.state.zdExperience) {
            history.back(); /* the popstate handler below finishes closing */
        } else {
            finishClose();
            if (location.hash === "#experience") {
                try { history.replaceState(null, "", location.pathname + location.search + "#about"); } catch (error) { /* fine */ }
            }
        }
    }

    window.addEventListener("popstate", function () {
        var isOpen = dialog && dialog.open;
        if (isOpen && !(history.state && history.state.zdExperience)) finishClose();
        else if (!isOpen && location.hash === "#experience") open(true);
    });

    /* =========================================
       THE CARD
    ========================================= */

    function init() {
        var card = document.querySelector("#about .about-card");
        if (!card) return;
        card.classList.add("has-details");

        /* a clear link under the text */
        var more = el("button", "room-more about-more");
        more.type = "button";
        var moreText = el("span");
        more.append(moreText, icon("arrow", 16));
        var bookLink = card.querySelector(".about-body .btn");
        if (bookLink) bookLink.parentNode.insertBefore(more, bookLink);
        else card.querySelector(".about-body").appendChild(more);

        function label() {
            var t = tx();
            moreText.textContent = t.explore;
        }

        /* a tap anywhere on the card opens the view; "Book your stay" keeps its own job */
        card.addEventListener("click", function (event) {
            if (event.target.closest("a")) return;
            if (window.getSelection && String(window.getSelection()).length) return; /* guest is selecting text */
            open(false);
        });

        var language = byId("languageSelect");
        if (language) {
            language.addEventListener("change", function () {
                setTimeout(function () { // after translations.js has changed the page's words
                    label();
                    if (dialog && dialog.open) renderAll();
                }, 0);
            });
        }

        label();
        if (location.hash === "#experience") open(true);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

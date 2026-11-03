/* Zebra Domus Inn: one "Check-in – Check-out" field instead of two.
   Tapping it opens a calendar: the guest taps the arrival day, then the departure day,
   and sees how many nights. On a phone the calendar slides up from the bottom with one
   month; on a tablet or computer it opens next to the field with two months.

   The two real date fields (#checkIn and #checkOut) stay in the page, hidden, and the
   calendar writes into them, so the booking form, the room prices and the room details
   keep working exactly as before. The room details view uses the same calendar
   through window.ZDDateRange. Text follows the language chosen in the header. */
(function () {
    "use strict";

    var TEXT = {
        en: {
            label: "Check-in – Check-out",
            add: "Add dates",
            title: "Choose your dates",
            pickIn: "Choose your check-in date",
            pickOut: "Now choose your check-out date",
            clear: "Clear",
            done: "Done",
            close: "Close",
            prevMonth: "Previous month",
            nextMonth: "Next month",
            weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
            nights: function (n) { return n + (n === 1 ? " night" : " nights"); }
        },
        rw: {
            label: "Kuhagera – Kugenda",
            add: "Hitamo amatariki",
            title: "Hitamo amatariki",
            pickIn: "Hitamo umunsi uzahagera",
            pickOut: "Noneho hitamo umunsi uzagenda",
            clear: "Siba",
            done: "Emeza",
            close: "Funga",
            prevMonth: "Ukwezi gushize",
            nextMonth: "Ukwezi gutaha",
            weekdays: ["Mbe", "Kab", "Gtu", "Kan", "Gnu", "Gnd", "Cyu"],
            nights: function (n) { return (n === 1 ? "ijoro " : "amajoro ") + n; }
        },
        fr: {
            label: "Arrivée – Départ",
            add: "Choisir les dates",
            title: "Choisissez vos dates",
            pickIn: "Choisissez la date d'arrivée",
            pickOut: "Choisissez maintenant la date de départ",
            clear: "Effacer",
            done: "Valider",
            close: "Fermer",
            prevMonth: "Mois précédent",
            nextMonth: "Mois suivant",
            weekdays: ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"],
            nights: function (n) { return n + (n === 1 ? " nuit" : " nuits"); }
        }
    };

    /* Kinyarwanda names (many browsers have no Kinyarwanda calendar names built in) */
    var RW = {
        months: ["Mutarama", "Gashyantare", "Werurwe", "Mata", "Gicurasi", "Kamena", "Nyakanga", "Kanama", "Nzeri", "Ukwakira", "Ugushyingo", "Ukuboza"],
        monthsShort: ["Mut.", "Gas.", "Wer.", "Mat.", "Gic.", "Kam.", "Nya.", "Kan.", "Nze.", "Ukw.", "Ugu.", "Uku."],
        days: ["Kuwa mbere", "Kuwa kabiri", "Kuwa gatatu", "Kuwa kane", "Kuwa gatanu", "Kuwa gatandatu", "Ku cyumweru"],
        daysShort: ["Mbe.", "Kab.", "Gtu.", "Kan.", "Gnu.", "Gnd.", "Cyu."]
    };
    var LOCALE = { en: "en-GB", fr: "fr-FR" };
    var BOOKING_MONTHS_AHEAD = 24; /* how far ahead guests can book */

    var SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var ICONS = {
        calendar: '<svg width="16" height="16" ' + SVG + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
        close: '<svg width="18" height="18" ' + SVG + '><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
        prev: '<svg width="18" height="18" ' + SVG + '><path d="M15 18l-6-6 6-6"/></svg>',
        next: '<svg width="18" height="18" ' + SVG + '><path d="M9 18l6-6-6-6"/></svg>'
    };

    /* ---------- small helpers ---------- */

    function byId(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function icon(name) {
        var template = document.createElement("template");
        template.innerHTML = ICONS[name];
        return template.content.firstElementChild;
    }

    function lang() {
        var select = byId("languageSelect");
        var value = (select && select.value) || "en";
        return TEXT[value] ? value : "en";
    }

    function tx() { return TEXT[lang()]; }

    function parse(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
        var parts = value.split("-").map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function iso(date) {
        var m = String(date.getMonth() + 1);
        var d = String(date.getDate());
        return date.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (d.length < 2 ? "0" + d : d);
    }

    function addDays(date, n) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n); }
    function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
    function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
    function today() { var now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
    function lastBookable() { var t = today(); return new Date(t.getFullYear(), t.getMonth() + BOOKING_MONTHS_AHEAD + 1, 0); }
    function mondayIndex(date) { return (date.getDay() + 6) % 7; }
    function nightsBetween(a, b) { return Math.round((b - a) / 86400000); }

    function shortDate(date) {
        if (lang() === "rw") return RW.daysShort[mondayIndex(date)] + " " + date.getDate() + " " + RW.monthsShort[date.getMonth()];
        return new Intl.DateTimeFormat(LOCALE[lang()], { weekday: "short", day: "numeric", month: "short" }).format(date);
    }

    function monthTitle(date) {
        if (lang() === "rw") return RW.months[date.getMonth()] + " " + date.getFullYear();
        var text = new Intl.DateTimeFormat(LOCALE[lang()], { month: "long", year: "numeric" }).format(date);
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function longDate(date) {
        if (lang() === "rw") return RW.days[mondayIndex(date)] + " " + date.getDate() + " " + RW.months[date.getMonth()] + " " + date.getFullYear();
        return new Intl.DateTimeFormat(LOCALE[lang()], { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
    }

    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function wide() {
        return window.matchMedia && window.matchMedia("(min-width: 768px)").matches;
    }

    /* the stay as it is in the real fields */
    function currentStay() {
        var start = parse(byId("checkIn") && byId("checkIn").value);
        var end = parse(byId("checkOut") && byId("checkOut").value);
        if (start && end && end <= start) end = null;
        return { start: start, end: end };
    }

    /* write a date into a real field and tell the rest of the page */
    function write(id, value) {
        var input = byId(id);
        if (!input || input.value === value) return;
        input.value = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }


    /* =========================================
       THE FIELD (one "Check-in – Check-out" button)
    ========================================= */

    var triggers = [];

    function makeTrigger() {
        var button = el("button", "search-field date-range");
        button.type = "button";
        button.setAttribute("aria-haspopup", "dialog");
        var label = el("span", "date-range-label");
        var control = el("span", "control");
        var value = el("span", "date-range-value");
        var nights = el("span", "date-range-nights");
        control.append(icon("calendar"), value, nights);
        button.append(label, control);
        button.addEventListener("click", function () { open(button); });
        triggers.push({ button: button, label: label, value: value, nights: nights });
        updateTrigger(triggers[triggers.length - 1]);
        return button;
    }

    function updateTrigger(item) {
        var t = tx();
        var stay = currentStay();
        var valueText = t.add;
        var nightsText = "";
        if (stay.start && stay.end) {
            valueText = shortDate(stay.start) + " – " + shortDate(stay.end);
            nightsText = t.nights(nightsBetween(stay.start, stay.end));
        } else if (stay.start) {
            valueText = shortDate(stay.start) + " – …";
        }
        item.label.textContent = t.label;
        item.value.textContent = valueText;
        item.value.classList.toggle("is-empty", !stay.start);
        item.nights.textContent = nightsText;
        item.button.setAttribute("aria-label", t.label + ": " + valueText + (nightsText ? ", " + nightsText : ""));
    }

    function updateTriggers() { triggers.forEach(updateTrigger); }


    /* =========================================
       THE CALENDAR
    ========================================= */

    var dialog = null;
    var els = {};
    var state = { start: null, end: null, hover: null, focus: null, view: null, months: 1, anchor: null };
    var closeTimer = 0;

    function build() {
        if (dialog) return;

        dialog = el("dialog", "dr-picker");
        dialog.setAttribute("aria-labelledby", "drTitle");

        var panel = el("div", "dr-panel");

        var head = el("div", "dr-head");
        var title = el("h2", "dr-title");
        title.id = "drTitle";
        var close = el("button", "dr-close");
        close.type = "button";
        close.append(icon("close"));
        head.append(title, close);

        var hint = el("p", "dr-hint");
        hint.setAttribute("aria-live", "polite");

        var body = el("div", "dr-body");
        var prev = el("button", "dr-nav-btn dr-prev");
        prev.type = "button";
        prev.append(icon("prev"));
        var next = el("button", "dr-nav-btn dr-next");
        next.type = "button";
        next.append(icon("next"));
        var months = el("div", "dr-months");
        body.append(prev, next, months);

        var foot = el("div", "dr-foot");
        var summary = el("div", "dr-summary");
        var summaryDates = el("strong");
        var summaryNights = el("span");
        summary.append(summaryDates, summaryNights);
        var clear = el("button", "dr-clear");
        clear.type = "button";
        var done = el("button", "btn btn-primary dr-done");
        done.type = "button";
        foot.append(summary, clear, done);

        panel.append(head, hint, body, foot);
        dialog.appendChild(panel);
        document.body.appendChild(dialog);

        els = {
            title: title, close: close, hint: hint, prev: prev, next: next, months: months,
            summaryDates: summaryDates, summaryNights: summaryNights, clear: clear, done: done
        };

        close.addEventListener("click", closePicker);
        done.addEventListener("click", closePicker);
        clear.addEventListener("click", function () {
            clearTimeout(closeTimer);
            state.start = null;
            state.end = null;
            state.hover = null;
            write("checkIn", "");
            write("checkOut", "");
            paint();
        });
        prev.addEventListener("click", function () { shiftView(-1); });
        next.addEventListener("click", function () { shiftView(1); });

        /* a tap on the dimmed page outside the calendar closes it */
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) closePicker();
        });
        dialog.addEventListener("close", function () {
            clearTimeout(closeTimer);
            document.documentElement.classList.remove("dr-lock");
            window.removeEventListener("resize", onResize);
            var anchor = state.anchor;
            state.anchor = null;
            if (anchor && document.contains(anchor) && anchor.focus) anchor.focus({ preventScroll: true });
        });

        months.addEventListener("click", function (event) {
            var day = event.target.closest(".dr-day");
            if (day && !day.disabled) pick(parse(day.dataset.date));
        });
        /* on a computer, show the stay while the mouse moves over the check-out day */
        months.addEventListener("mouseover", function (event) {
            if (!state.start || state.end) return;
            var day = event.target.closest(".dr-day");
            var hover = day && !day.disabled ? parse(day.dataset.date) : null;
            if ((hover && hover.getTime()) !== (state.hover && state.hover.getTime())) {
                state.hover = hover;
                paint();
            }
        });
        months.addEventListener("mouseleave", function () {
            if (state.hover) { state.hover = null; paint(); }
        });
        months.addEventListener("keydown", onKey);
    }

    function render() {
        var t = tx();
        var first = today();
        var last = lastBookable();

        dialog.setAttribute("lang", lang());
        els.title.textContent = t.title;
        els.close.setAttribute("aria-label", t.close);
        els.prev.setAttribute("aria-label", t.prevMonth);
        els.next.setAttribute("aria-label", t.nextMonth);
        els.clear.textContent = t.clear;
        els.done.textContent = t.done;
        els.prev.disabled = state.view <= monthStart(first);
        els.next.disabled = addMonths(state.view, state.months - 1) >= monthStart(last);

        var blocks = [];
        for (var m = 0; m < state.months; m++) {
            var monthDate = addMonths(state.view, m);
            var block = el("div", "dr-month");
            var heading = el("div", "dr-month-title", monthTitle(monthDate));
            var weekdays = el("div", "dr-weekdays");
            weekdays.setAttribute("aria-hidden", "true");
            t.weekdays.forEach(function (name) { weekdays.appendChild(el("span", null, name)); });
            var grid = el("div", "dr-grid");
            grid.setAttribute("role", "group");
            grid.setAttribute("aria-label", heading.textContent);

            for (var blank = mondayIndex(monthDate); blank > 0; blank--) grid.appendChild(el("span", "dr-blank"));
            var daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
            for (var d = 1; d <= daysInMonth; d++) {
                var date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
                var day = el("button", "dr-day");
                day.type = "button";
                day.dataset.date = iso(date);
                day.tabIndex = -1;
                day.disabled = date < first || date > last;
                day.setAttribute("aria-label", longDate(date));
                day.appendChild(el("span", "dr-num", String(d)));
                grid.appendChild(day);
            }
            block.append(heading, weekdays, grid);
            blocks.push(block);
        }
        els.months.replaceChildren.apply(els.months, blocks);
        paint();
    }

    /* colour the days for the current choice, and update the words around the calendar */
    function paint() {
        var t = tx();
        var s = state.start;
        var e = state.end;
        var preview = !e && s && state.hover && state.hover > s ? state.hover : null;
        var todayTime = today().getTime();
        var focusIso = state.focus ? iso(state.focus) : "";
        var focusable = null;
        var firstEnabled = null;

        Array.prototype.forEach.call(els.months.querySelectorAll(".dr-day"), function (day) {
            var time = parse(day.dataset.date).getTime();
            var isStart = !!s && time === s.getTime();
            var isEnd = !!e && time === e.getTime();
            var isPreviewEnd = !!preview && time === preview.getTime();
            day.classList.toggle("is-today", time === todayTime);
            day.classList.toggle("is-start", isStart);
            day.classList.toggle("is-end", isEnd);
            day.classList.toggle("has-range", isStart && !!(e || preview));
            day.classList.toggle("is-range", !!(s && e) && time > s.getTime() && time < e.getTime());
            day.classList.toggle("is-preview", !!preview && time > s.getTime() && time < preview.getTime());
            day.classList.toggle("is-preview-end", isPreviewEnd);
            day.setAttribute("aria-pressed", isStart || isEnd ? "true" : "false");
            day.tabIndex = -1;
            if (!day.disabled) {
                if (!firstEnabled) firstEnabled = day;
                if (day.dataset.date === focusIso) focusable = day;
            }
        });
        if (focusable || firstEnabled) (focusable || firstEnabled).tabIndex = 0;

        els.hint.textContent = !s ? t.pickIn : !e ? t.pickOut : "";
        els.hint.hidden = !!(s && e);
        if (s && e) {
            els.summaryDates.textContent = shortDate(s) + " – " + shortDate(e);
            els.summaryNights.textContent = t.nights(nightsBetween(s, e));
        } else if (s) {
            els.summaryDates.textContent = shortDate(s) + " – …";
            els.summaryNights.textContent = "";
        } else {
            els.summaryDates.textContent = t.add;
            els.summaryNights.textContent = "";
        }
        els.summaryNights.hidden = !els.summaryNights.textContent;
        els.done.disabled = !(s && e);
        els.clear.hidden = !s;
    }

    function pick(date) {
        clearTimeout(closeTimer);
        if (!state.start || state.end || date <= state.start) {
            state.start = date;
            state.end = null;
        } else {
            state.end = date;
        }
        state.hover = null;
        state.focus = date;
        paint();
        focusDay(date);

        if (state.start && state.end) {
            write("checkIn", iso(state.start));
            write("checkOut", iso(state.end));
            /* a short pause so the guest sees the stay highlighted, then close */
            closeTimer = setTimeout(closePicker, reduceMotion() ? 0 : 320);
        }
    }

    function shiftView(step) {
        var first = monthStart(today());
        var lastStart = addMonths(monthStart(lastBookable()), -(state.months - 1));
        var view = addMonths(state.view, step);
        if (view < first) view = first;
        if (view > lastStart) view = lastStart;
        state.view = view;
        render();
    }

    function focusDay(date) {
        var day = els.months.querySelector('.dr-day[data-date="' + iso(date) + '"]');
        if (day && !day.disabled) day.focus({ preventScroll: true });
    }

    /* arrow keys move a day or a week, Page Up / Page Down a month */
    function onKey(event) {
        var day = event.target.closest(".dr-day");
        if (!day) return;
        var date = parse(day.dataset.date);
        var target = null;
        switch (event.key) {
            case "ArrowLeft": target = addDays(date, -1); break;
            case "ArrowRight": target = addDays(date, 1); break;
            case "ArrowUp": target = addDays(date, -7); break;
            case "ArrowDown": target = addDays(date, 7); break;
            case "Home": target = addDays(date, -mondayIndex(date)); break;
            case "End": target = addDays(date, 6 - mondayIndex(date)); break;
            case "PageUp": target = new Date(date.getFullYear(), date.getMonth() - 1, Math.min(date.getDate(), 28)); break;
            case "PageDown": target = new Date(date.getFullYear(), date.getMonth() + 1, Math.min(date.getDate(), 28)); break;
            default: return;
        }
        event.preventDefault();
        if (target < today()) target = today();
        if (target > lastBookable()) target = lastBookable();
        state.focus = target;
        var lastShown = new Date(state.view.getFullYear(), state.view.getMonth() + state.months, 0);
        if (target < state.view || target > lastShown) {
            state.view = target < state.view
                ? monthStart(target)
                : addMonths(monthStart(target), -(state.months - 1));
            render();
        } else {
            paint();
        }
        focusDay(target);
    }

    /* on a tablet or computer, open next to the field; on a phone, from the bottom */
    function place() {
        if (!dialog || !dialog.open) return;
        if (!wide()) {
            dialog.style.top = "";
            dialog.style.left = "";
            return;
        }
        var width = dialog.offsetWidth;
        var height = dialog.offsetHeight;
        var top;
        var left;
        var anchor = state.anchor;
        var box = anchor && document.contains(anchor) ? anchor.getBoundingClientRect() : null;
        if (box && box.bottom > 0 && box.top < window.innerHeight) {
            top = box.bottom + 8;
            if (top + height > window.innerHeight - 12) top = box.top - height - 8; /* no room below: open above */
            left = box.left;
        } else {
            top = (window.innerHeight - height) / 2;
            left = (window.innerWidth - width) / 2;
        }
        top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
        left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
        dialog.style.top = Math.round(top) + "px";
        dialog.style.left = Math.round(left) + "px";
    }

    function onResize() {
        var months = wide() ? 2 : 1;
        if (months !== state.months) {
            state.months = months;
            dialog.classList.toggle("is-popover", months === 2);
            render();
        }
        place();
    }

    function open(anchor) {
        build();
        clearTimeout(closeTimer);
        var stay = currentStay();
        var first = today();
        if (stay.start && stay.start < first) stay = { start: null, end: null };
        state.start = stay.start;
        state.end = stay.end;
        state.hover = null;
        state.focus = stay.start || first;
        state.months = wide() ? 2 : 1;
        state.view = monthStart(state.focus);
        state.anchor = anchor || null;
        dialog.classList.toggle("is-popover", state.months === 2);
        render();

        if (!dialog.open) {
            dialog.showModal();
            document.documentElement.classList.add("dr-lock");
            window.addEventListener("resize", onResize);
        }
        place();
        focusDay(state.focus);
    }

    function closePicker() {
        clearTimeout(closeTimer);
        if (dialog && dialog.open) dialog.close();
    }


    /* =========================================
       SET UP THE PAGE
    ========================================= */

    function init() {
        var checkIn = byId("checkIn");
        var checkOut = byId("checkOut");
        if (!checkIn || !checkOut || typeof HTMLDialogElement === "undefined") return;

        /* the search box at the top: swap the two date boxes for one field */
        var dateGrid = document.querySelector(".search-card .date-grid");
        var searchTrigger = null;
        if (dateGrid) {
            searchTrigger = makeTrigger();
            searchTrigger.id = "dateRange";
            dateGrid.parentNode.insertBefore(searchTrigger, dateGrid);
            dateGrid.hidden = true;
        }

        /* keep every field up to date when the dates change anywhere on the page */
        checkIn.addEventListener("change", updateTriggers);
        checkOut.addEventListener("change", updateTriggers);
        var language = byId("languageSelect");
        if (language) {
            language.addEventListener("change", function () {
                updateTriggers();
                if (dialog && dialog.open) render();
            });
        }

        /* "Change" next to the dates in the booking form opens the calendar there */
        var stayCard = document.querySelector(".stay-summary");
        var change = stayCard && stayCard.querySelector('a[href="#dates"]');
        if (change) {
            change.addEventListener("click", function (event) {
                event.preventDefault();
                open(stayCard);
            });
        }

        /* "Confirm booking" without dates: open the calendar instead of a hidden error */
        var invalidShown = false;
        [checkIn, checkOut].forEach(function (input) {
            input.addEventListener("invalid", function (event) {
                event.preventDefault();
                if (invalidShown) return;
                invalidShown = true;
                setTimeout(function () { invalidShown = false; }, 500);
                if (stayCard) stayCard.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
                setTimeout(function () { open(stayCard || searchTrigger); }, reduceMotion() ? 0 : 350);
            });
        });
    }

    window.ZDDateRange = { open: open, makeTrigger: makeTrigger };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

/* Zebra Domus Inn: the event page (events.html).
   Guests ask for a house party or a swimming competition:
   - the events are shown as cards with their price (set by the owner in the dashboard)
   - the day is checked against the days that already have an event (one per day)
   - the request is sent to the inn, which confirms it by phone.
   Guests arrive from the home page, for example events.html?type=swimming-competition. */
(function () {
    "use strict";

    var IMAGES = { "house-party": "images/932183308.jpg", "swimming-competition": "images/pool.jpg" };

    var RW_DAYS = ["Ku cyumweru", "Ku wa mbere", "Ku wa kabiri", "Ku wa gatatu", "Ku wa kane", "Ku wa gatanu", "Ku wa gatandatu"];
    var RW_MONTHS = ["Mutarama", "Gashyantare", "Werurwe", "Mata", "Gicurasi", "Kamena", "Nyakanga", "Kanama", "Nzeri", "Ukwakira", "Ugushyingo", "Ukuboza"];

    var TEXT = {
        en: {
            back: "Back to the inn", backHome: "Back to Zebra Domus",
            title: "Book an event",
            intro: "A house party in the garden or a swimming competition at the pool. One event per day: send your request and the inn calls you to confirm.",
            whichEvent: "Which event?", loading: "Loading…",
            when: "When", day: "Day", from: "From", until: "Until",
            people: "Number of people", peopleExample: "e.g. 40",
            yourDetails: "Your details", optional: "(optional)",
            organisation: "School, club or company",
            note: "Anything we should know?", noteExample: "e.g. a birthday, music, food and drinks",
            summaryEmpty: "Choose the event and the day to see the price.",
            send: "Send request", sending: "Sending your request…",
            callConfirm: "The inn calls you to confirm. You pay once it is confirmed.",
            privacyNote: "By sending, you agree that we use your details to arrange your event.",
            received: "Request received",
            receivedLead: "Thank you. The inn will call you to confirm. Keep this reference.",
            another: "Book another event",
            types: {
                "house-party": { name: "House party", text: "The garden and the main house for your party, birthday or celebration." },
                "swimming-competition": { name: "Swimming competition", text: "The pool for a school, club or friendly swimming competition." }
            },
            price: function (amount) { return amount + " for the event"; },
            priceAsk: "The inn will tell you the price",
            closed: "Not taking requests online. Please call the inn.",
            dayFree: function (d) { return d + " is free for your event."; },
            dayTaken: function (d) { return d + " already has an event. Please choose another day."; },
            takenList: function (list) { return "Already booked: " + list + "."; },
            labels: { event: "Event", day: "Day", time: "Time", people: "People", price: "Price", ref: "Reference" },
            toConfirm: "To be confirmed",
            peopleCount: function (n) { return n + (n === 1 ? " person" : " people"); },
            errors: {
                event: "Choose the event.", day: "Choose the day.", soon: "Choose a day from tomorrow on.",
                late: "Events can be booked up to one year ahead.",
                time: "The end time must be after the start time.", people: "Enter how many people will come (1 to 1000).",
                name: "Enter your name.", phone: "Enter a phone number we can call (at least 9 digits).",
                email: "Check the email address, or leave it empty.",
                server: "We couldn't reach the inn's server. Check your internet and try again.",
                load: "The events couldn't be loaded. Please call or WhatsApp the inn."
            }
        },
        rw: {
            back: "Subira ku icumbi", backHome: "Subira kuri Zebra Domus",
            title: "Bika ibirori cyangwa irushanwa",
            intro: "Ibirori mu busitani cyangwa irushanwa ryo koga muri pisine. Igikorwa kimwe ku munsi: ohereza ubusabe bwawe, icumbi rizaguhamagara rikwemerere.",
            whichEvent: "Ni ikihe gikorwa?", loading: "Birimo gushakishwa…",
            when: "Ryari", day: "Umunsi", from: "Guhera", until: "Kugeza",
            people: "Umubare w'abantu", peopleExample: "urugero: 40",
            yourDetails: "Amakuru yawe", optional: "(si ngombwa)",
            organisation: "Ishuri, ikipe cyangwa ikigo",
            note: "Hari icyo dukwiye kumenya?", noteExample: "urugero: isabukuru, umuziki, ibyo kurya n'ibyo kunywa",
            summaryEmpty: "Hitamo igikorwa n'umunsi urebe igiciro.",
            send: "Ohereza ubusabe", sending: "Turimo kohereza ubusabe bwawe…",
            callConfirm: "Icumbi rizaguhamagara rikwemerere. Uzishyura bimaze kwemezwa.",
            privacyNote: "Iyo wohereje, wemera ko dukoresha amakuru yawe mu gutegura igikorwa cyawe.",
            received: "Ubusabe bwakiriwe",
            receivedLead: "Murakoze. Icumbi rizaguhamagara rikwemerere. Bika iyi nimero.",
            another: "Bika ikindi gikorwa",
            types: {
                "house-party": { name: "Ibirori", text: "Ubusitani n'inzu nkuru ku birori byawe, isabukuru cyangwa ibindi birori." },
                "swimming-competition": { name: "Irushanwa ryo koga", text: "Pisine ku irushanwa ry'ishuri, ry'ikipe cyangwa ry'inshuti." }
            },
            price: function (amount) { return amount + " ku gikorwa"; },
            priceAsk: "Icumbi rizakubwira igiciro",
            closed: "Ntitwakira ubusabe kuri internet ubu. Hamagara icumbi.",
            dayFree: function (d) { return d + ": uyu munsi uraboneka."; },
            dayTaken: function (d) { return d + ": uyu munsi ufite ikindi gikorwa. Hitamo undi munsi."; },
            takenList: function (list) { return "Iminsi yafashwe: " + list + "."; },
            labels: { event: "Igikorwa", day: "Umunsi", time: "Isaha", people: "Abantu", price: "Igiciro", ref: "Nimero" },
            toConfirm: "Kizemezwa",
            peopleCount: function (n) { return n === 1 ? "umuntu 1" : "abantu " + n; },
            errors: {
                event: "Hitamo igikorwa.", day: "Hitamo umunsi.", soon: "Hitamo umunsi uhereye ejo.",
                late: "Ushobora kubika kugeza mu mwaka umwe imbere.",
                time: "Isaha yo kurangiza igomba kuba nyuma y'iyo gutangira.", people: "Andika umubare w'abantu (1 kugeza 1000).",
                name: "Andika amazina yawe.", phone: "Andika nimero ya telefoni tuguhamagaraho (nibura imibare 9).",
                email: "Reba email yawe, cyangwa uyireke.",
                server: "Ntitwashoboye kugera kuri seriveri. Reba internet wongere ugerageze.",
                load: "Ntitwashoboye kubona ibikorwa. Hamagara cyangwa wandikire icumbi kuri WhatsApp."
            }
        },
        fr: {
            back: "Retour à l'auberge", backHome: "Retour à Zebra Domus",
            title: "Réserver un événement",
            intro: "Une fête privée dans le jardin ou une compétition de natation à la piscine. Un seul événement par jour : envoyez votre demande, l'auberge vous appelle pour confirmer.",
            whichEvent: "Quel événement ?", loading: "Chargement…",
            when: "Quand", day: "Jour", from: "De", until: "Jusqu'à",
            people: "Nombre de personnes", peopleExample: "ex. 40",
            yourDetails: "Vos coordonnées", optional: "(facultatif)",
            organisation: "École, club ou entreprise",
            note: "Quelque chose à nous dire ?", noteExample: "ex. un anniversaire, de la musique, repas et boissons",
            summaryEmpty: "Choisissez l'événement et le jour pour voir le prix.",
            send: "Envoyer la demande", sending: "Envoi de votre demande…",
            callConfirm: "L'auberge vous appelle pour confirmer. Vous payez une fois l'événement confirmé.",
            privacyNote: "En envoyant, vous acceptez que nous utilisions vos coordonnées pour organiser votre événement.",
            received: "Demande reçue",
            receivedLead: "Merci. L'auberge vous appellera pour confirmer. Gardez cette référence.",
            another: "Réserver un autre événement",
            types: {
                "house-party": { name: "Fête privée", text: "Le jardin et la maison principale pour votre fête, anniversaire ou célébration." },
                "swimming-competition": { name: "Compétition de natation", text: "La piscine pour une compétition d'école, de club ou entre amis." }
            },
            price: function (amount) { return amount + " l'événement"; },
            priceAsk: "L'auberge vous communique le prix",
            closed: "Pas de demandes en ligne pour le moment. Appelez l'auberge.",
            dayFree: function (d) { return d + " est libre pour votre événement."; },
            dayTaken: function (d) { return d + " a déjà un événement. Choisissez un autre jour."; },
            takenList: function (list) { return "Déjà réservés : " + list + "."; },
            labels: { event: "Événement", day: "Jour", time: "Horaire", people: "Personnes", price: "Prix", ref: "Référence" },
            toConfirm: "À confirmer",
            peopleCount: function (n) { return n + (n === 1 ? " personne" : " personnes"); },
            errors: {
                event: "Choisissez l'événement.", day: "Choisissez le jour.", soon: "Choisissez un jour à partir de demain.",
                late: "Les événements se réservent jusqu'à un an à l'avance.",
                time: "L'heure de fin doit être après l'heure de début.", people: "Indiquez le nombre de personnes (1 à 1000).",
                name: "Indiquez votre nom.", phone: "Indiquez un numéro de téléphone (au moins 9 chiffres).",
                email: "Vérifiez l'adresse e-mail, ou laissez-la vide.",
                server: "Impossible de joindre le serveur de l'auberge. Vérifiez votre connexion et réessayez.",
                load: "Les événements n'ont pas pu être chargés. Appelez l'auberge ou écrivez-lui sur WhatsApp."
            }
        }
    };

    // the usual times for each event, until the guest picks their own
    var USUAL_TIMES = { "house-party": ["14:00", "20:00"], "swimming-competition": ["08:00", "17:00"] };

    var state = {
        types: [],
        taken: [],
        firstDay: "",
        lastDay: "",
        times: [],
        chosen: "",
        timesTouched: false,
        sending: false,
        message: null // { key, field } so it can be shown again in another language
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

    function money(amount) {
        return "RWF " + Number(amount).toLocaleString("en-US");
    }

    function api() {
        return (window.ZD_API || "/api") + "/events";
    }

    /* "Sat 5 Dec 2026" in the chosen language */
    function dayWords(text, long) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text || "")) return "";
        var date = new Date(text + "T00:00:00Z");
        if (lang() === "rw") {
            return RW_DAYS[date.getUTCDay()] + ", " + date.getUTCDate() + " " + RW_MONTHS[date.getUTCMonth()] + (long ? " " + date.getUTCFullYear() : "");
        }
        var options = { weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", timeZone: "UTC" };
        if (long) options.year = "numeric";
        return date.toLocaleDateString(lang() === "fr" ? "fr-FR" : "en-GB", options);
    }

    function typeInfo(key) {
        return tx().types[key] || { name: key, text: "" };
    }

    function typeData(key) {
        return state.types.filter(function (t) { return t.key === key; })[0] || null;
    }

    /* ---------- the event cards ---------- */

    function renderOptions() {
        var box = byId("eventOptions");
        box.textContent = "";

        state.types.forEach(function (type) {
            var info = typeInfo(type.key);
            var selected = state.chosen === type.key;

            var input = document.createElement("input");
            input.type = "radio";
            input.name = "eventType";
            input.value = type.key;
            input.checked = selected;
            input.disabled = !type.open;

            var photo = el("span", "room-option-photo");
            var img = document.createElement("img");
            img.src = IMAGES[type.key] || "images/pool.jpg";
            img.alt = "";
            img.loading = "lazy";
            photo.appendChild(img);

            var textBox = el("span", "room-option-text");
            textBox.appendChild(el("span", "room-option-name", info.name));
            textBox.appendChild(el("span", "room-option-meta", info.text));
            var price = el("span", "room-option-rate");
            if (type.price) {
                var b = el("b", null, money(type.price));
                price.appendChild(b);
                price.appendChild(document.createTextNode(" " + tx().price("").trim()));
            } else {
                price.textContent = tx().priceAsk;
            }
            textBox.appendChild(price);
            if (!type.open) textBox.appendChild(el("span", "room-option-warning", tx().closed));

            var label = el("label", "room-option" + (selected ? " is-selected" : "") + (type.open ? "" : " is-disabled"));
            label.appendChild(input);
            label.appendChild(photo);
            label.appendChild(textBox);
            label.appendChild(el("span", "room-option-check"));

            input.addEventListener("change", function () {
                choose(type.key);
            });

            box.appendChild(label);
        });
    }

    function choose(key) {
        var options = byId("eventOptions");
        var hadFocus = options.contains(document.activeElement);

        state.chosen = key;
        var usual = USUAL_TIMES[key];
        if (usual && !state.timesTouched) {
            byId("eventStart").value = usual[0];
            byId("eventEnd").value = usual[1];
        }
        renderOptions();
        renderSummary();
        clearMessage();

        // the cards were drawn again: keep the keyboard on the chosen one
        if (hadFocus) {
            var chosen = options.querySelector("input:checked");
            if (chosen) chosen.focus();
        }
    }

    /* ---------- times ---------- */

    function fillTimes() {
        ["eventStart", "eventEnd"].forEach(function (id) {
            var select = byId(id);
            var keep = select.value;
            select.textContent = "";
            state.times.forEach(function (time) {
                var option = document.createElement("option");
                option.value = time;
                option.textContent = time;
                select.appendChild(option);
            });
            if (keep) select.value = keep;
        });
        if (!byId("eventStart").value || byId("eventStart").selectedIndex < 0) byId("eventStart").value = "14:00";
        if (!byId("eventEnd").value || byId("eventEnd").selectedIndex < 0) byId("eventEnd").value = "20:00";
    }

    /* ---------- the day ---------- */

    function renderDayStatus() {
        var box = byId("dayStatus");
        var day = byId("eventDay").value;
        var upcoming = state.taken.slice(0, 6).map(function (d) { return dayWords(d, false); }).join(", ");

        box.classList.remove("is-taken", "is-free");

        if (day && state.taken.indexOf(day) >= 0) {
            box.textContent = tx().dayTaken(dayWords(day, false));
            box.classList.add("is-taken");
            box.hidden = false;
        } else if (day && day >= state.firstDay && day <= state.lastDay) {
            box.textContent = tx().dayFree(dayWords(day, false));
            box.classList.add("is-free");
            box.hidden = false;
        } else if (upcoming) {
            box.textContent = tx().takenList(upcoming);
            box.hidden = false;
        } else {
            box.textContent = "";
            box.hidden = true;
        }
    }

    /* ---------- the summary beside the button ---------- */

    function summaryRow(label, value) {
        var row = el("div", "summary-row");
        row.appendChild(el("span", null, label));
        row.appendChild(el("span", null, value));
        return row;
    }

    function readPeople() {
        var value = byId("eventPeople").value.trim();
        return value === "" ? NaN : Number(value);
    }

    function renderSummary() {
        var box = byId("eventSummary");
        var type = typeData(state.chosen);
        var day = byId("eventDay").value;
        var t = tx();

        box.textContent = "";

        if (!type || !day) {
            box.appendChild(el("p", "summary-empty", t.summaryEmpty));
            return;
        }

        var people = readPeople();
        box.appendChild(summaryRow(t.labels.event, typeInfo(type.key).name));
        box.appendChild(summaryRow(t.labels.day, dayWords(day, true)));
        box.appendChild(summaryRow(t.labels.time, byId("eventStart").value + " – " + byId("eventEnd").value));
        if (Number.isInteger(people) && people > 0) box.appendChild(summaryRow(t.labels.people, t.peopleCount(people)));
        box.appendChild(el("div", "summary-divider"));

        var total = el("div", "summary-total");
        total.appendChild(el("span", null, t.labels.price));
        total.appendChild(el("span", null, type.price ? money(type.price) : t.toConfirm));
        box.appendChild(total);
    }

    /* ---------- messages ---------- */

    function showMessage(key, field) {
        state.message = { key: key, field: field || null };
        var text = typeof key === "function" ? key() : (tx().errors[key] || key);
        var box = byId("eventMessage");
        box.textContent = text;
        box.classList.add("is-error");
        if (field) {
            field.setAttribute("aria-invalid", "true");
            field.focus();
        }
    }

    function clearMessage() {
        state.message = null;
        byId("eventMessage").textContent = "";
        byId("eventMessage").classList.remove("is-error");
        document.querySelectorAll("#eventForm [aria-invalid]").forEach(function (node) {
            node.removeAttribute("aria-invalid");
        });
    }

    /* ---------- sending ---------- */

    function problem() {
        var day = byId("eventDay").value;
        var people = readPeople();
        var phone = byId("eventPhone").value.trim();
        var email = byId("eventEmail").value.trim();

        if (!state.chosen) return { key: "event", field: byId("eventOptions").querySelector("input:not([disabled])") };
        if (!day) return { key: "day", field: byId("eventDay") };
        if (day < state.firstDay) return { key: "soon", field: byId("eventDay") };
        if (day > state.lastDay) return { key: "late", field: byId("eventDay") };
        if (state.taken.indexOf(day) >= 0) {
            return { key: function () { return tx().dayTaken(dayWords(day, false)); }, field: byId("eventDay") };
        }
        if (byId("eventEnd").value <= byId("eventStart").value) return { key: "time", field: byId("eventEnd") };
        if (!Number.isInteger(people) || people < 1 || people > 1000) return { key: "people", field: byId("eventPeople") };
        if (!byId("eventName").value.trim()) return { key: "name", field: byId("eventName") };
        if ((phone.match(/\d/g) || []).length < 9) return { key: "phone", field: byId("eventPhone") };
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { key: "email", field: byId("eventEmail") };
        return null;
    }

    function setSending(sending) {
        state.sending = sending;
        var button = byId("eventSubmit");
        button.disabled = sending;
        button.querySelector(".button-label").textContent = sending ? tx().sending : tx().send;
    }

    async function send(event) {
        event.preventDefault();
        if (state.sending) return;
        clearMessage();

        var found = problem();
        if (found) {
            showMessage(found.key, found.field);
            return;
        }

        var body = {
            type: state.chosen,
            day: byId("eventDay").value,
            startTime: byId("eventStart").value,
            endTime: byId("eventEnd").value,
            people: readPeople(),
            name: byId("eventName").value.trim(),
            phone: byId("eventPhone").value.trim(),
            email: byId("eventEmail").value.trim(),
            organisation: byId("eventOrganisation").value.trim(),
            note: byId("eventNote").value.trim(),
            leave_empty: (byId("eventLeaveEmpty") || {}).value || ""
        };

        setSending(true);

        try {
            var response = await fetch(api(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            var data = await response.json().catch(function () { return {}; });

            if (response.ok && data.success) {
                showConfirmation(data.event);
                return;
            }

            if (data.code === "DAY_TAKEN") {
                if (state.taken.indexOf(body.day) < 0) state.taken.push(body.day);
                state.taken.sort();
                renderDayStatus();
                showMessage(function () { return tx().dayTaken(dayWords(body.day, false)); }, byId("eventDay"));
            } else if (data.code === "TYPE_CLOSED") {
                await loadEvents();
                showMessage(function () { return tx().closed; }, null);
            } else {
                showMessage(data.message || "server", null);
            }
        } catch (error) {
            showMessage("server", null);
        } finally {
            setSending(false);
        }
    }

    function showConfirmation(saved) {
        var t = tx();
        byId("eventForm").hidden = true;
        document.querySelector("#eventBooking > .section-sub").hidden = true;

        byId("eventRef").textContent = saved.ref;
        var list = byId("eventDetails");
        list.textContent = "";
        [
            [t.labels.event, typeInfo(saved.type).name],
            [t.labels.day, dayWords(saved.day, true)],
            [t.labels.time, saved.startTime + " – " + saved.endTime],
            [t.labels.people, t.peopleCount(saved.people)],
            [t.labels.price, saved.price ? money(saved.price) : t.toConfirm]
        ].forEach(function (pair) {
            var row = el("div");
            row.appendChild(el("dt", null, pair[0]));
            row.appendChild(el("dd", null, pair[1]));
            list.appendChild(row);
        });

        var box = byId("eventConfirmed");
        box.hidden = false;
        box.focus();
        window.scrollTo(0, 0);
    }

    function startAgain() {
        byId("eventConfirmed").hidden = true;
        byId("eventForm").hidden = false;
        document.querySelector("#eventBooking > .section-sub").hidden = false;
        byId("eventDay").value = "";
        byId("eventPeople").value = "";
        byId("eventNote").value = "";
        renderDayStatus();
        renderSummary();
        loadEvents();
        byId("eventDay").focus();
    }

    /* ---------- words on the page in the chosen language ---------- */

    function applyLanguage() {
        var t = tx();
        document.querySelectorAll("[data-ev]").forEach(function (node) {
            var key = node.getAttribute("data-ev");
            if (typeof t[key] === "string") node.textContent = t[key];
        });
        document.querySelectorAll("[data-ev-placeholder]").forEach(function (node) {
            var key = node.getAttribute("data-ev-placeholder");
            if (typeof t[key] === "string") node.placeholder = t[key];
        });
        document.title = t.title + " | Zebra Domus Inn";
        if (!state.sending) byId("eventSubmit").querySelector(".button-label").textContent = t.send;
        if (state.types.length) renderOptions();
        renderDayStatus();
        renderSummary();
        if (state.message) showMessage(state.message.key, null);
    }

    /* ---------- start ---------- */

    async function loadEvents() {
        try {
            var response = await fetch(api());
            var data = await response.json();
            if (!response.ok || !data.success) throw new Error("not ok");

            state.types = data.types;
            state.taken = data.takenDays;
            state.firstDay = data.firstDay;
            state.lastDay = data.lastDay;
            state.times = data.times;

            var day = byId("eventDay");
            day.min = data.firstDay;
            day.max = data.lastDay;

            fillTimes();

            // a closed event can't stay chosen
            var chosen = typeData(state.chosen);
            if (chosen && !chosen.open) state.chosen = "";

            renderOptions();
            renderDayStatus();
            renderSummary();
        } catch (error) {
            var box = byId("eventOptions");
            box.textContent = "";
            box.appendChild(el("p", "room-availability", tx().errors.load));
        }
    }

    function init() {
        var year = byId("currentYear");
        if (year) year.textContent = String(new Date().getFullYear());

        var params = new URLSearchParams(window.location.search);
        var wanted = params.get("type");
        if (USUAL_TIMES[wanted]) state.chosen = wanted;
        // the day chosen in the event's details on the home page
        if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("day") || "")) byId("eventDay").value = params.get("day");

        byId("eventForm").addEventListener("submit", send);
        byId("anotherEventButton").addEventListener("click", startAgain);

        byId("eventDay").addEventListener("change", function () {
            clearMessage();
            renderDayStatus();
            renderSummary();
        });
        ["eventStart", "eventEnd"].forEach(function (id) {
            byId(id).addEventListener("change", function () {
                state.timesTouched = true;
                clearMessage();
                renderSummary();
            });
        });
        byId("eventPeople").addEventListener("input", renderSummary);
        ["eventName", "eventPhone", "eventEmail"].forEach(function (id) {
            byId(id).addEventListener("input", function () {
                if (byId(id).getAttribute("aria-invalid")) clearMessage();
            });
        });

        var language = byId("languageSelect");
        if (language) language.addEventListener("change", applyLanguage);

        applyLanguage();
        loadEvents().then(function () {
            if (state.chosen) choose(state.chosen);
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

/* =========================================
   ZEBRA DORMUS INN
   Staff dashboard: sign in, today, bookings,
   availability grid, stock, rooms and users.
   Each person sees only what their role may do:
   owner, manager or staff (see backend/utils/permissions.js).
   Talks to /api/admin on the booking server.
========================================= */

(function () {
    "use strict";

    var API = window.ZD_API || "/api";
    var TOKEN_KEY = "zdAdminToken";
    var VIEWS = ["today", "bookings", "availability", "stock", "rooms", "users", "account"];
    // what each section needs ("" = everyone, "a|b" = either)
    var VIEW_NEEDS = {
        today: "bookings.view",
        bookings: "bookings.view",
        availability: "bookings.view",
        stock: "stock.view|requests.make",
        rooms: "rooms.manage",
        users: "users.manage",
        account: ""
    };
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var AUTO_REFRESH_MS = 30 * 1000;

    var memoryToken = "";
    var signedIn = false;
    var user = null; /* { _id, name, email, role, permissions, fromEnv } */
    var current = "today";
    var bookingRequest = 0;
    var searchTimer = null;
    var toastTimer = null;

    var state = {
        when: "upcoming",
        status: "all",
        q: "",
        gridFrom: "",
        gridDays: 14,
        occupancy: null,
        selected: null
    };

    function $(id) {
        return document.getElementById(id);
    }

    /* ---------- Small helpers ---------- */

    // Builds elements with textContent only, so guest details are never read as HTML.
    function el(tag, props, children) {
        var node = document.createElement(tag);

        Object.keys(props || {}).forEach(function (key) {
            var value = props[key];

            if (value === null || value === undefined || value === false) return;

            if (key === "className") node.className = value;
            else if (key === "text") node.textContent = value;
            else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? "" : String(value));
        });

        (children || []).forEach(function (child) {
            if (child === null || child === undefined || child === false) return;
            node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
        });

        return node;
    }

    var ICONS = {
        phone: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z"],
        whatsapp: ["M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z", "M9 9.5c.3 1.8 2.2 3.9 4.4 4.5l1.1-1.1 1.8.8c-.2 1-1 1.7-2 1.7-3 0-6.4-3.4-6.4-6.4 0-1 .7-1.8 1.7-2l.8 1.8z"],
        mail: ["M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M3 7l9 6 9-6"]
    };

    function icon(name) {
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");

        ICONS[name].forEach(function (d) {
            var path = document.createElementNS(ns, "path");
            path.setAttribute("d", d);
            svg.appendChild(path);
        });

        return svg;
    }

    function plural(count, one, many) {
        return count + " " + (count === 1 ? one : many);
    }

    function formatRwf(amount) {
        return "RWF " + Number(amount || 0).toLocaleString("en-US");
    }

    function kigaliToday() {
        try {
            return new Intl.DateTimeFormat("en-CA", {
                timeZone: "Africa/Kigali",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(new Date());
        } catch (error) {
            return new Date().toISOString().slice(0, 10);
        }
    }

    function dayDate(text) {
        return new Date(text + "T00:00:00Z");
    }

    function addDays(text, days) {
        var date = dayDate(text);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    }

    function formatDay(text, options) {
        var opts = options || { weekday: "short", day: "numeric", month: "short" };
        opts.timeZone = "UTC";
        return dayDate(text).toLocaleDateString("en-GB", opts);
    }

    function stayDay(text) {
        var opts = { weekday: "short", day: "numeric", month: "short" };
        if (text.slice(0, 4) !== kigaliToday().slice(0, 4)) opts.year = "numeric";
        return formatDay(text, opts);
    }

    function bookedAt(iso) {
        try {
            return new Date(iso).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Africa/Kigali"
            });
        } catch (error) {
            return "";
        }
    }

    function telHref(phone) {
        return "tel:" + String(phone || "").replace(/[^\d+]/g, "");
    }

    /* WhatsApp needs the full international number without "+".
       Rwandan numbers written as 07XX XXX XXX become 2507XXXXXXXX. */
    function whatsappNumber(phone) {
        var digits = String(phone || "").replace(/\D/g, "");

        if (digits.indexOf("00") === 0) digits = digits.slice(2);
        if (/^0\d{9}$/.test(digits)) digits = "250" + digits.slice(1);
        else if (/^7\d{8}$/.test(digits)) digits = "250" + digits;

        return digits.length >= 10 ? digits : "";
    }

    /* ---------- Sign-in token (kept for this browser tab only) ---------- */

    function getToken() {
        try {
            return window.sessionStorage.getItem(TOKEN_KEY) || memoryToken;
        } catch (error) {
            return memoryToken;
        }
    }

    function setToken(token) {
        memoryToken = token || "";

        try {
            if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
            else window.sessionStorage.removeItem(TOKEN_KEY);
        } catch (error) {
            /* Private mode: the token stays in memory until the page closes. */
        }
    }

    /* ---------- Talking to the booking server ---------- */

    function AdminError(message, status, waking) {
        this.message = message;
        this.status = status;
        this.waking = Boolean(waking); // the server is starting up; trying again soon will work
    }

    var WAKING_MESSAGE = "The server is starting up after a quiet time. Please wait a moment and try again.";

    async function api(method, path, body) {
        var options = { method: method, headers: {}, cache: "no-store" };
        var token = getToken();

        if (body) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        if (token) options.headers.Authorization = "Bearer " + token;

        var response;

        try {
            response = await fetch(API + path, options);
        } catch (error) {
            throw new AdminError("Can't reach the booking server. Check the internet connection, then press Refresh.", 0, true);
        }

        var data = null;

        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }

        // Signed out: the session ended, or the account was removed or turned off.
        if (response.status === 401 && path !== "/admin/login") {
            var why = data && data.message && data.message !== "Please sign in again."
                ? data.message
                : "You were signed out. Please sign in again.";
            signOut(why);
            throw new AdminError("", 401);
        }

        // Not allowed: what this person may do has probably just changed.
        if (response.status === 403 && path !== "/admin/me") {
            setTimeout(syncMe, 0);
        }

        // Render answers 502/503/504 (a web page, not our JSON) while the server wakes up
        if (!data && [502, 503, 504].indexOf(response.status) >= 0) {
            throw new AdminError(WAKING_MESSAGE, response.status, true);
        }

        if (!response.ok || !data || data.success === false) {
            var message = data && data.message;

            if (!message) {
                message = response.status === 404
                    ? "The booking server isn't connected to this page. Open the admin page from the booking server (for example http://localhost:5000/admin.html)."
                    : "Something went wrong (" + response.status + "). Please try again.";
            }

            throw new AdminError(message, response.status);
        }

        return data;
    }

    /* ---------- Messages ---------- */

    function toast(message, isError) {
        var box = $("toast");
        box.textContent = message;
        box.classList.toggle("is-error", Boolean(isError));
        box.classList.add("is-visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            box.classList.remove("is-visible");
        }, isError ? 6000 : 3500);
    }

    function showLoadError(error) {
        if (!error || error.status === 401) return;
        var box = $("loadError");
        box.textContent = error.message || "Something went wrong. Please try again.";
        box.hidden = false;
    }

    function clearLoadError() {
        $("loadError").hidden = true;
    }

    function placeholder(container, text, className) {
        container.textContent = "";
        container.appendChild(el("p", { className: className || "loading", text: text }));
    }

    /* ---------- What each role may do ---------- */

    var ROLE_NAMES = { owner: "Owner", manager: "Manager", staff: "Staff" };

    var ROLE_DUTIES = {
        owner: [
            "Record purchases and set monthly budgets",
            "Approve stock count differences",
            "See prices, money reports and the audit log",
            "Change rooms and prices",
            "Add managers and staff",
            "Everything a manager does"
        ],
        manager: [
            "Check purchases into the store",
            "Issue supplies and handle staff requests",
            "Count stock (differences go to the owner for approval)",
            "See and change bookings",
            "Add staff accounts"
        ],
        staff: [
            "Ask for supplies for your department",
            "Confirm when you receive them"
        ]
    };

    function can(key) {
        return Boolean(user && user.permissions && user.permissions.indexOf(key) >= 0);
    }

    // "a|b": either one
    function canAny(needs) {
        return String(needs).split("|").some(function (key) {
            return can(key);
        });
    }

    function isOwner() {
        return Boolean(user && user.role === "owner");
    }

    function allowed(view) {
        var need = VIEW_NEEDS[view];
        if (need === undefined) return false;
        if (need === "") return true;
        return canAny(need);
    }

    // the first section this person may open (My account if none)
    function firstView() {
        for (var i = 0; i < VIEWS.length; i += 1) {
            if (VIEWS[i] !== "account" && allowed(VIEWS[i])) return VIEWS[i];
        }
        return "account";
    }

    function accessKey(person) {
        return person ? person.role + "|" + (person.permissions || []).join(",") : "";
    }

    /* Asks the server what this person may do now, and redraws the
       dashboard if a manager or the owner has changed it. */
    var syncing = null;

    function syncMe() {
        if (!signedIn || syncing) return syncing;

        syncing = api("GET", "/admin/me")
            .then(function (data) {
                var changed = accessKey(data.user) !== accessKey(user);
                applyUser(data.user);

                if (changed) {
                    toast("What you can do here has been changed.");
                    show(viewFromHash(), true);
                }
            })
            .catch(function () {
                /* signed out or offline: handled elsewhere */
            })
            .then(function () {
                syncing = null;
            });

        return syncing;
    }

    /* ---------- Sign in / out ---------- */

    function showSignin(message) {
        signedIn = false;
        user = null;
        $("app").hidden = true;
        $("signin").hidden = false;
        $("password").value = "";
        $("signinMessage").textContent = message || "";
        document.title = "Staff sign-in | Zebra Dormus Inn";
        try {
            ($("email").value ? $("password") : $("email")).focus();
        } catch (error) {
            /* ignore */
        }
    }

    /* Show the signed-in person's name, and only the tabs and buttons they may use. */
    function applyUser(nextUser) {
        user = nextUser;
        if (!Array.isArray(user.permissions)) user.permissions = [];

        $("accountName").textContent = user.name;
        $("accountButton").setAttribute("aria-label", "My account: " + user.name);

        document.querySelectorAll("[data-perm]").forEach(function (node) {
            node.hidden = !canAny(node.getAttribute("data-perm"));
        });

        // staff only ask for supplies: call the section Supplies
        var supplies = !can("stock.view");
        document.querySelector('.tab[data-view="stock"] span').textContent = supplies ? "Supplies" : "Stock";
        TITLES.stock = supplies ? "Supplies" : "Stock";

        // no tabs at all: hide the empty tab bar
        document.querySelector(".tabs").hidden = firstView() === "account";

        $("brandLink").setAttribute("href", "#" + firstView());
    }

    function showApp(nextUser) {
        applyUser(nextUser);
        signedIn = true;
        signingOut = false;
        $("signin").hidden = true;
        $("app").hidden = false;
        show(viewFromHash(), true);
    }

    /* Signing out starts the page again from clean, so nothing from the
       account stays loaded behind the sign-in screen. The message is kept
       for a moment so the sign-in page can say why. */
    var SIGNOUT_NOTE = "zd-admin-signout-note";
    var signingOut = false;

    function signOut(message) {
        // several requests can fail at the same moment: the first one says why
        if (signingOut) return;
        signingOut = true;
        setToken("");
        signedIn = false;
        forgetActive();

        try {
            window.sessionStorage.setItem(SIGNOUT_NOTE, message || "");
            window.history.replaceState(null, "", window.location.pathname);
            window.location.reload();
        } catch (error) {
            /* storage blocked: at least show the sign-in screen */
        }

        showSignin(message);
    }

    function takeSignoutNote() {
        try {
            var note = window.sessionStorage.getItem(SIGNOUT_NOTE) || "";
            window.sessionStorage.removeItem(SIGNOUT_NOTE);
            return note;
        } catch (error) {
            return "";
        }
    }

    function pause(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    /* If the server is asleep, keep trying for up to 90 seconds while it wakes,
       instead of failing the first time. */
    async function signInWaiting(email, password, message) {
        var giveUpAt = Date.now() + 90 * 1000;

        for (;;) {
            try {
                return await api("POST", "/admin/login", { email: email, password: password });
            } catch (error) {
                if (!error.waking || Date.now() > giveUpAt) throw error;
                message.textContent = "The server is starting up after a quiet time. This can take up to a minute. Please wait…";
                await pause(4000);
            }
        }
    }

    $("signinForm").addEventListener("submit", async function (event) {
        event.preventDefault();

        var email = $("email");
        var password = $("password");
        var button = $("signinButton");
        var message = $("signinMessage");

        if (!EMAIL_PATTERN.test(email.value.trim())) {
            message.textContent = "Please enter your email address.";
            email.focus();
            return;
        }

        if (!password.value) {
            message.textContent = "Please enter your password.";
            password.focus();
            return;
        }

        button.disabled = true;
        button.textContent = "Signing in…";
        message.textContent = "";

        try {
            var data = await signInWaiting(email.value.trim(), password.value, message);
            setToken(data.token);
            password.value = "";
            markActive(true);
            showApp(data.user);
        } catch (error) {
            message.textContent = error.message;
            password.select();
        } finally {
            button.disabled = false;
            button.textContent = "Sign in";
        }
    });

    $("signoutButton").addEventListener("click", function () {
        signOut("You have signed out.");
    });

    /* ---------- Signing out a screen nobody is using ---------- */

    // A screen left open (reception, a phone on the desk) signs itself out
    // after 15 minutes without anyone touching it, with a one-minute warning.
    var IDLE_MINUTES = 15;
    var IDLE_LIMIT_MS = IDLE_MINUTES * 60 * 1000;
    var IDLE_WARN_MS = 60 * 1000;
    var ACTIVE_KEY = "zd-admin-last-active";
    var lastActive = Date.now();
    var lastSaved = 0;

    function savedActive() {
        try {
            return Number(window.sessionStorage.getItem(ACTIVE_KEY)) || 0;
        } catch (error) {
            return 0;
        }
    }

    function markActive(force) {
        lastActive = Date.now();

        // remembered, so reloading the page doesn't restart the 15 minutes
        if (force === true || lastActive - lastSaved > 5000) {
            lastSaved = lastActive;
            try {
                window.sessionStorage.setItem(ACTIVE_KEY, String(lastActive));
            } catch (error) {
                /* private mode: kept in memory only */
            }
        }

        // The warning closes on the next check (within a second), not here:
        // closing it under a finger would let the tap land on what's behind it.
    }

    function forgetActive() {
        try {
            window.sessionStorage.removeItem(ACTIVE_KEY);
        } catch (error) {
            /* nothing to forget */
        }
    }

    function idleCheck() {
        if (!signedIn) return;

        var left = IDLE_LIMIT_MS - (Date.now() - lastActive);
        var box = $("idleWarning");

        if (left <= 0) {
            signOut("You were signed out because this screen wasn't used for " + IDLE_MINUTES + " minutes. Please sign in again.");
            return;
        }

        if (left <= IDLE_WARN_MS) {
            $("idleText").textContent = "You'll be signed out in " + Math.ceil(left / 1000) +
                " seconds because nobody has used this screen.";
            box.hidden = false;
        } else if (!box.hidden) {
            box.hidden = true;
        }
    }

    // Any touch, click, key or scroll counts as using the screen.
    // (The dashboard refreshing itself doesn't.)
    ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"].forEach(function (name) {
        document.addEventListener(name, function () {
            if (signedIn) markActive();
        }, { passive: true, capture: true });
    });

    $("stayButton").addEventListener("click", function () {
        markActive(true);
        $("idleWarning").hidden = true;
    });

    setInterval(idleCheck, 1000);

    /* ---------- Switching sections ---------- */

    function viewFromHash() {
        var view = window.location.hash.replace("#", "");
        if (view === "staff") view = "users"; // its earlier name
        if (VIEWS.indexOf(view) < 0 || !allowed(view)) return firstView();
        return view;
    }

    var TITLES = { today: "Today", bookings: "Bookings", availability: "Availability", stock: "Stock", rooms: "Rooms", users: "Users", account: "My account" };

    function show(view, first) {
        var changed = view !== current || first;
        current = view;

        // keep the address in step (for example #today when Today isn't allowed)
        if (window.location.hash !== "#" + view && window.history && window.history.replaceState) {
            window.history.replaceState(null, "", "#" + view);
        }

        VIEWS.forEach(function (name) {
            $("view-" + name).hidden = name !== view;
        });

        document.querySelectorAll(".tab").forEach(function (tab) {
            if (tab.getAttribute("data-view") === view) tab.setAttribute("aria-current", "page");
            else tab.removeAttribute("aria-current");
        });

        if (view === "account") $("accountButton").setAttribute("aria-current", "page");
        else $("accountButton").removeAttribute("aria-current");

        document.title = TITLES[view] + " | Admin | Zebra Dormus Inn";

        if (changed) window.scrollTo(0, 0);

        load(view, false);
    }

    window.addEventListener("hashchange", function () {
        if (signedIn) show(viewFromHash(), false);
    });

    var LOADERS = {
        today: loadToday,
        bookings: loadBookings,
        availability: loadAvailability,
        rooms: loadRooms,
        stock: loadStock,
        users: loadUsers,
        account: loadAccount
    };

    function load(view, quiet) {
        if (!quiet) clearLoadError();

        return LOADERS[view](quiet)
            .then(function () {
                clearLoadError();
            })
            .catch(showLoadError);
    }

    $("refreshButton").addEventListener("click", function () {
        var button = this;
        button.classList.add("is-spinning");
        // first pick up any new permissions, then reload what is on screen
        Promise.resolve(syncMe()).then(function () {
            return load(current, false);
        }).then(function () {
            button.classList.remove("is-spinning");
        });
    });

    /* Stock is only refreshed on its own when nobody is in the middle of
       something there: a form open, a question asked, or typing. */
    function stockCanRefresh() {
        if (["items", "requests", "purchases"].indexOf(stock.tab) < 0) return false;
        if (document.querySelector("#view-stock form:not(#budgetForm), #view-stock .confirm-text")) return false;
        var active = document.activeElement;
        if (active && $("view-stock").contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return false;
        return true;
    }

    // New bookings, and stock changed by someone else, show up on their own
    // while the page is open.
    setInterval(function () {
        if (!signedIn || document.visibilityState !== "visible") return;
        syncMe();
        if (["rooms", "users", "account"].indexOf(current) >= 0) return;
        if (current === "stock" && !stockCanRefresh()) return;
        if (document.querySelector(".confirm-text, .doc-form")) return;
        if (document.activeElement === $("searchBox")) return;
        load(current, true);
    }, AUTO_REFRESH_MS);

    // Coming back to the page (another app, another tab): show the latest at once.
    document.addEventListener("visibilitychange", function () {
        if (!signedIn || document.visibilityState !== "visible") return;
        idleCheck(); // a phone that slept longer than 15 minutes signs out now
        if (!signedIn) return;
        syncMe(); // also signs out at once an account that was removed meanwhile
        if (current === "stock" && stockCanRefresh()) load("stock", true);
    });

    /* ---------- One booking ---------- */

    var STATUS_BADGE = {
        pending: { text: "Waiting to confirm", className: "badge badge-dashed" },
        confirmed: { text: "Confirmed", className: "badge badge-solid" },
        cancelled: { text: "Cancelled", className: "badge badge-muted" }
    };

    var PAYMENT_BADGE = {
        pending: { text: "Not paid yet", className: "badge" },
        paid: { text: "Paid", className: "badge badge-solid" },
        failed: { text: "Payment failed", className: "badge badge-dashed" }
    };

    function badge(map, value) {
        var info = map[value] || { text: value, className: "badge" };
        return el("span", { className: info.className, text: info.text });
    }

    function button(label, kind, onClick) {
        return el("button", { type: "button", className: "btn btn-small " + kind, text: label, onclick: onClick });
    }

    function bookingCard(booking, headingLevel) {
        var cancelled = booking.bookingStatus === "cancelled";
        var whatsapp = whatsappNumber(booking.guestPhone);

        var badges = el("div", { className: "badges" }, [
            badge(STATUS_BADGE, booking.bookingStatus),
            cancelled ? null : badge(PAYMENT_BADGE, booking.paymentStatus)
        ]);

        var main = el("div", { className: "booking-main" }, [
            el("div", { className: "booking-top" }, [
                el(headingLevel || "h3", { className: "booking-name", text: booking.guestName }),
                badges
            ]),
            el("div", { className: "booking-details" }, [
                el("p", { className: "booking-room", text: (booking.roomName || "Room") + " · " + plural(booking.guests, "guest", "guests") }),
                el("p", {
                    className: "booking-dates",
                    text: stayDay(booking.checkIn) + " → " + stayDay(booking.checkOut) + " · " + plural(booking.nights, "night", "nights")
                }),
                el("p", { className: "booking-meta", text: formatRwf(booking.totalPrice) + " · " + booking.paymentMethod }),
                el("p", {
                    className: "booking-ref",
                    text: booking.bookingReference + (booking.createdAt ? " · booked " + bookedAt(booking.createdAt) : "")
                })
            ])
        ]);

        var contact = el("div", { className: "booking-contact" }, [
            el("a", { className: "contact-link", href: telHref(booking.guestPhone), "aria-label": "Call " + booking.guestName }, [
                icon("phone"),
                el("span", { text: booking.guestPhone })
            ]),
            whatsapp ? el("a", {
                className: "contact-link",
                href: "https://wa.me/" + whatsapp,
                target: "_blank",
                rel: "noopener noreferrer",
                "aria-label": "WhatsApp " + booking.guestName
            }, [icon("whatsapp"), el("span", { text: "WhatsApp" })]) : null,
            el("a", { className: "contact-link", href: "mailto:" + booking.guestEmail, "aria-label": "Email " + booking.guestName }, [
                icon("mail"),
                el("span", { text: booking.guestEmail })
            ])
        ]);

        var actions = el("div", { className: "booking-actions" });

        var card = el("article", {
            className: "booking" + (cancelled ? " is-cancelled" : ""),
            "data-id": booking._id
        }, [main, contact, actions]);

        function setBusy(busy) {
            actions.querySelectorAll("button").forEach(function (b) {
                b.disabled = busy;
            });
        }

        async function change(changes, doneMessage) {
            setBusy(true);

            try {
                var data = await api("PATCH", "/admin/bookings/" + booking._id, changes);
                card.replaceWith(bookingCard(data.booking, headingLevel));
                toast(doneMessage);

                // Today's lists can show the same guest twice (arriving and staying).
                if (current === "today") load("today", true);
            } catch (error) {
                if (error.status !== 401) toast(error.message, true);
                renderActions();
            }
        }

        function askToCancel() {
            actions.textContent = "";

            var keep = button("Keep it", "btn-ghost", function () {
                renderActions();
                actions.querySelector("button").focus();
            });

            actions.appendChild(el("p", {
                className: "confirm-text",
                text: "Cancel " + booking.guestName + "'s booking? The room becomes free for these dates."
            }));
            actions.appendChild(button("Yes, cancel", "btn-primary", function () {
                change({ bookingStatus: "cancelled" }, "Booking cancelled. The room is free again.");
            }));
            actions.appendChild(keep);
            keep.focus();
        }

        function renderActions() {
            actions.textContent = "";

            // seeing a booking and changing it are separate permissions
            if (!can("bookings.manage")) return;

            if (cancelled) {
                actions.appendChild(button("Bring back", "btn-ghost", function () {
                    change({ bookingStatus: "pending" }, "Booking brought back. It is waiting for you to confirm.");
                }));
                return;
            }

            if (booking.bookingStatus === "pending") {
                actions.appendChild(button("Confirm", "btn-primary", function () {
                    change({ bookingStatus: "confirmed" }, "Booking confirmed.");
                }));
            }

            if (booking.paymentStatus === "paid") {
                actions.appendChild(button("Mark as not paid", "btn-ghost", function () {
                    change({ paymentStatus: "pending" }, "Marked as not paid.");
                }));
            } else {
                actions.appendChild(button("Mark as paid", "btn-ghost", function () {
                    change({ paymentStatus: "paid" }, "Marked as paid.");
                }));
            }

            actions.appendChild(button("Cancel booking", "btn-ghost btn-danger", askToCancel));
        }

        renderActions();
        return card;
    }

    function renderBookings(container, bookings, emptyText, headingLevel) {
        container.textContent = "";

        if (!bookings.length) {
            container.appendChild(el("p", { className: "empty", text: emptyText }));
            return;
        }

        bookings.forEach(function (booking) {
            container.appendChild(bookingCard(booking, headingLevel));
        });
    }

    /* ---------- Today ---------- */

    function stat(number, label, note, onClick, dark) {
        return el("button", { type: "button", className: "stat" + (dark ? " is-dark" : ""), onclick: onClick }, [
            el("span", { className: "stat-number", text: String(number) }),
            el("span", { className: "stat-label", text: label }),
            note ? el("span", { className: "stat-note", text: note }) : null
        ]);
    }

    function scrollToTitle(id) {
        return function () {
            $(id).scrollIntoView({ behavior: "smooth", block: "start" });
        };
    }

    function guestCount(list) {
        return list.reduce(function (sum, booking) {
            return sum + (Number(booking.guests) || 0);
        }, 0);
    }

    async function loadToday(quiet) {
        if (!quiet) {
            $("todayStats").textContent = "";
            placeholder($("roomsTonight"), "Loading…");
            ["arrivalsList", "departuresList", "stayingList"].forEach(function (id) {
                $(id).textContent = "";
            });
        }

        var data = await api("GET", "/admin/summary");

        $("todayDate").textContent = formatDay(data.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

        var stats = $("todayStats");
        stats.textContent = "";
        stats.appendChild(stat(data.arrivals.length, "Arriving today", plural(guestCount(data.arrivals), "guest", "guests"), scrollToTitle("arrivalsTitle")));
        stats.appendChild(stat(data.departures.length, "Leaving today", plural(guestCount(data.departures), "guest", "guests"), scrollToTitle("departuresTitle")));
        stats.appendChild(stat(data.staying.length, "Rooms taken tonight", plural(guestCount(data.staying), "guest", "guests"), scrollToTitle("stayingTitle")));
        stats.appendChild(stat(data.waitingForConfirmation, "Waiting to confirm", "Tap to see them", function () {
            state.status = "pending";
            state.when = "upcoming";
            state.q = "";
            syncBookingControls();
            window.location.hash = "#bookings";
        }, data.waitingForConfirmation > 0));

        var tonight = $("roomsTonight");
        tonight.textContent = "";

        data.roomsTonight.forEach(function (room) {
            var pill;

            if (!room.open) pill = el("span", { className: "pill pill-closed", text: "Closed" });
            else if (room.free < 0) pill = el("span", { className: "pill pill-full", text: "Overbooked" });
            else if (room.free === 0) pill = el("span", { className: "pill pill-full", text: "Full" });
            else pill = el("span", { className: "pill", text: room.free + " free" });

            tonight.appendChild(el("div", { className: "tonight-room" }, [
                el("div", {}, [
                    el("p", { className: "tonight-name", text: room.name }),
                    el("p", { className: "tonight-count", text: room.booked + " of " + plural(room.totalRooms, "room", "rooms") + " booked" })
                ]),
                pill
            ]));
        });

        renderBookings($("arrivalsList"), data.arrivals, "No one is arriving today.");
        renderBookings($("departuresList"), data.departures, "No one is leaving today.");
        renderBookings($("stayingList"), data.staying, "No one is staying tonight.");
    }

    /* ---------- Bookings ---------- */

    function syncBookingControls() {
        document.querySelectorAll(".segmented button").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-when") === state.when));
        });
        $("statusFilter").value = state.status;
        $("searchBox").value = state.q;
    }

    document.querySelectorAll(".segmented button").forEach(function (b) {
        b.addEventListener("click", function () {
            state.when = b.getAttribute("data-when");
            syncBookingControls();
            load("bookings", false);
        });
    });

    $("statusFilter").addEventListener("change", function () {
        state.status = this.value;
        load("bookings", false);
    });

    $("searchBox").addEventListener("input", function () {
        var value = this.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            if (value === state.q) return;
            state.q = value;
            load("bookings", false);
        }, 300);
    });

    async function loadBookings(quiet) {
        var request = ++bookingRequest;
        var list = $("bookingList");

        if (!quiet) {
            $("bookingCount").textContent = "";
            placeholder(list, "Loading bookings…");
        }

        var params = new URLSearchParams({ when: state.when, status: state.status });
        if (state.q) params.set("q", state.q);

        var data = await api("GET", "/admin/bookings?" + params.toString());

        if (request !== bookingRequest) return; // a newer search is on its way

        var words = { upcoming: "upcoming ", past: "past ", all: "" }[state.when];
        var countText = plural(data.count, words + "booking", words + "bookings");
        if (data.count >= 300) countText += " (showing the first 300)";
        $("bookingCount").textContent = countText;

        var empty = state.q
            ? "No bookings match “" + state.q + "”."
            : "No " + words + "bookings here yet.";

        renderBookings(list, data.bookings, empty, "h2");
    }

    /* ---------- Availability grid ---------- */

    $("gridPrev").addEventListener("click", function () {
        state.gridFrom = addDays(state.gridFrom || kigaliToday(), -state.gridDays);
        state.selected = null;
        load("availability", false);
    });

    $("gridNext").addEventListener("click", function () {
        state.gridFrom = addDays(state.gridFrom || kigaliToday(), state.gridDays);
        state.selected = null;
        load("availability", false);
    });

    $("gridToday").addEventListener("click", function () {
        state.gridFrom = kigaliToday();
        state.selected = null;
        load("availability", false);
    });

    function cellInfo(room, night) {
        if (!room.open) return { text: night.booked ? night.booked + " booked" : "Closed", className: "cell is-closed", state: "closed to guests" };
        if (night.free < 0) return { text: "Over " + -night.free, className: "cell is-full is-over", state: "overbooked by " + -night.free };
        if (night.free === 0) return { text: "Full", className: "cell is-full", state: "full" };
        if (night.booked === 0) return { text: "Free", className: "cell", state: "free" };
        return { text: night.free + " left", className: "cell is-some", state: night.free + " free" };
    }

    async function loadAvailability(quiet) {
        if (!state.gridFrom) state.gridFrom = kigaliToday();

        var table = $("occTable");

        if (!quiet) {
            table.textContent = "";
            $("gridRange").textContent = "Loading…";
        }

        var data = await api("GET", "/admin/occupancy?from=" + state.gridFrom + "&days=" + state.gridDays);
        var today = kigaliToday();
        state.occupancy = data;

        var last = data.dates[data.dates.length - 1];
        $("gridRange").textContent = formatDay(data.from, { day: "numeric", month: "short" }) + " – " +
            formatDay(last, { day: "numeric", month: "short", year: "numeric" });

        table.textContent = "";
        table.appendChild(el("caption", { className: "visually-hidden", text: "Rooms booked each night" }));

        var headRow = el("tr", {}, [el("th", { scope: "col", className: "room-col", text: "Room" })]);

        data.dates.forEach(function (day, index) {
            var showMonth = index === 0 || day.slice(8) === "01";
            headRow.appendChild(el("th", { scope: "col", className: day === today ? "is-today" : null }, [
                el("span", { className: "day-head" }, [
                    el("span", { className: "day-wd", text: formatDay(day, { weekday: "short" }) }),
                    el("span", { className: "day-num", text: String(Number(day.slice(8))) }),
                    el("span", { className: "day-month", text: showMonth ? formatDay(day, { month: "short" }) : " " })
                ])
            ]));
        });

        table.appendChild(el("thead", {}, [headRow]));

        var body = el("tbody");

        data.rooms.forEach(function (room) {
            var row = el("tr", {}, [
                el("th", { scope: "row", className: "room-col" }, [
                    el("span", { className: "room-col-name", text: room.name }),
                    el("span", { className: "room-col-count", text: plural(room.totalRooms, "room", "rooms") + (room.open ? "" : " · closed") })
                ])
            ]);

            room.nights.forEach(function (night) {
                var info = cellInfo(room, night);
                var selected = state.selected && state.selected.roomId === String(room._id) && state.selected.date === night.date;

                var cell = el("button", {
                    type: "button",
                    className: info.className + (selected ? " is-selected" : ""),
                    "aria-label": room.name + ", " + formatDay(night.date, { weekday: "long", day: "numeric", month: "long" }) +
                        ": " + info.state + " (" + night.booked + " of " + room.totalRooms + " booked)",
                    "aria-pressed": String(Boolean(selected)),
                    onclick: function () {
                        state.selected = { roomId: String(room._id), date: night.date };
                        table.querySelectorAll(".cell.is-selected").forEach(function (c) {
                            c.classList.remove("is-selected");
                            c.setAttribute("aria-pressed", "false");
                        });
                        cell.classList.add("is-selected");
                        cell.setAttribute("aria-pressed", "true");
                        showNight(room, night, true);
                    }
                }, [info.text]);

                row.appendChild(el("td", {}, [cell]));
            });

            body.appendChild(row);
        });

        table.appendChild(body);

        // Keep the chosen night open after a refresh, otherwise show a hint.
        var detail = $("nightDetail");
        var picked = null;

        if (state.selected) {
            data.rooms.forEach(function (room) {
                if (String(room._id) !== state.selected.roomId) return;
                room.nights.forEach(function (night) {
                    if (night.date === state.selected.date) picked = { room: room, night: night };
                });
            });
        }

        if (picked) showNight(picked.room, picked.night, false);
        else {
            state.selected = null;
            placeholder(detail, "Tap a night in the grid to see who is staying.", "hint");
        }
    }

    function openBooking(reference) {
        state.q = reference;
        state.when = "all";
        state.status = "all";
        syncBookingControls();
        window.location.hash = "#bookings";
    }

    function showNight(room, night, scroll) {
        var detail = $("nightDetail");
        var free = Math.max(0, night.free);

        var summary = room.open
            ? night.booked + " of " + plural(room.totalRooms, "room", "rooms") + " booked · " + free + " free"
            : "Closed to guests · " + night.booked + " booked";

        var card = el("div", { className: "night-card" }, [
            el("h2", { text: room.name + " · " + formatDay(night.date, { weekday: "long", day: "numeric", month: "long" }) }),
            el("p", { className: "muted", text: summary })
        ]);

        if (night.guests.length) {
            var list = el("ul", { className: "night-guests" });

            night.guests.forEach(function (guest) {
                list.appendChild(el("li", { className: "night-guest" }, [
                    el("div", {}, [
                        el("p", { className: "night-guest-name", text: guest.guestName + " · " + plural(guest.guests, "guest", "guests") }),
                        el("p", {
                            className: "night-guest-meta",
                            text: stayDay(guest.checkIn) + " → " + stayDay(guest.checkOut) + " · " + guest.bookingReference +
                                " · " + (STATUS_BADGE[guest.bookingStatus] || { text: guest.bookingStatus }).text
                        })
                    ]),
                    button("Open booking", "btn-ghost", function () {
                        openBooking(guest.bookingReference);
                    })
                ]));
            });

            card.appendChild(list);
        } else {
            card.appendChild(el("p", { className: "hint", text: "No one has booked this room type for this night." }));
        }

        detail.textContent = "";
        detail.appendChild(card);

        if (scroll && window.innerWidth < 960) {
            detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }

    /* ---------- Rooms ---------- */

    function field(id, label, input, help, wide) {
        return el("div", { className: "room-field" + (wide ? " room-field-wide" : "") }, [
            el("label", { for: id, text: label }),
            input,
            help ? el("p", { className: "help", id: id + "-help", text: help }) : null
        ]);
    }

    function roomForm(room) {
        var id = String(room._id);

        var price = el("input", { id: "price-" + id, type: "number", inputmode: "numeric", min: "0", step: "1", required: true, value: String(room.pricePerNight), "aria-describedby": "price-" + id + "-help" });
        var total = el("input", { id: "total-" + id, type: "number", inputmode: "numeric", min: "1", max: "500", step: "1", required: true, value: String(room.totalRooms), "aria-describedby": "total-" + id + "-help" });
        var capacity = el("input", { id: "capacity-" + id, type: "number", inputmode: "numeric", min: "1", max: "20", step: "1", required: true, value: String(room.capacity) });
        var description = el("textarea", { id: "description-" + id, maxlength: "500", rows: "3" });
        description.value = room.description || "";

        var open = el("input", { type: "checkbox", id: "open-" + id });
        open.checked = room.available !== false;

        var message = el("p", { className: "room-form-message", role: "status" });
        var save = el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Save changes" });

        var form = el("form", { className: "room-form", novalidate: true }, [
            el("div", { className: "room-form-head" }, [
                el("h2", { text: room.name }),
                el("label", { className: "switch", for: "open-" + id }, [
                    open,
                    el("span", { className: "switch-track", "aria-hidden": "true" }),
                    el("span", { text: "Guests can book" })
                ])
            ]),
            el("div", { className: "room-fields" }, [
                field("price-" + id, "Price per night (RWF)", price, "Whole number, e.g. 25000"),
                field("total-" + id, "Number of rooms", total, "How many of these rooms the inn has"),
                field("capacity-" + id, "Guests per room", capacity, null),
                field("description-" + id, "Description", description, null, true)
            ]),
            el("div", { className: "room-form-foot" }, [save, message])
        ]);

        form.addEventListener("input", function () {
            message.textContent = "";
        });

        form.addEventListener("submit", async function (event) {
            event.preventDefault();

            var values = {
                pricePerNight: Number(price.value),
                totalRooms: Number(total.value),
                capacity: Number(capacity.value),
                available: open.checked,
                description: description.value.trim()
            };

            if (price.value === "" || !Number.isInteger(values.pricePerNight) || values.pricePerNight < 0) {
                message.textContent = "Please enter the price as a whole number of RWF.";
                price.focus();
                return;
            }

            if (!Number.isInteger(values.totalRooms) || values.totalRooms < 1 || values.totalRooms > 500) {
                message.textContent = "Number of rooms must be between 1 and 500.";
                total.focus();
                return;
            }

            if (!Number.isInteger(values.capacity) || values.capacity < 1 || values.capacity > 20) {
                message.textContent = "Guests per room must be between 1 and 20.";
                capacity.focus();
                return;
            }

            save.disabled = true;
            message.textContent = "Saving…";

            try {
                var data = await api("PATCH", "/admin/rooms/" + id, values);
                form.replaceWith(roomForm(data.room));
                toast(room.name + " saved.");
            } catch (error) {
                message.textContent = error.status === 401 ? "" : error.message;
                save.disabled = false;
            }
        });

        return form;
    }

    async function loadRooms(quiet) {
        var container = $("roomForms");

        if (!quiet) placeholder(container, "Loading rooms…");

        var data = await api("GET", "/admin/rooms");

        container.textContent = "";
        container.appendChild(el("p", {
            className: "room-note",
            text: "Guests can book a room type until every one of its rooms is taken for a night. Turning off “Guests can book” hides that room type from the website; bookings already made stay."
        }));

        data.rooms.forEach(function (room) {
            container.appendChild(roomForm(room));
        });
    }

    /* ---------- Users (owner and managers) ---------- */

    // what the signed-in person may give, from the server
    var people = { roles: ["staff"], departments: [] };

    function lastSignIn(iso) {
        return iso ? "Last signed in " + bookedAt(iso) : "Hasn't signed in yet";
    }

    function fillSelect(select, values, emptyLabel, chosen) {
        select.textContent = "";
        if (emptyLabel !== null) select.appendChild(el("option", { value: "", text: emptyLabel }));
        values.forEach(function (value) {
            select.appendChild(el("option", { value: value, text: value }));
        });
        select.value = chosen || "";
    }

    var ROLE_BADGE = {
        owner: "badge badge-solid",
        manager: "badge badge-dashed",
        staff: "badge"
    };

    var ROLE_SHORT = {
        owner: "Purchases, budgets, approvals, money reports, audit",
        manager: "Daily stock, supply requests, bookings",
        staff: "Asks for supplies"
    };

    function staffCard(account) {
        var isSelf = user && String(account._id) === String(user._id);
        var actions = el("div", { className: "booking-actions" });

        var card = el("article", { className: "staff-card" + (account.active ? "" : " is-off") }, [
            el("div", { className: "staff-body" }, [
                el("div", { className: "staff-top" }, [
                    el("h3", { className: "staff-name", text: account.name }),
                    el("div", { className: "badges" }, [
                        el("span", { className: ROLE_BADGE[account.role] || "badge", text: ROLE_NAMES[account.role] || account.role }),
                        account.active ? null : el("span", { className: "badge badge-muted", text: "Turned off" }),
                        isSelf ? el("span", { className: "badge badge-dashed", text: "You" }) : null
                    ])
                ]),
                el("p", { className: "staff-email", text: account.email }),
                el("p", { className: "staff-role", text: ROLE_SHORT[account.role] + (account.department ? " · " + account.department : "") }),
                el("p", { className: "staff-meta", text: lastSignIn(account.lastLoginAt) })
            ]),
            actions
        ]);

        function setBusy(busy) {
            actions.querySelectorAll("button, input, select").forEach(function (b) {
                b.disabled = busy;
            });
        }

        async function change(method, body, doneMessage) {
            setBusy(true);

            try {
                var data = await api(method, "/admin/staff/" + account._id, body);
                if (method === "DELETE") card.remove();
                else card.replaceWith(staffCard(data.user));
                toast(doneMessage);
            } catch (error) {
                if (error.status !== 401) toast(error.message, true);
                renderActions();
            }
        }

        /* Role (owner only) and department */
        function editAccount() {
            actions.textContent = "";

            var form = el("form", { className: "staff-edit", novalidate: true });
            var fields = el("div", { className: "room-fields" });
            var roleSelect = null;

            if (people.roles.indexOf("manager") >= 0) {
                roleSelect = el("select", { id: "role-" + account._id });
                ["staff", "manager"].forEach(function (role) {
                    roleSelect.appendChild(el("option", { value: role, text: ROLE_NAMES[role] }));
                });
                roleSelect.value = account.role;
                fields.appendChild(el("div", { className: "room-field" }, [el("label", { for: "role-" + account._id, text: "Role" }), roleSelect]));
            }

            var dept = el("select", { id: "dept-" + account._id });
            fillSelect(dept, people.departments, "No department", account.department);
            fields.appendChild(el("div", { className: "room-field" }, [el("label", { for: "dept-" + account._id, text: "Department" }), dept]));

            form.appendChild(fields);
            form.appendChild(el("div", { className: "room-form-foot" }, [
                el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Save" }),
                button("Cancel", "btn-ghost", renderActions)
            ]));

            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var body = { department: dept.value };
                if (roleSelect) body.role = roleSelect.value;
                change("PATCH", body, account.name + " saved.");
            });

            actions.appendChild(form);
            (roleSelect || dept).focus();
        }

        function askNewPassword() {
            actions.textContent = "";

            var id = "reset-" + account._id;
            var input = el("input", { id: id, type: "text", autocomplete: "new-password", spellcheck: "false", maxlength: "200" });
            var form = el("form", { className: "staff-reset", novalidate: true }, [
                el("div", { className: "room-field" }, [
                    el("label", { for: id, text: "New password for " + account.name }),
                    input
                ]),
                el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Save password" }),
                button("Cancel", "btn-ghost", renderActions)
            ]);

            form.addEventListener("submit", function (event) {
                event.preventDefault();
                if (input.value.length < 8) {
                    toast("The password must be at least 8 characters.", true);
                    input.focus();
                    return;
                }
                change("PATCH", { password: input.value }, "Password changed. Give " + account.name + " the new password.");
            });

            actions.appendChild(form);
            input.focus();
        }

        function askToRemove() {
            actions.textContent = "";

            var keep = button("Keep", "btn-ghost", renderActions);

            actions.appendChild(el("p", {
                className: "confirm-text",
                text: "Remove " + account.name + "? They will not be able to sign in any more."
            }));
            actions.appendChild(button("Yes, remove", "btn-primary", function () {
                change("DELETE", null, account.name + " has been removed and signed out.");
            }));
            actions.appendChild(keep);
            keep.focus();
        }

        function renderActions() {
            actions.textContent = "";

            if (!account.canEdit) {
                var why = "";
                if (isSelf) why = "This is you. Change your password in My account.";
                else if (account.fromEnv && isOwner()) why = "The owner's sign-in comes from backend/.env on the server. Change it there.";
                else if (account.role === "manager") why = "Only the owner can change a manager.";
                if (why) actions.appendChild(el("p", { className: "staff-meta", text: why }));
                else actions.hidden = true;
                return;
            }

            actions.appendChild(button(people.roles.indexOf("manager") >= 0 ? "Role & department" : "Department", "btn-ghost", editAccount));
            actions.appendChild(button("Reset password", "btn-ghost", askNewPassword));
            actions.appendChild(button(account.active ? "Turn off" : "Turn on", "btn-ghost", function () {
                change(
                    "PATCH",
                    { active: !account.active },
                    account.active ? account.name + " has been turned off and signed out." : account.name + " can sign in again."
                );
            }));
            actions.appendChild(button("Remove", "btn-ghost btn-danger", askToRemove));
        }

        renderActions();
        return card;
    }

    async function loadUsers(quiet) {
        var list = $("staffList");

        if (!quiet) placeholder(list, "Loading accounts…");

        var data = await api("GET", "/admin/staff");
        var canAddManagers = (data.roles || []).indexOf("manager") >= 0;

        people.roles = data.roles || ["staff"];
        people.departments = data.departments || [];

        $("usersIntro").textContent = canAddManagers
            ? "People who can sign in to this dashboard. Their role decides what they can do."
            : "Add staff so they can ask for supplies. Only the owner can add or change managers.";

        $("staffRoleField").hidden = !canAddManagers;
        if (!canAddManagers) $("staffRole").value = "staff";

        var dept = $("staffDept");
        if (dept.options.length <= 1) fillSelect(dept, people.departments, "No department", dept.value);

        list.textContent = "";
        data.staff.forEach(function (account) {
            list.appendChild(staffCard(account));
        });
    }

    $("addStaffForm").addEventListener("input", function () {
        $("addStaffMessage").textContent = "";
    });

    $("addStaffForm").addEventListener("submit", async function (event) {
        event.preventDefault();

        var form = this;
        var name = $("staffName");
        var email = $("staffEmail");
        var password = $("staffPassword");
        var message = $("addStaffMessage");
        var add = $("addStaffButton");

        if (!name.value.trim()) {
            message.textContent = "Please enter their name.";
            name.focus();
            return;
        }

        if (!EMAIL_PATTERN.test(email.value.trim())) {
            message.textContent = "Please enter a valid email address.";
            email.focus();
            return;
        }

        if (password.value.length < 8) {
            message.textContent = "The first password must be at least 8 characters.";
            password.focus();
            return;
        }

        var body = {
            name: name.value.trim(),
            email: email.value.trim(),
            password: password.value,
            role: $("staffRoleField").hidden ? "staff" : $("staffRole").value,
            department: $("staffDept").value
        };

        add.disabled = true;
        message.textContent = "Adding…";

        try {
            var data = await api("POST", "/admin/staff", body);
            form.reset();
            message.textContent = "";
            toast(data.user.name + " can now sign in with " + data.user.email + " as " + ROLE_NAMES[data.user.role].toLowerCase() + ".");
            load("users", true);
        } catch (error) {
            message.textContent = error.status === 401 ? "" : error.message;
        } finally {
            add.disabled = false;
        }
    });

    /* ---------- My account ---------- */

    async function loadAccount() {
        var data = await api("GET", "/admin/me");
        applyUser(data.user);

        $("myName").textContent = user.name;
        $("myEmail").textContent = user.email;
        $("myRole").textContent = (ROLE_NAMES[user.role] || user.role) + (user.department ? " · " + user.department : "");

        var list = $("myPerms");
        list.textContent = "";
        (ROLE_DUTIES[user.role] || []).forEach(function (duty) {
            list.appendChild(el("li", { text: duty }));
        });

        $("envOwnerNote").hidden = !user.fromEnv;
        $("passwordForm").hidden = Boolean(user.fromEnv);
    }

    $("passwordForm").addEventListener("input", function () {
        $("passwordMessage").textContent = "";
    });

    $("passwordForm").addEventListener("submit", async function (event) {
        event.preventDefault();

        var form = this;
        var oldPassword = $("currentPassword");
        var newPassword = $("newPassword");
        var again = $("repeatPassword");
        var message = $("passwordMessage");
        var save = $("passwordButton");

        if (!oldPassword.value) {
            message.textContent = "Please enter your current password.";
            oldPassword.focus();
            return;
        }

        if (newPassword.value.length < 8) {
            message.textContent = "The new password must be at least 8 characters.";
            newPassword.focus();
            return;
        }

        if (newPassword.value !== again.value) {
            message.textContent = "The two new passwords are not the same.";
            again.focus();
            return;
        }

        save.disabled = true;
        message.textContent = "Saving…";

        try {
            var data = await api("POST", "/admin/me/password", {
                currentPassword: oldPassword.value,
                newPassword: newPassword.value
            });
            setToken(data.token);
            form.reset();
            message.textContent = "";
            toast("Password changed. Other phones and computers have been signed out.");
        } catch (error) {
            message.textContent = error.status === 401 ? "" : error.message;
        } finally {
            save.disabled = false;
        }
    });

    /* ---------- Stock ---------- */

    var stock = {
        tab: "",
        items: [],
        categories: [],
        departments: [],
        summary: null,
        counts: [],
        archived: false,
        q: "",
        category: "",
        only: "",          /* "", "low" or "out" */
        changed: {},       /* items whose remaining changed since the last refresh */
        updatedAt: null,
        changesBefore: "",
        reportFrom: "",
        reportTo: "",
        report: null,
        catalog: [],
        requests: [],
        purchases: [],
        budgetMonth: "",
        auditArea: "",
        auditQ: "",
        auditBefore: "",
        auditEntries: []
    };

    var STOCK_UNITS = ["pieces", "rolls", "bottles", "bars", "packs", "boxes", "kits", "kg", "litres", "sets", "cans"];

    // the sections inside Stock, and what each needs
    var STOCK_TABS = ["items", "requests", "purchases", "budget", "changes", "report", "audit"];
    var STOCK_TAB_NEEDS = {
        items: "stock.view",
        requests: "requests.make|requests.manage",
        purchases: "purchases.view",
        budget: "budget.manage",
        changes: "stock.view",
        report: "stock.view",
        audit: "audit.view"
    };

    function qty(value) {
        return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
    }

    function signed(value) {
        var number = Number(value || 0);
        return (number > 0 ? "+" : number < 0 ? "−" : "") + qty(Math.abs(number));
    }

    function signedRwf(value) {
        var number = Math.round(Number(value || 0));
        return (number > 0 ? "+" : number < 0 ? "−" : "") + formatRwf(Math.abs(number));
    }

    function monthName(month) {
        return new Date(month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    }

    function shortDay(text) {
        return formatDay(text, { day: "numeric", month: "short", year: "numeric" });
    }

    var STOCK_STATUS = {
        ok: { text: "Enough", className: "pill" },
        low: { text: "Running low", className: "pill pill-low" },
        out: { text: "Out of stock", className: "pill pill-full" }
    };

    function itemById(id) {
        for (var i = 0; i < stock.items.length; i += 1) {
            if (stock.items[i]._id === id) return stock.items[i];
        }
        return null;
    }

    function stockMatches(item) {
        if (stock.category && item.category !== stock.category) return false;
        if (stock.only === "low" && item.status !== "low") return false;
        if (stock.only === "out" && item.status !== "out") return false;
        if (stock.q && item.name.toLowerCase().indexOf(stock.q.toLowerCase()) < 0) return false;
        return true;
    }

    function stockTabAllowed(tab) {
        return Boolean(STOCK_TAB_NEEDS[tab]) && canAny(STOCK_TAB_NEEDS[tab]);
    }

    function defaultStockTab() {
        for (var i = 0; i < STOCK_TABS.length; i += 1) {
            if (stockTabAllowed(STOCK_TABS[i])) return STOCK_TABS[i];
        }
        return "requests";
    }

    function showStockTab(tab) {
        if (!stockTabAllowed(tab)) tab = defaultStockTab();
        stock.tab = tab;

        document.querySelectorAll("[data-stock-tab]").forEach(function (b) {
            var on = b.getAttribute("data-stock-tab") === tab;
            b.setAttribute("aria-pressed", String(on));
            // on a phone the row of sections scrolls: keep the chosen one in view
            if (on && b.parentNode.scrollWidth > b.parentNode.clientWidth) {
                b.parentNode.scrollLeft = Math.max(0, b.offsetLeft - 24);
            }
        });

        STOCK_TABS.forEach(function (name) {
            $("stock-" + name).hidden = name !== tab;
        });
    }

    function loadStockTab(tab, quiet) {
        if (tab === "items") {
            renderApprovals();
            renderStockList();
            return Promise.resolve();
        }
        if (tab === "requests") return loadRequests(quiet);
        if (tab === "purchases") return loadPurchases(quiet);
        if (tab === "budget") return loadBudget();
        if (tab === "changes") return loadChanges(false);
        if (tab === "report") return loadReport();
        return loadAudit(false);
    }

    // switching section also refreshes the numbers and badges
    document.querySelectorAll("[data-stock-tab]").forEach(function (b) {
        b.addEventListener("click", function () {
            showStockTab(b.getAttribute("data-stock-tab"));
            load("stock", false);
        });
    });

    /* A small number on a section button, e.g. Requests (3) */
    function setTabCount(tab, count) {
        var badge = document.querySelector('[data-stock-tab="' + tab + '"] .seg-count');
        if (!badge) return;
        badge.textContent = count ? String(count) : "";
        badge.hidden = !count;
    }

    function renderStockStats() {
        var box = $("stockStats");
        var s = stock.summary;
        box.textContent = "";

        box.appendChild(stat(s.items, "Items", "Tap to see all", function () {
            stock.only = "";
            stock.category = "";
            stock.q = "";
            $("stockSearch").value = "";
            $("stockCategory").value = "";
            showStockTab("items");
            renderStockList();
        }));
        box.appendChild(stat(s.low, "Running low", "Tap to see them", function () {
            stock.only = "low";
            showStockTab("items");
            renderStockList();
        }, s.low > 0));
        box.appendChild(stat(s.out, "Out of stock", "Tap to see them", function () {
            stock.only = "out";
            showStockTab("items");
            renderStockList();
        }, s.out > 0));

        if (s.value !== undefined) {
            box.appendChild(stat(formatRwf(s.value), "Value in store", "At the last price paid", function () {
                showStockTab("report");
                loadReport().catch(showLoadError);
            }));
        } else if (s.requestsWaiting !== undefined) {
            box.appendChild(stat(s.requestsWaiting, "Requests waiting", "Tap to see them", function () {
                showStockTab("requests");
                loadRequests(false).catch(showLoadError);
            }, s.requestsWaiting > 0));
        }

        setTabCount("requests", s.requestsWaiting || 0);
        setTabCount("purchases", s.purchasesWaiting || 0);
        setTabCount("items", can("stock.approve") ? s.countsWaiting : 0);
    }

    function renderStockAlert() {
        var box = $("stockAlert");
        var short = stock.items.filter(function (item) {
            return item.active && item.status !== "ok";
        });

        if (!short.length) {
            box.hidden = true;
            return;
        }

        var names = short.slice(0, 8).map(function (item) {
            return item.name + " (" + (item.status === "out" ? "none left" : qty(item.quantity) + " " + item.unit + " left") + ")";
        });

        box.textContent = "Buy soon: " + names.join(", ") + (short.length > 8 ? " and " + (short.length - 8) + " more." : ".");
        box.hidden = false;
    }

    function fillCategorySelect() {
        var select = $("stockCategory");
        if (select.options.length > 1) return;

        stock.categories.forEach(function (category) {
            select.appendChild(el("option", { value: category, text: category }));
        });
    }

    $("stockSearch").addEventListener("input", function () {
        stock.q = this.value.trim();
        renderStockList();
    });

    $("stockCategory").addEventListener("change", function () {
        stock.category = this.value;
        renderStockList();
    });

    $("showArchived").addEventListener("change", function () {
        stock.archived = this.checked;
        load("stock", false);
    });

    /* ----- Count differences waiting for the owner ----- */

    function renderApprovals() {
        var box = $("approvalsBox");
        box.textContent = "";

        if (!can("stock.approve") || !stock.counts.length) {
            box.hidden = true;
            return;
        }

        box.hidden = false;
        box.appendChild(el("h2", { className: "approvals-title", text: "Waiting for your approval" }));
        box.appendChild(el("p", {
            className: "stock-meta",
            text: "A manager counted these and found a different number. The stock only changes when you approve."
        }));

        stock.counts.forEach(function (count) {
            box.appendChild(approvalRow(count));
        });
    }

    function approvalRow(count) {
        var row = el("article", { className: "approval-row" });
        var actions = el("div", { className: "booking-actions" });

        function busy(on) {
            actions.querySelectorAll("button, input").forEach(function (b) {
                b.disabled = on;
            });
        }

        async function decide(path, body, done) {
            busy(true);
            try {
                await api("POST", "/admin/stock/counts/" + count._id + "/" + path, body);
                toast(done);
                load("stock", true);
            } catch (error) {
                if (error.status !== 401) toast(error.message, true);
                renderActions();
            }
        }

        function askReason() {
            actions.textContent = "";
            var id = "reason-" + count._id;
            var input = el("input", { id: id, type: "text", maxlength: "200", placeholder: "For example: please count again", autocomplete: "off" });
            var form = el("form", { className: "staff-reset", novalidate: true }, [
                el("div", { className: "room-field" }, [el("label", { for: id, text: "Why? (optional)" }), input]),
                el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Turn down" }),
                button("Cancel", "btn-ghost", renderActions)
            ]);
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                decide("reject", { reason: input.value.trim() }, "Count turned down. The stock stays at " + qty(count.recorded) + " " + count.unit + ".");
            });
            actions.appendChild(form);
            input.focus();
        }

        function renderActions() {
            actions.textContent = "";
            actions.appendChild(button("Approve " + signed(count.change), "btn-primary", function () {
                decide("approve", null, count.itemName + " is now " + qty(count.counted) + " " + count.unit + ".");
            }));
            actions.appendChild(button("Turn down", "btn-ghost", askReason));
        }

        row.appendChild(el("div", {}, [
            el("p", { className: "approval-what" }, [
                el("strong", { text: count.itemName }),
                " · counted " + qty(count.counted) + " " + count.unit + ", record says " + qty(count.recorded)
            ]),
            el("p", {
                className: "stock-meta",
                text: "Difference " + signed(count.change) + " " + count.unit +
                    (count.value !== undefined ? " (" + signedRwf(count.value) + ")" : "") +
                    " · by " + count.countedByName + " · " + shortDay(count.day)
            }),
            count.note ? el("p", { className: "stock-notes", text: count.note }) : null
        ]));
        row.appendChild(actions);
        renderActions();
        return row;
    }

    /* ----- Items ----- */

    function renderStockList() {
        var list = $("stockList");
        var shown = stock.items.filter(stockMatches);
        var count = $("stockCount");

        list.textContent = "";
        count.textContent = "";

        if (stock.only) {
            count.appendChild(document.createTextNode(
                (stock.only === "low" ? "Showing items running low" : "Showing items that are out of stock") + " · "
            ));
            count.appendChild(el("button", {
                type: "button",
                className: "link-btn",
                text: "Show all",
                onclick: function () {
                    stock.only = "";
                    renderStockList();
                }
            }));
        } else if (stock.items.length) {
            count.textContent = plural(shown.length, "item", "items") + (stock.updatedAt ? " · updated " + clock(stock.updatedAt) : "");
        }

        if (!stock.items.length) {
            var empty = el("div", { className: "empty stock-empty" }, [
                el("p", { text: "Nothing is in the stock list yet." })
            ]);

            if (can("stock.items")) {
                empty.appendChild(el("p", { text: "Add your own items, or start with a list of common things an inn keeps (toilet paper, soap, towels, water…). You can change or archive any of them." }));
                empty.appendChild(button("Add common items", "btn-primary", async function () {
                    this.disabled = true;
                    try {
                        var data = await api("POST", "/admin/stock/items/starter");
                        toast(plural(data.added, "item", "items") + " added. They come into stock when a purchase is checked in.");
                        load("stock", true);
                    } catch (error) {
                        if (error.status !== 401) toast(error.message, true);
                        this.disabled = false;
                    }
                }));
            }

            list.appendChild(empty);
            return;
        }

        var unused = stock.items.filter(function (item) {
            return item.quantity === 0 && item.changes === 0;
        });

        if (can("stock.delete") && unused.length && !stock.only && !stock.q && !stock.category) {
            list.appendChild(unusedBar(unused.length));
        }

        if (!shown.length) {
            list.appendChild(el("p", { className: "empty", text: "No items match." }));
            return;
        }

        var lastCategory = "";

        shown.forEach(function (item) {
            if (item.category !== lastCategory) {
                lastCategory = item.category;
                list.appendChild(el("h2", { className: "stock-group", text: item.category }));
            }
            list.appendChild(stockCard(item));
        });

        stock.changed = {};
    }

    /* Clears items nobody has counted, used or received, e.g. the common items. */
    function unusedBar(count) {
        var bar = el("div", { className: "stock-unused" });

        function ask() {
            bar.textContent = "";
            bar.appendChild(el("p", {
                className: "confirm-text",
                text: "Delete the " + plural(count, "item", "items") + " that " + (count === 1 ? "has" : "have") +
                    " never been counted, used or received? You can add items again at any time."
            }));
            var keep = button("Cancel", "btn-ghost", show);
            bar.appendChild(button("Yes, delete them", "btn-primary", async function () {
                this.disabled = true;
                try {
                    var data = await api("POST", "/admin/stock/items/remove-unused");
                    toast(plural(data.removed, "unused item", "unused items") + " deleted.");
                    load("stock", true);
                } catch (error) {
                    if (error.status !== 401) toast(error.message, true);
                    show();
                }
            }));
            bar.appendChild(keep);
            keep.focus();
        }

        function show() {
            bar.textContent = "";
            bar.appendChild(el("p", {
                text: plural(count, "item has", "items have") + " never been counted, used or received."
            }));
            bar.appendChild(button("Delete unused items", "btn-ghost btn-danger", ask));
        }

        show();
        return bar;
    }

    function replaceItem(updated) {
        stock.items = stock.items.map(function (item) {
            return item._id === updated._id ? updated : item;
        });
    }

    async function refreshStockSummary() {
        try {
            var data = await api("GET", "/admin/stock/items" + (stock.archived ? "?archived=1" : ""));
            stock.items = data.items;
            stock.summary = data.summary;
            renderStockStats();
            renderStockAlert();

            // keep the "never counted, used or received" bar in step
            var bar = document.querySelector("#stockList .stock-unused");
            var unused = stock.items.filter(function (item) {
                return item.quantity === 0 && item.changes === 0;
            }).length;
            if (bar && unused) bar.replaceWith(unusedBar(unused));
            else if (bar) bar.remove();
        } catch (error) {
            /* the card already shows the change */
        }
    }

    /* In stock (everything received since the item was added), used, and remaining now */
    function clock(date) {
        return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
    }

    function stockFigures(item) {
        return el("dl", { className: "stock-figures" }, [
            el("div", {}, [
                el("dt", { text: "In stock" }),
                el("dd", { text: qty(item.received) })
            ]),
            el("div", {}, [
                el("dt", { text: "Used" }),
                el("dd", { text: qty(item.used) })
            ]),
            el("div", { className: "is-remaining" + (stock.changed[item._id] ? " is-updated" : "") }, [
                el("dt", { text: "Remaining" }),
                el("dd", {}, [el("span", { className: "figure", text: qty(item.quantity) }), el("span", { className: "unit", text: " " + item.unit })])
            ])
        ]);
    }

    function departmentSelect(id, chosen) {
        var select = el("select", { id: id, required: true });
        fillSelect(select, stock.departments, "Choose…", chosen);
        return select;
    }

    function stockCard(item) {
        var info = STOCK_STATUS[item.status] || STOCK_STATUS.ok;
        var formBox = el("div", { className: "stock-form-box" });
        var actions = el("div", { className: "booking-actions" });
        var waiting = item.waitingCount;

        var meta = item.category + (item.lowStockAt > 0 ? " · warn at " + qty(item.lowStockAt) + " " + item.unit : "");

        var card = el("article", { className: "stock-card is-" + item.status + (item.active ? "" : " is-archived") }, [
            el("div", { className: "stock-top" }, [
                el("div", { className: "stock-title" }, [
                    el("h3", { className: "stock-name", text: item.name }),
                    el("p", { className: "stock-meta", text: meta })
                ]),
                item.active
                    ? el("span", { className: info.className, text: info.text })
                    : el("span", { className: "pill pill-closed", text: "Archived" })
            ]),
            stockFigures(item),
            item.corrections
                ? el("p", { className: "stock-meta", text: "Corrections after counting: " + signed(item.corrections) + " " + item.unit })
                : null,
            waiting
                ? el("p", {
                    className: "count-waiting",
                    text: "Count waiting for the owner: " + qty(waiting.counted) + " " + item.unit + " (" + signed(waiting.change) + "), by " + waiting.countedByName
                })
                : null,
            item.unitCost !== undefined && item.unitCost > 0
                ? el("p", { className: "stock-meta", text: formatRwf(item.unitCost) + " each · " + formatRwf(item.value) + " in store" })
                : null,
            item.notes ? el("p", { className: "stock-notes", text: item.notes }) : null,
            actions,
            formBox
        ]);

        function renderActions() {
            actions.textContent = "";
            formBox.textContent = "";

            if (item.active) {
                if (can("stock.issue")) actions.appendChild(button("− Issue", "btn-ghost", function () { openMove("out"); }));
                if (can("stock.count")) actions.appendChild(button("Count", "btn-ghost", function () { openMove("count"); }));
            }

            if (can("stock.items")) {
                actions.appendChild(button("Edit", "btn-ghost", function () { openItemForm(item); }));
            }

            actions.hidden = !actions.children.length;
        }

        function openMove(type) {
            actions.textContent = "";
            actions.hidden = false;
            formBox.textContent = "";

            var id = "move-" + item._id;
            var question = type === "out" ? "How many " + item.unit + " to issue?" : "How many " + item.unit + " are there now?";
            var hint = type === "out" ? "What for? For example: rooms 1–3" : "For example: monthly count";

            var amount = el("input", { id: id + "-qty", type: "number", inputmode: "decimal", min: "0", step: "0.01", required: true });
            if (type === "count") amount.value = String(item.quantity);
            var note = el("input", { id: id + "-note", type: "text", maxlength: "200", placeholder: hint, autocomplete: "off" });
            var day = el("input", { id: id + "-day", type: "date", max: kigaliToday(), value: kigaliToday() });
            var dept = type === "out" ? departmentSelect(id + "-dept", "") : null;

            var fields = [el("div", { className: "room-field" }, [el("label", { for: id + "-qty", text: question }), amount])];
            if (dept) fields.push(el("div", { className: "room-field" }, [el("label", { for: id + "-dept", text: "Which department?" }), dept]));
            fields.push(
                el("div", { className: "room-field" }, [el("label", { for: id + "-note", text: "Note (optional)" }), note]),
                el("div", { className: "room-field" }, [el("label", { for: id + "-day", text: "Day" }), day])
            );

            var message = el("p", { className: "room-form-message", role: "status" });
            var save = el("button", { type: "submit", className: "btn btn-primary btn-small", text: type === "out" ? "Issue" : "Save count" });

            var form = el("form", { className: "stock-move", novalidate: true }, [
                el("div", { className: "room-fields" }, fields),
                type === "count" && !can("stock.approve")
                    ? el("p", { className: "help", text: "If the number is different from the record, the owner approves it before the stock changes." })
                    : null,
                el("div", { className: "room-form-foot" }, [
                    save,
                    button("Cancel", "btn-ghost", renderActions),
                    message
                ])
            ]);

            form.addEventListener("submit", async function (event) {
                event.preventDefault();

                var number = Number(amount.value);
                if (amount.value === "" || !isFinite(number) || number < 0 || (type !== "count" && number <= 0)) {
                    message.textContent = type === "count" ? "Enter how many there are now." : "Enter how many.";
                    amount.focus();
                    return;
                }

                if (type === "out" && number > item.quantity) {
                    message.textContent = "Only " + qty(item.quantity) + " " + item.unit + " are in stock. If that's wrong, count it.";
                    amount.focus();
                    return;
                }

                if (dept && !dept.value) {
                    message.textContent = "Choose the department.";
                    dept.focus();
                    return;
                }

                var body = { type: type, quantity: number, note: note.value.trim(), day: day.value };
                if (dept) body.department = dept.value;

                save.disabled = true;
                message.textContent = "Saving…";

                try {
                    var data = await api("POST", "/admin/stock/items/" + item._id + "/movements", body);
                    var updated = data.item;
                    var done;

                    if (data.waiting) {
                        done = "Count saved: " + qty(number) + " " + item.unit + ". It waits for the owner's approval.";
                    } else if (type === "out") {
                        done = "Issued " + qty(number) + " " + item.unit + " of " + item.name + " to " + body.department + ". " + qty(updated.quantity) + " left.";
                    } else {
                        var diff = data.movement.change;
                        done = item.name + " counted: " + qty(updated.quantity) + " " + item.unit +
                            (diff === 0 ? ", same as recorded." : " (" + signed(diff) + " compared with the record).");
                    }

                    replaceItem(updated);
                    card.replaceWith(stockCard(updated));
                    toast(done);
                    refreshStockSummary();
                } catch (error) {
                    message.textContent = error.status === 401 ? "" : error.message;
                    save.disabled = false;
                }
            });

            formBox.appendChild(form);
            amount.focus();
            if (type === "count") amount.select();
        }

        renderActions();
        return card;
    }

    /* Add or change an item */
    function openItemForm(item) {
        var slot = $("itemFormSlot");
        var editing = Boolean(item);
        slot.textContent = "";

        var name = el("input", { id: "itemName", type: "text", maxlength: "80", required: true, autocomplete: "off" });
        var category = el("select", { id: "itemCategory" });
        stock.categories.forEach(function (c) {
            category.appendChild(el("option", { value: c, text: c }));
        });

        var unitList = el("datalist", { id: "unitOptions" });
        STOCK_UNITS.forEach(function (u) {
            unitList.appendChild(el("option", { value: u }));
        });

        var unit = el("input", { id: "itemUnit", type: "text", maxlength: "20", list: "unitOptions", placeholder: "rolls, bottles, kg…", autocomplete: "off" });
        var start = el("input", { id: "itemStart", type: "number", inputmode: "decimal", min: "0", step: "0.01", value: "0" });
        var low = el("input", { id: "itemLow", type: "number", inputmode: "decimal", min: "0", step: "0.01", value: "0", "aria-describedby": "itemLowHelp" });
        var cost = el("input", { id: "itemCost", type: "number", inputmode: "numeric", min: "0", step: "1", value: "0" });
        var notes = el("input", { id: "itemNotes", type: "text", maxlength: "300", autocomplete: "off" });

        if (editing) {
            name.value = item.name;
            category.value = item.category;
            unit.value = item.unit;
            low.value = String(item.lowStockAt);
            cost.value = String(item.unitCost || 0);
            notes.value = item.notes || "";
        } else {
            category.value = stock.category || "Toiletries";
            unit.value = "pieces";
        }

        var message = el("p", { className: "room-form-message", role: "status" });
        var save = el("button", { type: "submit", className: "btn btn-primary btn-small", text: editing ? "Save changes" : "Add item" });
        var showPrice = can("stock.prices");
        var showStart = !editing && can("stock.approve"); // stock without a purchase is the owner's call

        var fields = [
            el("div", { className: "room-field" }, [el("label", { for: "itemName", text: "Name" }), name]),
            el("div", { className: "room-field" }, [el("label", { for: "itemCategory", text: "Category" }), category]),
            el("div", { className: "room-field" }, [el("label", { for: "itemUnit", text: "Counted in" }), unit, unitList])
        ];

        if (showStart) {
            fields.push(el("div", { className: "room-field" }, [el("label", { for: "itemStart", text: "How many you have now" }), start]));
        }

        fields.push(
            el("div", { className: "room-field" }, [
                el("label", { for: "itemLow", text: "Warn me when there are" }),
                low,
                el("p", { className: "help", id: "itemLowHelp", text: "…or fewer left. 0 = never warn." })
            ]),
            showPrice ? el("div", { className: "room-field" }, [el("label", { for: "itemCost", text: "Price for one (RWF)" }), cost]) : null,
            el("div", { className: "room-field room-field-wide" }, [el("label", { for: "itemNotes", text: "Notes (optional)" }), notes])
        );

        var foot = el("div", { className: "room-form-foot" }, [
            save,
            button("Cancel", "btn-ghost", function () {
                slot.textContent = "";
            })
        ]);

        if (editing) {
            foot.appendChild(button(item.active ? "Archive item" : "Bring back", "btn-ghost", function () {
                submit({ active: !item.active }, item.active
                    ? item.name + " archived. It stays in old reports."
                    : item.name + " is back in the stock list.");
            }));
            if (can("stock.delete")) foot.appendChild(button("Delete item", "btn-ghost btn-danger", askDelete));
        }

        foot.appendChild(message);

        function askDelete() {
            var history = item.changes
                ? " Its history (" + plural(item.changes, "change", "changes") + ") is deleted too, and it disappears from reports. To keep the history, archive it instead."
                : "";
            var box = el("div", { className: "stock-delete-confirm" }, [
                el("p", { className: "confirm-text", text: "Delete " + item.name + " for good?" + history })
            ]);
            var keep = button("Keep it", "btn-ghost", function () {
                box.remove();
                foot.hidden = false;
            });

            box.appendChild(button("Yes, delete", "btn-primary", async function () {
                this.disabled = true;
                try {
                    await api("DELETE", "/admin/stock/items/" + item._id);
                    slot.textContent = "";
                    toast(item.name + " deleted.");
                    load("stock", true);
                } catch (error) {
                    if (error.status !== 401) toast(error.message, true);
                    box.remove();
                    foot.hidden = false;
                }
            }));
            box.appendChild(keep);

            foot.hidden = true;
            form.appendChild(box);
            keep.focus();
        }

        var form = el("form", { className: "form-card item-form", novalidate: true }, [
            el("h2", { text: editing ? "Change " + item.name : "Add an item" }),
            el("div", { className: "room-fields" }, fields),
            !editing && !showStart
                ? el("p", { className: "help", text: "New items start at 0. Stock comes in when the owner's purchase is checked in, or count it and the owner approves the number." })
                : null,
            foot
        ]);

        async function submit(body, doneMessage) {
            save.disabled = true;
            message.textContent = "Saving…";

            try {
                if (editing) await api("PATCH", "/admin/stock/items/" + item._id, body);
                else await api("POST", "/admin/stock/items", body);
                slot.textContent = "";
                toast(doneMessage);
                load("stock", true);
            } catch (error) {
                message.textContent = error.status === 401 ? "" : error.message;
                save.disabled = false;
            }
        }

        form.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!name.value.trim()) {
                message.textContent = "Please enter the item's name.";
                name.focus();
                return;
            }

            var body = {
                name: name.value.trim(),
                category: category.value,
                unit: unit.value.trim() || "pieces",
                lowStockAt: low.value === "" ? 0 : Number(low.value),
                notes: notes.value.trim()
            };

            if (showPrice) body.unitCost = cost.value === "" ? 0 : Number(cost.value);
            if (showStart) body.quantity = start.value === "" ? 0 : Number(start.value);

            submit(body, editing ? body.name + " saved." : body.name + " added.");
        });

        slot.appendChild(form);
        slot.scrollIntoView({ behavior: "smooth", block: "start" });
        name.focus();
    }

    $("addItemButton").addEventListener("click", function () {
        openItemForm(null);
    });

    /* ----- Lines of items, used by requests and purchases ----- */

    // a select of items grouped by category; `left` shows how many are in stock
    function itemSelect(id, items, chosen, left) {
        var select = el("select", { id: id, required: true });
        select.appendChild(el("option", { value: "", text: "Choose an item…" }));
        var group = null;
        var lastCategory = "";

        items.forEach(function (item) {
            if (item.category !== lastCategory) {
                lastCategory = item.category;
                group = el("optgroup", { label: item.category });
                select.appendChild(group);
            }
            group.appendChild(el("option", {
                value: item._id,
                text: item.name + (left ? " (" + qty(item.quantity) + " " + item.unit + " left)" : "")
            }));
        });

        select.value = chosen || "";
        return select;
    }

    /* ----- Requests ----- */

    var REQUEST_BADGE = {
        waiting: { text: "Waiting", className: "badge badge-dashed" },
        issued: { text: "Given", className: "badge" },
        received: { text: "Received", className: "badge badge-solid" },
        rejected: { text: "Turned down", className: "badge badge-muted" },
        cancelled: { text: "Cancelled", className: "badge badge-muted" }
    };

    async function loadRequests(quiet) {
        var list = $("requestList");
        if (!quiet) placeholder(list, "Loading requests…");

        var calls = [api("GET", "/admin/requests")];
        if (can("requests.make")) calls.push(api("GET", "/admin/stock/catalog"));

        var results = await Promise.all(calls);
        stock.requests = results[0].requests;
        stock.departments = results[0].departments || stock.departments;
        if (results[1]) stock.catalog = results[1].items;

        renderRequests();
    }

    function renderRequests() {
        var list = $("requestList");
        list.textContent = "";

        if (can("requests.manage")) {
            var waiting = stock.requests.filter(function (r) { return r.status === "waiting"; });
            var given = stock.requests.filter(function (r) { return r.status === "issued"; });
            var done = stock.requests.filter(function (r) { return r.status !== "waiting" && r.status !== "issued"; });

            list.appendChild(el("h2", { className: "section-title first", text: "Waiting to be issued (" + waiting.length + ")" }));
            if (!waiting.length) list.appendChild(el("p", { className: "empty", text: "No requests are waiting." }));
            waiting.forEach(function (r) { list.appendChild(requestCard(r)); });

            if (given.length) {
                list.appendChild(el("h2", { className: "section-title", text: "Given, waiting for staff to confirm (" + given.length + ")" }));
                given.forEach(function (r) { list.appendChild(requestCard(r)); });
            }

            if (done.length) {
                list.appendChild(el("h2", { className: "section-title", text: "Done" }));
                done.forEach(function (r) { list.appendChild(requestCard(r)); });
            }
            return;
        }

        list.appendChild(el("h2", { className: "section-title first", text: "My requests" }));
        if (!stock.requests.length) {
            list.appendChild(el("p", { className: "empty", text: "You haven't asked for anything yet." }));
            return;
        }
        stock.requests.forEach(function (r) { list.appendChild(requestCard(r)); });
    }

    function requestCard(request) {
        var actions = el("div", { className: "booking-actions" });
        var badge = REQUEST_BADGE[request.status] || { text: request.status, className: "badge" };
        var manager = can("requests.manage");

        var lines = el("ul", { className: "doc-lines" }, request.lines.map(function (line) {
            var text = line.itemName + ": " + qty(line.quantity) + " " + line.unit;
            if (line.issued !== null && line.issued !== undefined) {
                text += line.issued === line.quantity ? " · given" : " · given " + qty(line.issued);
            }
            return el("li", { text: text });
        }));

        var info = [];
        if (request.status === "issued" || request.status === "received") {
            info.push("Given by " + request.issuedByName + " · " + bookedAt(request.issuedAt) + (request.issueNote ? ": " + request.issueNote : ""));
        }
        if (request.status === "received") info.push("Received " + bookedAt(request.receivedAt));
        if (request.status === "rejected") {
            info.push("Turned down by " + request.issuedByName + (request.rejectReason ? ": " + request.rejectReason : ""));
        }

        var card = el("article", { className: "doc-card is-" + request.status }, [
            el("div", { className: "staff-top" }, [
                el("h3", { className: "staff-name", text: request.ref + " · " + request.department }),
                el("div", { className: "badges" }, [el("span", { className: badge.className, text: badge.text })])
            ]),
            el("p", {
                className: "stock-meta",
                text: (request.mine ? "Asked " : "Asked by " + request.requestedByName + " · ") + bookedAt(request.createdAt)
            }),
            lines,
            request.note ? el("p", { className: "stock-notes", text: "Note: " + request.note }) : null,
            info.length ? el("p", { className: "doc-info", text: info.join(" · ") }) : null,
            actions
        ]);

        function busy(on) {
            actions.querySelectorAll("button, input").forEach(function (b) {
                b.disabled = on;
            });
        }

        async function send(path, body, done) {
            busy(true);
            try {
                await api("POST", "/admin/requests/" + request._id + "/" + path, body);
                toast(done);
                if (manager) load("stock", true);
                else loadRequests(true).catch(showLoadError);
            } catch (error) {
                if (error.status !== 401) toast(error.message, true);
                renderActions();
            }
        }

        function openIssue() {
            actions.textContent = "";
            var inputs = [];
            var fields = el("div", { className: "room-fields" });

            request.lines.forEach(function (line, index) {
                var item = itemById(String(line.itemId));
                var inStock = item ? item.quantity : 0;
                var id = "issue-" + request._id + "-" + index;
                var input = el("input", { id: id, type: "number", inputmode: "decimal", min: "0", max: String(line.quantity), step: "0.01" });
                input.value = String(Math.min(line.quantity, inStock));
                inputs.push(input);
                fields.appendChild(el("div", { className: "room-field" }, [
                    el("label", { for: id, text: line.itemName + " (" + qty(inStock) + " " + line.unit + " in stock)" }),
                    input,
                    el("p", { className: "help", text: "Asked for " + qty(line.quantity) + " " + line.unit })
                ]));
            });

            var noteId = "issue-note-" + request._id;
            var note = el("input", { id: noteId, type: "text", maxlength: "200", autocomplete: "off", placeholder: "For example: only 1 soap left" });
            fields.appendChild(el("div", { className: "room-field room-field-wide" }, [el("label", { for: noteId, text: "Note (optional)" }), note]));

            var message = el("p", { className: "room-form-message", role: "status" });
            var form = el("form", { className: "doc-form", novalidate: true }, [
                fields,
                el("div", { className: "room-form-foot" }, [
                    el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Give these" }),
                    button("Cancel", "btn-ghost", renderActions),
                    message
                ])
            ]);

            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var body = { note: note.value.trim(), lines: [] };

                for (var i = 0; i < request.lines.length; i += 1) {
                    var number = Number(inputs[i].value);
                    if (inputs[i].value === "" || !isFinite(number) || number < 0 || number > request.lines[i].quantity) {
                        message.textContent = "For " + request.lines[i].itemName + ", give 0 to " + qty(request.lines[i].quantity) + ".";
                        inputs[i].focus();
                        return;
                    }
                    body.lines.push({ itemId: request.lines[i].itemId, issued: number });
                }

                send("issue", body, request.ref + " given to " + request.requestedByName + ". The stock has gone down.");
            });

            actions.appendChild(form);
            if (inputs[0]) inputs[0].focus();
        }

        function askReject() {
            actions.textContent = "";
            var id = "reject-" + request._id;
            var input = el("input", { id: id, type: "text", maxlength: "200", autocomplete: "off", placeholder: "For example: ask again next week" });
            var form = el("form", { className: "staff-reset", novalidate: true }, [
                el("div", { className: "room-field" }, [el("label", { for: id, text: "Why? They will see this." }), input]),
                el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Turn down" }),
                button("Cancel", "btn-ghost", renderActions)
            ]);
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                send("reject", { reason: input.value.trim() }, request.ref + " turned down.");
            });
            actions.appendChild(form);
            input.focus();
        }

        function askCancel() {
            actions.textContent = "";
            var keep = button("Keep it", "btn-ghost", renderActions);
            actions.appendChild(el("p", { className: "confirm-text", text: "Cancel " + request.ref + "?" }));
            actions.appendChild(button("Yes, cancel", "btn-primary", function () {
                send("cancel", null, request.ref + " cancelled.");
            }));
            actions.appendChild(keep);
            keep.focus();
        }

        function renderActions() {
            actions.textContent = "";

            if (request.mine && request.status === "issued") {
                actions.appendChild(button("I received it", "btn-primary", function () {
                    send("received", null, "Thank you. " + request.ref + " is marked as received.");
                }));
            }
            if (request.mine && request.status === "waiting") actions.appendChild(button("Cancel request", "btn-ghost", askCancel));
            if (manager && request.status === "waiting") {
                actions.appendChild(button("Issue", "btn-primary", openIssue));
                actions.appendChild(button("Turn down", "btn-ghost", askReject));
            }

            actions.hidden = !actions.children.length;
        }

        renderActions();
        return card;
    }

    /* Staff: ask for supplies */
    function openRequestForm() {
        var slot = $("requestFormSlot");
        slot.textContent = "";

        if (!stock.catalog.length) {
            slot.appendChild(el("p", { className: "room-note", text: "There are no items to ask for yet. Ask the manager to add them." }));
            return;
        }

        var dept = el("select", { id: "requestDept" });
        fillSelect(dept, stock.departments, "Choose…", user.department || "");

        var linesBox = el("div", { className: "line-rows" });
        var count = 0;

        function addLine() {
            count += 1;
            var id = "requestItem-" + count;
            var select = itemSelect(id, stock.catalog, "", true);
            var amount = el("input", { id: id + "-qty", type: "number", inputmode: "decimal", min: "0.01", step: "0.01", placeholder: "How many" });
            var unit = el("span", { className: "line-unit", text: "" });

            select.addEventListener("change", function () {
                var item = stock.catalog.filter(function (i) { return i._id === select.value; })[0];
                unit.textContent = item ? item.unit : "";
            });

            var row = el("div", { className: "line-row" }, [
                el("div", { className: "room-field line-item" }, [el("label", { for: id, text: "Item" }), select]),
                el("div", { className: "room-field line-qty" }, [el("label", { for: id + "-qty", text: "How many" }), el("div", { className: "qty-with-unit" }, [amount, unit])]),
                el("button", {
                    type: "button",
                    className: "line-remove",
                    "aria-label": "Remove this item",
                    text: "×",
                    onclick: function () {
                        if (linesBox.children.length > 1) row.remove();
                    }
                })
            ]);
            linesBox.appendChild(row);
            return select;
        }

        addLine();

        var note = el("input", { id: "requestNote", type: "text", maxlength: "200", autocomplete: "off", placeholder: "For example: for rooms 1–6" });
        var message = el("p", { className: "room-form-message", role: "status" });
        var send = el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Send request" });

        var form = el("form", { className: "form-card doc-form", novalidate: true }, [
            el("h2", { text: "Ask for supplies" }),
            el("div", { className: "room-field" }, [el("label", { for: "requestDept", text: "For which department?" }), dept]),
            linesBox,
            el("button", { type: "button", className: "link-btn add-line", text: "+ Add another item", onclick: function () { addLine().focus(); } }),
            el("div", { className: "room-field" }, [el("label", { for: "requestNote", text: "Note (optional)" }), note]),
            el("div", { className: "room-form-foot" }, [
                send,
                button("Cancel", "btn-ghost", function () { slot.textContent = ""; }),
                message
            ])
        ]);

        form.addEventListener("submit", async function (event) {
            event.preventDefault();

            if (!dept.value) {
                message.textContent = "Choose the department.";
                dept.focus();
                return;
            }

            var lines = [];
            var rows = linesBox.querySelectorAll(".line-row");

            for (var i = 0; i < rows.length; i += 1) {
                var select = rows[i].querySelector("select");
                var amount = rows[i].querySelector("input");
                if (!select.value && !amount.value) continue;
                if (!select.value) {
                    message.textContent = "Choose the item.";
                    select.focus();
                    return;
                }
                var number = Number(amount.value);
                if (!amount.value || !isFinite(number) || number <= 0) {
                    message.textContent = "Enter how many you need.";
                    amount.focus();
                    return;
                }
                lines.push({ itemId: select.value, quantity: number });
            }

            if (!lines.length) {
                message.textContent = "Choose at least one item.";
                rows[0].querySelector("select").focus();
                return;
            }

            send.disabled = true;
            message.textContent = "Sending…";

            try {
                var data = await api("POST", "/admin/requests", { department: dept.value, note: note.value.trim(), lines: lines });
                slot.textContent = "";
                toast(data.request.ref + " sent. The manager will issue it.");
                loadRequests(true).catch(showLoadError);
            } catch (error) {
                message.textContent = error.status === 401 ? "" : error.message;
                send.disabled = false;
            }
        });

        slot.appendChild(form);
        (dept.value ? form.querySelector(".line-row select") : dept).focus();
    }

    $("newRequestButton").addEventListener("click", openRequestForm);

    /* ----- Purchases ----- */

    async function loadPurchases(quiet) {
        var list = $("purchaseList");
        if (!quiet) placeholder(list, "Loading purchases…");

        var data = await api("GET", "/admin/purchases");
        stock.purchases = data.purchases;
        renderPurchases();
    }

    function renderPurchases() {
        var list = $("purchaseList");
        var waiting = stock.purchases.filter(function (p) { return p.status === "waiting"; });
        var done = stock.purchases.filter(function (p) { return p.status !== "waiting"; });

        list.textContent = "";
        list.appendChild(el("h2", { className: "section-title first", text: "Waiting to be checked in (" + waiting.length + ")" }));
        if (!waiting.length) {
            list.appendChild(el("p", {
                className: "empty",
                text: can("purchases.record") ? "Nothing is waiting. Record a purchase when you buy stock." : "Nothing is waiting. The owner records purchases; you check them in here when they arrive."
            }));
        }
        waiting.forEach(function (p) { list.appendChild(purchaseCard(p)); });

        if (done.length) {
            list.appendChild(el("h2", { className: "section-title", text: "Earlier purchases" }));
            done.forEach(function (p) { list.appendChild(purchaseCard(p)); });
        }
    }

    function purchaseCard(purchase) {
        var actions = el("div", { className: "booking-actions" });
        var prices = purchase.total !== undefined;
        var badges = [];

        if (purchase.status === "waiting") badges.push(el("span", { className: "badge badge-dashed", text: "Waiting to be checked in" }));
        if (purchase.status === "received") badges.push(el("span", { className: "badge badge-solid", text: "Checked in" }));
        if (purchase.short) badges.push(el("span", { className: "badge badge-dashed", text: "Short" }));
        if (purchase.status === "cancelled") badges.push(el("span", { className: "badge badge-muted", text: "Cancelled" }));

        var lines = el("ul", { className: "doc-lines" }, purchase.lines.map(function (line) {
            var text = line.itemName + ": " + qty(line.quantity) + " " + line.unit;
            if (prices) text += " × " + formatRwf(line.unitCost) + " = " + formatRwf(Math.round(line.quantity * line.unitCost));
            if (line.received !== null && line.received !== undefined) {
                text += line.received === line.quantity ? " · all came in" : " · came in: " + qty(line.received);
            }
            return el("li", { className: line.received !== null && line.received < line.quantity ? "is-short" : null, text: text });
        }));

        var info = [];
        if (purchase.status === "received") {
            info.push("Checked in by " + purchase.receivedByName + " · " + bookedAt(purchase.receivedAt) + (purchase.receiveNote ? ": " + purchase.receiveNote : ""));
        }
        if (purchase.status === "cancelled") info.push("Cancelled by " + purchase.cancelledByName + " · " + bookedAt(purchase.cancelledAt));

        var card = el("article", { className: "doc-card is-" + purchase.status }, [
            el("div", { className: "staff-top" }, [
                el("h3", { className: "staff-name", text: purchase.ref + " · " + purchase.supplier }),
                el("div", { className: "badges" }, badges)
            ]),
            el("p", {
                className: "stock-meta",
                text: "Bought " + shortDay(purchase.day) + " · recorded by " + purchase.createdByName + (prices ? " · total " + formatRwf(purchase.total) : "")
            }),
            lines,
            purchase.note ? el("p", { className: "stock-notes", text: "Note: " + purchase.note }) : null,
            info.length ? el("p", { className: "doc-info", text: info.join(" · ") }) : null,
            actions
        ]);

        function busy(on) {
            actions.querySelectorAll("button, input").forEach(function (b) {
                b.disabled = on;
            });
        }

        async function send(path, body, done) {
            busy(true);
            try {
                await api("POST", "/admin/purchases/" + purchase._id + "/" + path, body);
                toast(done);
                load("stock", true);
            } catch (error) {
                if (error.status !== 401) toast(error.message, true);
                renderActions();
            }
        }

        function openReceive() {
            actions.textContent = "";
            var inputs = [];
            var fields = el("div", { className: "room-fields" });

            purchase.lines.forEach(function (line, index) {
                var id = "receive-" + purchase._id + "-" + index;
                var input = el("input", { id: id, type: "number", inputmode: "decimal", min: "0", max: String(line.quantity), step: "0.01", value: String(line.quantity) });
                inputs.push(input);
                fields.appendChild(el("div", { className: "room-field" }, [
                    el("label", { for: id, text: line.itemName + ": how many came in?" }),
                    input,
                    el("p", { className: "help", text: "Bought " + qty(line.quantity) + " " + line.unit })
                ]));
            });

            var noteId = "receive-note-" + purchase._id;
            var note = el("input", { id: noteId, type: "text", maxlength: "300", autocomplete: "off", placeholder: "Anything missing or damaged?" });
            fields.appendChild(el("div", { className: "room-field room-field-wide" }, [el("label", { for: noteId, text: "Note (optional)" }), note]));

            var message = el("p", { className: "room-form-message", role: "status" });
            var form = el("form", { className: "doc-form", novalidate: true }, [
                fields,
                el("div", { className: "room-form-foot" }, [
                    el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Add to stock" }),
                    button("Cancel", "btn-ghost", renderActions),
                    message
                ])
            ]);

            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var body = { note: note.value.trim(), lines: [] };

                for (var i = 0; i < purchase.lines.length; i += 1) {
                    var number = Number(inputs[i].value);
                    if (inputs[i].value === "" || !isFinite(number) || number < 0 || number > purchase.lines[i].quantity) {
                        message.textContent = "For " + purchase.lines[i].itemName + ", enter 0 to " + qty(purchase.lines[i].quantity) + ".";
                        inputs[i].focus();
                        return;
                    }
                    body.lines.push({ itemId: purchase.lines[i].itemId, received: number });
                }

                send("receive", body, purchase.ref + " checked in. The stock has gone up.");
            });

            actions.appendChild(form);
            if (inputs[0]) inputs[0].focus();
        }

        function askCancel() {
            actions.textContent = "";
            var keep = button("Keep it", "btn-ghost", renderActions);
            actions.appendChild(el("p", { className: "confirm-text", text: "Cancel " + purchase.ref + "? It won't count towards the budget." }));
            actions.appendChild(button("Yes, cancel", "btn-primary", function () {
                send("cancel", null, purchase.ref + " cancelled.");
            }));
            actions.appendChild(keep);
            keep.focus();
        }

        function renderActions() {
            actions.textContent = "";
            if (purchase.status === "waiting" && can("purchases.receive")) actions.appendChild(button("Check in", "btn-primary", openReceive));
            if (purchase.status === "waiting" && can("purchases.record")) actions.appendChild(button("Cancel purchase", "btn-ghost", askCancel));
            actions.hidden = !actions.children.length;
        }

        renderActions();
        return card;
    }

    /* Owner: record what was bought */
    function openPurchaseForm() {
        var slot = $("purchaseFormSlot");
        var items = stock.items.filter(function (i) { return i.active; });
        var budget = null;
        var budgetMonth = "";
        slot.textContent = "";

        if (!items.length) {
            slot.appendChild(el("p", { className: "room-note", text: "Add the items to the stock list first (Items, then Add item)." }));
            return;
        }

        var supplier = el("input", { id: "purchaseSupplier", type: "text", maxlength: "80", autocomplete: "off", placeholder: "For example: Simba Supermarket" });
        var day = el("input", { id: "purchaseDay", type: "date", max: kigaliToday(), value: kigaliToday() });
        var linesBox = el("div", { className: "line-rows" });
        var totalLine = el("p", { className: "purchase-total" });
        var budgetBox = el("div", { className: "budget-check", "aria-live": "polite" });
        var count = 0;

        function readLines() {
            var lines = [];
            linesBox.querySelectorAll(".line-row").forEach(function (row) {
                var select = row.querySelector("select");
                var inputs = row.querySelectorAll("input");
                var item = itemById(select.value);
                var quantity = Number(inputs[0].value);
                var cost = Number(inputs[1].value);
                lines.push({ row: row, item: item, select: select, qtyInput: inputs[0], costInput: inputs[1], quantity: quantity, unitCost: cost });
            });
            return lines;
        }

        function update() {
            var total = 0;
            var byCategory = {};

            readLines().forEach(function (line) {
                var sum = line.item && line.quantity > 0 && line.unitCost >= 0 ? Math.round(line.quantity * line.unitCost) : 0;
                line.row.querySelector(".line-sum").textContent = sum ? formatRwf(sum) : "";
                total += sum;
                if (line.item && sum) byCategory[line.item.category] = (byCategory[line.item.category] || 0) + sum;
            });

            totalLine.textContent = "Total " + formatRwf(total);
            budgetBox.textContent = "";

            if (!budget) return;
            Object.keys(byCategory).forEach(function (category) {
                var row = budget.rows.filter(function (r) { return r.category === category; })[0];
                if (!row || row.budget === null) return;
                var after = row.spent + byCategory[category];
                var over = after - row.budget;
                budgetBox.appendChild(el("p", {
                    className: over > 0 ? "is-over" : null,
                    text: category + ": " + formatRwf(after) + " of the " + formatRwf(row.budget) + " " + monthName(budget.month) + " budget" +
                        (over > 0 ? " · over by " + formatRwf(over) : " · " + formatRwf(-over) + " left")
                }));
            });
        }

        async function checkBudget() {
            var month = (day.value || kigaliToday()).slice(0, 7);
            if (month === budgetMonth) return;
            budgetMonth = month;
            try {
                budget = await api("GET", "/admin/stock/budget?month=" + month);
            } catch (error) {
                budget = null;
            }
            update();
        }

        function addLine() {
            count += 1;
            var id = "purchaseItem-" + count;
            var select = itemSelect(id, items, "", false);
            var amount = el("input", { id: id + "-qty", type: "number", inputmode: "decimal", min: "0.01", step: "0.01" });
            var cost = el("input", { id: id + "-cost", type: "number", inputmode: "numeric", min: "0", step: "1" });
            var unit = el("span", { className: "line-unit", text: "" });

            select.addEventListener("change", function () {
                var item = itemById(select.value);
                unit.textContent = item ? item.unit : "";
                if (item && cost.value === "" && item.unitCost) cost.value = String(item.unitCost);
                update();
            });

            var row = el("div", { className: "line-row purchase-line" }, [
                el("div", { className: "room-field line-item" }, [el("label", { for: id, text: "Item" }), select]),
                el("div", { className: "room-field line-qty" }, [el("label", { for: id + "-qty", text: "How many" }), el("div", { className: "qty-with-unit" }, [amount, unit])]),
                el("div", { className: "room-field line-cost" }, [el("label", { for: id + "-cost", text: "Price for one (RWF)" }), cost]),
                el("p", { className: "line-sum", "aria-live": "off" }),
                el("button", {
                    type: "button",
                    className: "line-remove",
                    "aria-label": "Remove this item",
                    text: "×",
                    onclick: function () {
                        if (linesBox.children.length > 1) {
                            row.remove();
                            update();
                        }
                    }
                })
            ]);

            linesBox.appendChild(row);
            return select;
        }

        addLine();

        var note = el("input", { id: "purchaseNote", type: "text", maxlength: "300", autocomplete: "off", placeholder: "For example: paid with mobile money" });
        var message = el("p", { className: "room-form-message", role: "status" });
        var save = el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Save purchase" });

        var form = el("form", { className: "form-card doc-form", novalidate: true }, [
            el("h2", { text: "Record a purchase" }),
            el("div", { className: "room-fields" }, [
                el("div", { className: "room-field" }, [el("label", { for: "purchaseSupplier", text: "Where was it bought?" }), supplier]),
                el("div", { className: "room-field" }, [el("label", { for: "purchaseDay", text: "Day bought" }), day])
            ]),
            linesBox,
            el("button", { type: "button", className: "link-btn add-line", text: "+ Add another item", onclick: function () { addLine().focus(); } }),
            totalLine,
            budgetBox,
            el("div", { className: "room-field" }, [el("label", { for: "purchaseNote", text: "Note (optional)" }), note]),
            el("p", { className: "help", text: "The stock goes up when the manager checks it in." }),
            el("div", { className: "room-form-foot" }, [
                save,
                button("Cancel", "btn-ghost", function () { slot.textContent = ""; }),
                message
            ])
        ]);

        form.addEventListener("input", update);
        day.addEventListener("change", checkBudget);

        form.addEventListener("submit", async function (event) {
            event.preventDefault();

            if (!supplier.value.trim()) {
                message.textContent = "Enter where it was bought.";
                supplier.focus();
                return;
            }

            var body = { supplier: supplier.value.trim(), day: day.value, note: note.value.trim(), lines: [] };
            var lines = readLines();

            for (var i = 0; i < lines.length; i += 1) {
                var line = lines[i];
                if (!line.select.value && !line.qtyInput.value && !line.costInput.value) continue;
                if (!line.item) {
                    message.textContent = "Choose the item.";
                    line.select.focus();
                    return;
                }
                if (!line.qtyInput.value || !(line.quantity > 0)) {
                    message.textContent = "Enter how many " + line.item.unit + " of " + line.item.name + ".";
                    line.qtyInput.focus();
                    return;
                }
                if (line.costInput.value === "" || !(line.unitCost >= 0) || !Number.isInteger(line.unitCost)) {
                    message.textContent = "Enter the price for one " + line.item.name + " (whole RWF).";
                    line.costInput.focus();
                    return;
                }
                body.lines.push({ itemId: line.item._id, quantity: line.quantity, unitCost: line.unitCost });
            }

            if (!body.lines.length) {
                message.textContent = "Add at least one item.";
                return;
            }

            save.disabled = true;
            message.textContent = "Saving…";

            try {
                var data = await api("POST", "/admin/purchases", body);
                slot.textContent = "";
                var warn = data.warnings.map(function (w) {
                    return " Over the " + w.category + " budget by " + formatRwf(w.over) + ".";
                }).join("");
                toast(data.purchase.ref + " saved (" + formatRwf(data.purchase.total) + "). The manager checks it in when it arrives." + warn, Boolean(warn));
                load("stock", true);
            } catch (error) {
                message.textContent = error.status === 401 ? "" : error.message;
                save.disabled = false;
            }
        });

        slot.appendChild(form);
        update();
        checkBudget();
        supplier.focus();
    }

    $("newPurchaseButton").addEventListener("click", openPurchaseForm);

    /* ----- Budget (owner) ----- */

    async function loadBudget() {
        if (!stock.budgetMonth) stock.budgetMonth = kigaliToday().slice(0, 7);
        $("budgetMonth").value = stock.budgetMonth;
        $("budgetMessage").textContent = "";

        var data = await api("GET", "/admin/stock/budget?month=" + stock.budgetMonth);
        renderBudget(data);
    }

    function renderBudget(data, copiedFrom) {
        var table = $("budgetTable");
        table.textContent = "";
        table.appendChild(el("caption", { className: "visually-hidden", text: "Budget and spending for " + monthName(data.month) }));
        table.appendChild(el("thead", {}, [el("tr", {}, ["Category", "Budget (RWF)", "Spent", "Left"].map(function (h, i) {
            return el("th", { scope: "col", className: i === 0 ? "room-col" : null, text: h });
        }))]));

        var body = el("tbody");

        data.rows.forEach(function (row) {
            var id = "budget-" + row.category.replace(/[^a-z]/gi, "");
            var value = copiedFrom ? copiedFrom[row.category] : row.budget;
            var input = el("input", {
                id: id,
                type: "number",
                inputmode: "numeric",
                min: "0",
                step: "1000",
                "data-category": row.category,
                "aria-label": "Budget for " + row.category,
                placeholder: "No budget"
            });
            if (value !== null && value !== undefined) input.value = String(value);

            var over = row.budget !== null && row.spent > row.budget;
            var used = row.budget ? Math.min(100, Math.round((row.spent / row.budget) * 100)) : 0;

            body.appendChild(el("tr", { className: over ? "is-over" : null }, [
                el("th", { scope: "row", className: "room-col", text: row.category }),
                el("td", {}, [input]),
                el("td", {}, [
                    el("span", { text: formatRwf(row.spent) }),
                    row.budget ? el("span", { className: "budget-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + used + "%" })]) : null
                ]),
                el("td", {
                    className: over ? "is-low" : null,
                    text: row.budget === null ? "–" : over ? "Over by " + formatRwf(row.spent - row.budget) : formatRwf(row.budget - row.spent)
                })
            ]));
        });

        table.appendChild(body);

        var totalOver = data.hasBudget && data.totalSpent > data.totalBudget;
        table.appendChild(el("tfoot", {}, [el("tr", { className: "total-row" }, [
            el("th", { scope: "row", className: "room-col", text: "Total" }),
            el("td", { text: data.hasBudget ? formatRwf(data.totalBudget) : "–" }),
            el("td", { text: formatRwf(data.totalSpent) }),
            el("td", {
                className: totalOver ? "is-low" : null,
                text: !data.hasBudget ? "–" : totalOver ? "Over by " + formatRwf(data.totalSpent - data.totalBudget) : formatRwf(data.totalBudget - data.totalSpent)
            })
        ])]));

        $("budgetSummary").textContent = monthName(data.month) + ": " + formatRwf(data.totalSpent) + " spent" +
            (data.hasBudget ? " of " + formatRwf(data.totalBudget) + " budget." : ". No budget set yet.");
    }

    $("budgetMonth").addEventListener("change", function () {
        if (!this.value) return;
        stock.budgetMonth = this.value;
        loadBudget().catch(showLoadError);
    });

    $("budgetCopy").addEventListener("click", async function () {
        var month = stock.budgetMonth;
        var date = new Date(month + "-01T00:00:00Z");
        date.setUTCMonth(date.getUTCMonth() - 1);
        var previous = date.toISOString().slice(0, 7);

        try {
            var last = await api("GET", "/admin/stock/budget?month=" + previous);
            var current = await api("GET", "/admin/stock/budget?month=" + month);
            var copied = {};
            last.rows.forEach(function (row) {
                copied[row.category] = row.budget;
            });
            renderBudget(current, copied);
            $("budgetMessage").textContent = last.hasBudget
                ? "Copied from " + monthName(previous) + ". Press Save budget to keep it."
                : monthName(previous) + " had no budget to copy.";
        } catch (error) {
            if (error.status !== 401) toast(error.message, true);
        }
    });

    $("budgetForm").addEventListener("submit", async function (event) {
        event.preventDefault();
        var amounts = {};
        var message = $("budgetMessage");

        var inputs = $("budgetTable").querySelectorAll("input[data-category]");
        for (var i = 0; i < inputs.length; i += 1) {
            var value = inputs[i].value.trim();
            if (value !== "" && (!/^\d+$/.test(value))) {
                message.textContent = "Budgets are whole numbers of RWF.";
                inputs[i].focus();
                return;
            }
            amounts[inputs[i].getAttribute("data-category")] = value === "" ? null : Number(value);
        }

        message.textContent = "Saving…";

        try {
            var data = await api("PUT", "/admin/stock/budget", { month: stock.budgetMonth, amounts: amounts });
            renderBudget(data);
            message.textContent = "";
            toast("Budget for " + monthName(data.month) + " saved.");
        } catch (error) {
            message.textContent = error.status === 401 ? "" : error.message;
        }
    });

    /* ----- Changes: what was received, issued or counted, newest first ----- */

    function changeRow(move) {
        var what;
        if (move.type === "count") what = "Counted: " + qty(move.quantity) + " (" + signed(move.change) + ")";
        else if (move.type === "out") what = "Issued " + qty(move.quantity) + (move.department ? " to " + move.department : "");
        else what = "Received " + qty(move.quantity);

        var meta = [formatDay(move.day, { weekday: "short", day: "numeric", month: "short" }), move.userName ? "by " + move.userName : ""];
        if (move.ref) meta.push(move.ref);
        if (move.unitCost && move.type === "in") meta.push(formatRwf(move.unitCost) + " each");

        return el("article", { className: "change-row is-" + move.type }, [
            el("div", {}, [
                el("p", { className: "change-what" }, [el("strong", { text: move.itemName }), " · " + what]),
                el("p", { className: "stock-meta", text: meta.filter(Boolean).join(" · ") }),
                move.note ? el("p", { className: "stock-notes", text: move.note }) : null
            ]),
            el("p", { className: "change-left", text: "Left: " + qty(move.balanceAfter) })
        ]);
    }

    async function loadChanges(more) {
        var list = $("stockChanges");
        var path = "/admin/stock/movements";

        if (more && stock.changesBefore) path += "?before=" + encodeURIComponent(stock.changesBefore);
        else {
            stock.changesBefore = "";
            placeholder(list, "Loading changes…");
        }

        var data = await api("GET", path);

        if (!more) list.textContent = "";

        if (!data.movements.length && !more) {
            list.appendChild(el("p", { className: "empty", text: "Nothing has been received, issued or counted yet." }));
        }

        data.movements.forEach(function (move) {
            list.appendChild(changeRow(move));
        });

        var last = data.movements[data.movements.length - 1];
        stock.changesBefore = last ? last.createdAt : "";
        $("moreChanges").hidden = data.movements.length < 100;
    }

    $("moreChanges").addEventListener("click", function () {
        loadChanges(true).catch(showLoadError);
    });

    /* ----- Report: what came in, was used and remains, for a period ----- */

    function setPeriod(kind) {
        var today = kigaliToday();
        var first = today.slice(0, 8) + "01";

        if (kind === "month") {
            stock.reportFrom = first;
            stock.reportTo = today;
        } else if (kind === "last-month") {
            var lastDay = addDays(first, -1);
            stock.reportFrom = lastDay.slice(0, 8) + "01";
            stock.reportTo = lastDay;
        } else if (kind === "all") {
            stock.reportFrom = "all"; // the server starts at the first change ever recorded
            stock.reportTo = today;
        } else {
            stock.reportFrom = addDays(today, -6);
            stock.reportTo = today;
        }

        $("reportFrom").value = stock.reportFrom === "all" ? "" : stock.reportFrom;
        $("reportTo").value = stock.reportTo;
    }

    document.querySelectorAll("[data-period]").forEach(function (b) {
        b.addEventListener("click", function () {
            setPeriod(b.getAttribute("data-period"));
            loadReport().catch(showLoadError);
        });
    });

    ["reportFrom", "reportTo"].forEach(function (id) {
        $(id).addEventListener("change", function () {
            if (!$("reportFrom").value || !$("reportTo").value) return;
            stock.reportFrom = $("reportFrom").value;
            stock.reportTo = $("reportTo").value;
            loadReport().catch(showLoadError);
        });
    });

    function staticStat(number, label, note) {
        return el("div", { className: "stat is-static" }, [
            el("span", { className: "stat-number", text: String(number) }),
            el("span", { className: "stat-label", text: label }),
            el("span", { className: "stat-note", text: note })
        ]);
    }

    function moneyTable(caption, heads, rows, total) {
        var table = el("table", { className: "report-table money-table" }, [
            el("caption", { text: caption }),
            el("thead", {}, [el("tr", {}, heads.map(function (h, i) {
                return el("th", { scope: "col", className: i === 0 ? "room-col" : null, text: h });
            }))])
        ]);
        table.appendChild(el("tbody", {}, rows.map(function (cells) {
            return el("tr", {}, cells.map(function (cell, i) {
                return i === 0 ? el("th", { scope: "row", className: "room-col", text: cell }) : el("td", { text: cell });
            }));
        })));
        if (total) {
            table.appendChild(el("tfoot", {}, [el("tr", { className: "total-row" }, total.map(function (cell, i) {
                return i === 0 ? el("th", { scope: "row", className: "room-col", text: cell }) : el("td", { text: cell });
            }))]));
        }
        return el("div", { className: "grid-wrap report-wrap", tabindex: "0", role: "region", "aria-label": caption }, [table]);
    }

    async function loadReport() {
        if (!stock.reportFrom) setPeriod("month");

        var table = $("reportTable");
        $("reportRange").textContent = "Loading…";

        var data = await api("GET", "/admin/stock/report?from=" + stock.reportFrom + "&to=" + stock.reportTo);
        stock.report = data;
        $("reportFrom").value = data.from;
        $("reportTo").value = data.to;

        var prices = can("stock.prices");
        $("reportRange").textContent = formatDay(data.from, { day: "numeric", month: "short", year: "numeric" }) + " – " +
            formatDay(data.to, { day: "numeric", month: "short", year: "numeric" }) + " · " + plural(data.rows.length, "item", "items");

        table.textContent = "";
        table.appendChild(el("caption", { className: "visually-hidden", text: "Stock used and remaining for the period" }));

        var heads = ["Item", "At start", "Received", "Used", "Corrections", "Remaining"];
        if (prices) heads.push("Value used", "Value remaining");

        table.appendChild(el("thead", {}, [el("tr", {}, heads.map(function (h, i) {
            return el("th", { scope: "col", className: i === 0 ? "room-col" : null, text: h });
        }))]));

        var body = el("tbody");
        var lastCategory = "";
        var totalUsed = 0;
        var totalLeft = 0;
        var totalCorrections = 0;

        if (!data.rows.length) {
            body.appendChild(el("tr", {}, [el("td", { colspan: String(heads.length), className: "empty-cell", text: "No items yet." })]));
        }

        data.rows.forEach(function (row) {
            if (row.category !== lastCategory) {
                lastCategory = row.category;
                body.appendChild(el("tr", { className: "group-row" }, [
                    el("th", { scope: "colgroup", colspan: String(heads.length), text: row.category })
                ]));
            }

            var lowNow = row.remaining <= 0 || (row.lowStockAt > 0 && row.remaining <= row.lowStockAt);
            var cells = [
                el("th", { scope: "row", className: "room-col" }, [
                    el("span", { className: "room-col-name", text: row.name }),
                    el("span", { className: "room-col-count", text: row.unit + (row.active ? "" : " · archived") })
                ]),
                el("td", { text: qty(row.atStart) }),
                el("td", { text: row.received ? "+" + qty(row.received) : "0" }),
                el("td", { text: row.used ? "−" + qty(row.used) : "0" }),
                el("td", { text: row.corrections ? signed(row.corrections) : "0" }),
                el("td", { className: lowNow ? "is-low" : null, text: qty(row.remaining) + (lowNow ? " ⚠" : "") })
            ];

            if (prices) {
                cells.push(el("td", { text: formatRwf(row.usedValue) }), el("td", { text: formatRwf(row.remainingValue) }));
                totalUsed += row.usedValue;
                totalLeft += row.remainingValue;
                totalCorrections += row.correctionsValue || 0;
            }

            body.appendChild(el("tr", {}, cells));
        });

        table.appendChild(body);

        if (prices && data.rows.length) {
            var foot = el("tr", { className: "total-row" }, [el("th", { scope: "row", className: "room-col", text: "Total" })]);
            for (var i = 0; i < 5; i += 1) foot.appendChild(el("td", { text: "" }));
            foot.appendChild(el("td", { text: formatRwf(totalUsed) }));
            foot.appendChild(el("td", { text: formatRwf(totalLeft) }));
            table.appendChild(el("tfoot", {}, [foot]));
        }

        // Money (owner): spending, issues by department, count differences
        var money = $("moneyReport");
        money.textContent = "";

        if (data.departments) {
            var spentTotal = data.spent.reduce(function (sum, row) { return sum + row.spent; }, 0);
            var deptTotal = data.departments.reduce(function (sum, row) { return sum + row.value; }, 0);

            money.appendChild(el("h2", { className: "section-title", text: "Money for this period" }));
            money.appendChild(el("div", { className: "stats money-stats" }, [
                staticStat(formatRwf(spentTotal), "Bought", "Purchases recorded"),
                staticStat(formatRwf(deptTotal), "Issued", "Value given to departments"),
                staticStat(signedRwf(totalCorrections), "Count differences", totalCorrections < 0 ? "Missing at counts" : "Found at counts"),
                staticStat(formatRwf(totalLeft), "Remaining", "Value in store at the end")
            ]));

            money.appendChild(moneyTable("Bought, by category", ["Category", "Spent"],
                data.spent.filter(function (r) { return r.spent; }).map(function (r) { return [r.category, formatRwf(r.spent)]; }),
                ["Total", formatRwf(spentTotal)]));

            money.appendChild(moneyTable("Issued to departments", ["Department", "Times issued", "Value"],
                data.departments.filter(function (d) { return d.issues; }).map(function (d) { return [d.department, String(d.issues), formatRwf(d.value)]; }),
                ["Total", "", formatRwf(deptTotal)]));
        }
    }

    /* A file Excel opens: comma separated, with the BOM so letters like é show correctly. */
    function csvCell(value) {
        if (typeof value === "number") return String(value);
        var textValue = String(value === undefined || value === null ? "" : value);
        if (/^[=+\-@\t\r]/.test(textValue)) textValue = "'" + textValue; // never run as a formula
        return /[",\r\n]/.test(textValue) ? "\"" + textValue.replace(/"/g, "\"\"") + "\"" : textValue;
    }

    function downloadCsv(lines, fileName) {
        var csv = "﻿" + lines.map(function (line) {
            return line.map(csvCell).join(",");
        }).join("\r\n");

        var link = el("a", {
            href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
            download: fileName
        });
        document.body.appendChild(link);
        link.click();
        setTimeout(function () {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 1000);
    }

    $("reportDownload").addEventListener("click", function () {
        var data = stock.report;
        if (!data) return;

        var prices = can("stock.prices");
        var head = ["Item", "Category", "Counted in", "At start", "Received", "Used", "Corrections", "Remaining", "Warn at"];
        if (prices) head.push("Price for one (RWF)", "Value used (RWF)", "Value remaining (RWF)");

        var lines = [head].concat(data.rows.map(function (row) {
            var line = [row.name, row.category, row.unit, row.atStart, row.received, row.used, row.corrections, row.remaining, row.lowStockAt];
            if (prices) line.push(row.unitCost, row.usedValue, row.remainingValue);
            return line;
        }));

        if (data.departments) {
            lines.push([], ["Bought, by category", "Spent (RWF)"]);
            data.spent.forEach(function (r) { lines.push([r.category, r.spent]); });
            lines.push([], ["Issued to departments", "Times issued", "Value (RWF)"]);
            data.departments.forEach(function (d) { lines.push([d.department, d.issues, d.value]); });
        }

        downloadCsv(lines, "zebra-dormus-stock-" + data.from + "-to-" + data.to + ".csv");
    });

    /* ----- Audit log (owner) ----- */

    var AUDIT_AREA_NAMES = {
        "sign-in": "Sign-in",
        bookings: "Bookings",
        rooms: "Rooms",
        users: "Users",
        stock: "Stock",
        purchases: "Purchases",
        requests: "Requests",
        budget: "Budget"
    };

    function auditRow(entry) {
        return el("article", { className: "audit-row" }, [
            el("p", { className: "audit-when", text: bookedAt(entry.createdAt) }),
            el("div", {}, [
                el("p", { className: "audit-what", text: entry.action }),
                el("p", {
                    className: "stock-meta",
                    text: (entry.userName || "Someone") + (entry.role ? " (" + (ROLE_NAMES[entry.role] || entry.role) + ")" : "") + " · " + (AUDIT_AREA_NAMES[entry.area] || entry.area)
                })
            ])
        ]);
    }

    async function loadAudit(more) {
        var list = $("auditList");
        var params = [];

        if (stock.auditArea) params.push("area=" + encodeURIComponent(stock.auditArea));
        if (stock.auditQ) params.push("q=" + encodeURIComponent(stock.auditQ));
        if (more && stock.auditBefore) params.push("before=" + encodeURIComponent(stock.auditBefore));

        if (!more) {
            stock.auditEntries = [];
            placeholder(list, "Loading the audit log…");
        }

        var data = await api("GET", "/admin/audit" + (params.length ? "?" + params.join("&") : ""));

        if (!more) list.textContent = "";
        if (!data.entries.length && !more) list.appendChild(el("p", { className: "empty", text: "Nothing found." }));

        data.entries.forEach(function (entry) {
            stock.auditEntries.push(entry);
            list.appendChild(auditRow(entry));
        });

        var last = data.entries[data.entries.length - 1];
        stock.auditBefore = last ? last.createdAt : "";
        $("moreAudit").hidden = data.entries.length < 100;
    }

    var auditTimer = null;

    $("auditArea").addEventListener("change", function () {
        stock.auditArea = this.value;
        loadAudit(false).catch(showLoadError);
    });

    $("auditSearch").addEventListener("input", function () {
        var box = this;
        clearTimeout(auditTimer);
        auditTimer = setTimeout(function () {
            stock.auditQ = box.value.trim();
            loadAudit(false).catch(showLoadError);
        }, 350);
    });

    $("moreAudit").addEventListener("click", function () {
        loadAudit(true).catch(showLoadError);
    });

    $("auditDownload").addEventListener("click", function () {
        var lines = [["When", "Who", "Role", "Area", "What"]].concat(stock.auditEntries.map(function (entry) {
            return [bookedAt(entry.createdAt), entry.userName, ROLE_NAMES[entry.role] || entry.role, AUDIT_AREA_NAMES[entry.area] || entry.area, entry.action];
        }));
        downloadCsv(lines, "zebra-dormus-audit-" + kigaliToday() + ".csv");
    });

    /* ----- Loading the Stock section ----- */

    async function loadStock(quiet) {
        var staffOnly = !can("stock.view");

        $("stockHeading").textContent = staffOnly ? "Supplies" : "Stock";
        $("stockIntro").textContent = staffOnly
            ? "Ask for what your department needs. The manager issues it; then confirm you received it."
            : "What came into the store, what was used and what remains.";

        if (!stock.tab || !stockTabAllowed(stock.tab)) stock.tab = defaultStockTab();

        if (!staffOnly) {
            if (!quiet) {
                $("stockStats").textContent = "";
                if (stock.tab === "items") placeholder($("stockList"), "Loading stock…");
            }

            var data = await api("GET", "/admin/stock/items" + (stock.archived ? "?archived=1" : ""));
            var before = {};
            stock.items.forEach(function (item) {
                before[item._id] = item.quantity;
            });

            // highlight remaining numbers someone else changed since the last look
            stock.changed = {};
            if (quiet) {
                data.items.forEach(function (item) {
                    if (before[item._id] !== undefined && before[item._id] !== item.quantity) stock.changed[item._id] = true;
                });
            }

            stock.items = data.items;
            stock.updatedAt = new Date();
            stock.categories = data.categories;
            stock.departments = data.departments;
            stock.summary = data.summary;
            stock.counts = can("stock.approve") && data.summary.countsWaiting
                ? (await api("GET", "/admin/stock/counts")).counts
                : [];

            fillCategorySelect();
            renderStockStats();
            renderStockAlert();
        } else {
            $("stockAlert").hidden = true;
        }

        showStockTab(stock.tab);
        await loadStockTab(stock.tab, quiet);
    }

    /* ---------- Start ---------- */

    async function start() {
        if (!getToken()) {
            showSignin(takeSignoutNote());
            return;
        }

        var last = savedActive();
        if (last && Date.now() - last >= IDLE_LIMIT_MS) {
            signOut("You were signed out because this screen wasn't used for " + IDLE_MINUTES + " minutes. Please sign in again.");
            return;
        }
        lastActive = last || Date.now();

        try {
            var data = await api("GET", "/admin/me");
            showApp(data.user);
        } catch (error) {
            // a 401 has already sent the person back to sign in
            if (error.status !== 401) showSignin(error.message);
        }
    }

    start();
})();

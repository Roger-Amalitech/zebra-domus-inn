/* =========================================
   ZEBRA DORMUS INN
   Staff dashboard: sign in, today, bookings,
   availability grid and room settings.
   Talks to /api/admin on the booking server.
========================================= */

(function () {
    "use strict";

    var API = window.ZD_API || "/api";
    var TOKEN_KEY = "zdAdminToken";
    var VIEWS = ["today", "bookings", "availability", "stock", "rooms", "staff", "account"];
    var OWNER_VIEWS = ["rooms", "staff"];
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var AUTO_REFRESH_MS = 60 * 1000;

    var memoryToken = "";
    var signedIn = false;
    var user = null; /* { _id, name, email, role, fromEnv } */
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

    function AdminError(message, status) {
        this.message = message;
        this.status = status;
    }

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
            throw new AdminError("Can't reach the booking server. Check that it is running, then press Refresh.", 0);
        }

        var data = null;

        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }

        if (response.status === 401 && path !== "/admin/login") {
            signOut("You were signed out. Please sign in again.");
            throw new AdminError("", 401);
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

    /* ---------- Sign in / out ---------- */

    function isOwner() {
        return Boolean(user && user.role === "owner");
    }

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

    /* Show the signed-in person's name, and the owner-only tabs to the owner. */
    function applyUser(nextUser) {
        user = nextUser;
        $("accountName").textContent = user.name;
        $("accountButton").setAttribute("aria-label", "My account: " + user.name);
        document.querySelectorAll("[data-owner-only]").forEach(function (node) {
            node.hidden = !isOwner();
        });
    }

    function showApp(nextUser) {
        applyUser(nextUser);
        signedIn = true;
        $("signin").hidden = true;
        $("app").hidden = false;
        show(viewFromHash(), true);
    }

    function signOut(message) {
        setToken("");
        showSignin(message);
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
            var data = await api("POST", "/admin/login", { email: email.value.trim(), password: password.value });
            setToken(data.token);
            password.value = "";
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

    /* ---------- Switching sections ---------- */

    function viewFromHash() {
        var view = window.location.hash.replace("#", "");
        if (VIEWS.indexOf(view) < 0) return "today";
        if (OWNER_VIEWS.indexOf(view) >= 0 && !isOwner()) return "today";
        return view;
    }

    var TITLES = { today: "Today", bookings: "Bookings", availability: "Availability", stock: "Stock", rooms: "Rooms", staff: "Staff", account: "My account" };

    function show(view, first) {
        var changed = view !== current || first;
        current = view;

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
        staff: loadStaff,
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
        load(current, false).then(function () {
            button.classList.remove("is-spinning");
        });
    });

    // New bookings show up on their own while the page is open.
    setInterval(function () {
        if (!signedIn || document.visibilityState !== "visible") return;
        if (["stock", "rooms", "staff", "account"].indexOf(current) >= 0) return;
        if (document.querySelector(".confirm-text")) return;
        if (document.activeElement === $("searchBox")) return;
        load(current, true);
    }, AUTO_REFRESH_MS);

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

    /* ---------- Staff accounts (owner only) ---------- */

    function lastSignIn(iso) {
        return iso ? "Last signed in " + bookedAt(iso) : "Hasn't signed in yet";
    }

    function staffCard(account) {
        var isSelf = user && String(account._id) === String(user._id);
        var actions = el("div", { className: "booking-actions" });

        var card = el("article", { className: "staff-card" + (account.active ? "" : " is-off") }, [
            el("div", {}, [
                el("div", { className: "staff-top" }, [
                    el("h3", { className: "staff-name", text: account.name }),
                    el("div", { className: "badges" }, [
                        el("span", {
                            className: account.role === "owner" ? "badge badge-solid" : "badge",
                            text: account.role === "owner" ? "Owner" : "Staff"
                        }),
                        account.active ? null : el("span", { className: "badge badge-muted", text: "Turned off" }),
                        isSelf ? el("span", { className: "badge badge-dashed", text: "You" }) : null
                    ])
                ]),
                el("p", { className: "staff-email", text: account.email }),
                el("p", { className: "staff-meta", text: lastSignIn(account.lastLoginAt) })
            ]),
            actions
        ]);

        function setBusy(busy) {
            actions.querySelectorAll("button, input").forEach(function (b) {
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
                change("DELETE", null, account.name + " has been removed.");
            }));
            actions.appendChild(keep);
            keep.focus();
        }

        function renderActions() {
            actions.textContent = "";

            if (account.fromEnv) {
                actions.appendChild(el("p", { className: "staff-meta", text: "The owner's sign-in comes from backend/.env on the server. Change it there." }));
                return;
            }

            if (isSelf) {
                actions.appendChild(el("p", { className: "staff-meta", text: "This is you. Change your password in My account." }));
                return;
            }

            actions.appendChild(button("Reset password", "btn-ghost", askNewPassword));
            actions.appendChild(button(account.active ? "Turn off" : "Turn on", "btn-ghost", function () {
                change(
                    "PATCH",
                    { active: !account.active },
                    account.active ? account.name + " can no longer sign in." : account.name + " can sign in again."
                );
            }));
            actions.appendChild(button("Remove", "btn-ghost btn-danger", askToRemove));
        }

        renderActions();
        return card;
    }

    async function loadStaff(quiet) {
        var list = $("staffList");

        if (!quiet) placeholder(list, "Loading accounts…");

        var data = await api("GET", "/admin/staff");

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

        add.disabled = true;
        message.textContent = "Adding…";

        try {
            var data = await api("POST", "/admin/staff", {
                name: name.value.trim(),
                email: email.value.trim(),
                password: password.value
            });
            form.reset();
            message.textContent = "";
            toast(data.user.name + " can now sign in with " + data.user.email + ".");
            load("staff", true);
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
        $("myRole").textContent = isOwner()
            ? "Owner: everything, including rooms, prices and staff"
            : "Staff: today, bookings and availability";
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
        tab: "items",
        items: [],
        categories: [],
        summary: null,
        archived: false,
        q: "",
        category: "",
        only: "",          /* "", "low" or "out" */
        changesBefore: "",
        reportFrom: "",
        reportTo: "",
        report: null
    };

    var STOCK_UNITS = ["pieces", "rolls", "bottles", "bars", "packs", "boxes", "kits", "kg", "litres", "sets", "cans"];

    function qty(value) {
        return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
    }

    function signed(value) {
        var number = Number(value || 0);
        return (number > 0 ? "+" : number < 0 ? "−" : "") + qty(Math.abs(number));
    }

    var STOCK_STATUS = {
        ok: { text: "In stock", className: "pill" },
        low: { text: "Running low", className: "pill pill-low" },
        out: { text: "Out of stock", className: "pill pill-full" }
    };

    function stockMatches(item) {
        if (stock.category && item.category !== stock.category) return false;
        if (stock.only === "low" && item.status !== "low") return false;
        if (stock.only === "out" && item.status !== "out") return false;
        if (stock.q && item.name.toLowerCase().indexOf(stock.q.toLowerCase()) < 0) return false;
        return true;
    }

    function showStockTab(tab) {
        stock.tab = tab;
        document.querySelectorAll("[data-stock-tab]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-stock-tab") === tab));
        });
        $("stockItemsPanel").hidden = tab !== "items";
        $("stockChangesPanel").hidden = tab !== "changes";
        $("stockReportPanel").hidden = tab !== "report";
    }

    document.querySelectorAll("[data-stock-tab]").forEach(function (b) {
        b.addEventListener("click", function () {
            showStockTab(b.getAttribute("data-stock-tab"));
            if (stock.tab === "items") renderStockList();
            else load("stock", false);
        });
    });

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
                load("stock", false);
            }));
        }
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
            count.textContent = plural(shown.length, "item", "items");
        }

        if (!stock.items.length) {
            var empty = el("div", { className: "empty stock-empty" }, [
                el("p", { text: "Nothing is in the stock list yet." })
            ]);

            if (isOwner()) {
                empty.appendChild(el("p", { text: "Add your own items, or start with a list of common things an inn keeps (toilet paper, soap, towels, water…). You can change or archive any of them." }));
                empty.appendChild(button("Add common items", "btn-primary", async function () {
                    this.disabled = true;
                    try {
                        var data = await api("POST", "/admin/stock/items/starter");
                        toast(plural(data.added, "item", "items") + " added. Now count what you have and press “Count” on each.");
                        load("stock", true);
                    } catch (error) {
                        if (error.status !== 401) toast(error.message, true);
                        this.disabled = false;
                    }
                }));
            } else {
                empty.appendChild(el("p", { text: "The owner adds the items to keep track of." }));
            }

            list.appendChild(empty);
            return;
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
        } catch (error) {
            /* the card already shows the change */
        }
    }

    function stockCard(item) {
        var info = STOCK_STATUS[item.status] || STOCK_STATUS.ok;
        var formBox = el("div", { className: "stock-form-box" });
        var actions = el("div", { className: "booking-actions" });

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
            el("p", { className: "stock-qty" }, [
                el("strong", { text: qty(item.quantity) }),
                " " + item.unit
            ]),
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
                actions.appendChild(button("− Used", "btn-ghost", function () { openMove("out"); }));
                actions.appendChild(button("+ Received", "btn-ghost", function () { openMove("in"); }));
                actions.appendChild(button("Count", "btn-ghost", function () { openMove("count"); }));
            }

            if (isOwner()) {
                actions.appendChild(button("Edit", "btn-ghost", function () { openItemForm(item); }));
            }
        }

        function openMove(type) {
            actions.textContent = "";
            formBox.textContent = "";

            var id = "move-" + item._id;
            var question = {
                out: "How many " + item.unit + " were used?",
                "in": "How many " + item.unit + " came in?",
                count: "How many " + item.unit + " are there now?"
            }[type];
            var hint = {
                out: "What for? For example: rooms 1–3, kitchen",
                "in": "From where? For example: Simba market",
                count: "For example: monthly count"
            }[type];

            var amount = el("input", { id: id + "-qty", type: "number", inputmode: "decimal", min: "0", step: "0.01", required: true });
            if (type === "count") amount.value = String(item.quantity);
            var note = el("input", { id: id + "-note", type: "text", maxlength: "200", placeholder: hint, autocomplete: "off" });
            var day = el("input", { id: id + "-day", type: "date", max: kigaliToday(), value: kigaliToday() });
            var price = null;

            var fields = [
                el("div", { className: "room-field" }, [el("label", { for: id + "-qty", text: question }), amount]),
                el("div", { className: "room-field" }, [el("label", { for: id + "-note", text: "Note (optional)" }), note]),
                el("div", { className: "room-field" }, [el("label", { for: id + "-day", text: "Day" }), day])
            ];

            if (type === "in" && isOwner()) {
                price = el("input", { id: id + "-price", type: "number", inputmode: "numeric", min: "0", step: "1", placeholder: item.unitCost ? String(item.unitCost) : "" });
                fields.push(el("div", { className: "room-field" }, [el("label", { for: id + "-price", text: "Price paid for one (RWF, optional)" }), price]));
            }

            var message = el("p", { className: "room-form-message", role: "status" });
            var save = el("button", { type: "submit", className: "btn btn-primary btn-small", text: "Save" });

            var form = el("form", { className: "stock-move", novalidate: true }, [
                el("div", { className: "room-fields" }, fields),
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
                    message.textContent = "Only " + qty(item.quantity) + " " + item.unit + " are in stock. If that's wrong, use Count.";
                    amount.focus();
                    return;
                }

                var body = { type: type, quantity: number, note: note.value.trim(), day: day.value };
                if (price && price.value !== "") body.unitCost = Number(price.value);

                save.disabled = true;
                message.textContent = "Saving…";

                try {
                    var data = await api("POST", "/admin/stock/items/" + item._id + "/movements", body);
                    var updated = data.item;
                    var done;

                    if (type === "out") done = "Used " + qty(number) + " " + item.unit + " of " + item.name + ". " + qty(updated.quantity) + " left.";
                    else if (type === "in") done = "Added " + qty(number) + " " + item.unit + " of " + item.name + ". " + qty(updated.quantity) + " in stock.";
                    else {
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

    /* Add or change an item (owner) */
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

        var fields = [
            el("div", { className: "room-field" }, [el("label", { for: "itemName", text: "Name" }), name]),
            el("div", { className: "room-field" }, [el("label", { for: "itemCategory", text: "Category" }), category]),
            el("div", { className: "room-field" }, [el("label", { for: "itemUnit", text: "Counted in" }), unit, unitList])
        ];

        if (!editing) {
            fields.push(el("div", { className: "room-field" }, [el("label", { for: "itemStart", text: "How many you have now" }), start]));
        }

        fields.push(
            el("div", { className: "room-field" }, [
                el("label", { for: "itemLow", text: "Warn me when there are" }),
                low,
                el("p", { className: "help", id: "itemLowHelp", text: "…or fewer left. 0 = never warn." })
            ]),
            el("div", { className: "room-field" }, [el("label", { for: "itemCost", text: "Price for one (RWF)" }), cost]),
            el("div", { className: "room-field room-field-wide" }, [el("label", { for: "itemNotes", text: "Notes (optional)" }), notes])
        );

        var foot = el("div", { className: "room-form-foot" }, [
            save,
            button("Cancel", "btn-ghost", function () {
                slot.textContent = "";
            })
        ]);

        if (editing) {
            foot.appendChild(button(item.active ? "Archive item" : "Bring back", "btn-ghost btn-danger", function () {
                submit({ active: !item.active }, item.active
                    ? item.name + " archived. It stays in old reports."
                    : item.name + " is back in the stock list.");
            }));
        }

        foot.appendChild(message);

        var form = el("form", { className: "form-card item-form", novalidate: true }, [
            el("h2", { text: editing ? "Change " + item.name : "Add an item" }),
            el("div", { className: "room-fields" }, fields),
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
                unitCost: cost.value === "" ? 0 : Number(cost.value),
                notes: notes.value.trim()
            };

            if (!editing) body.quantity = start.value === "" ? 0 : Number(start.value);

            submit(body, editing ? body.name + " saved." : body.name + " added.");
        });

        slot.appendChild(form);
        slot.scrollIntoView({ behavior: "smooth", block: "start" });
        name.focus();
    }

    $("addItemButton").addEventListener("click", function () {
        openItemForm(null);
    });

    /* Changes: what was used, received or counted, newest first */
    var MOVE_WORDS = { out: "Used", "in": "Received", count: "Counted" };

    function changeRow(move) {
        var what = move.type === "count"
            ? "Counted: " + qty(move.quantity) + " (" + signed(move.change) + ")"
            : MOVE_WORDS[move.type] + " " + qty(move.quantity);

        var meta = [formatDay(move.day, { weekday: "short", day: "numeric", month: "short" }), move.userName ? "by " + move.userName : ""];
        if (move.unitCost) meta.push(formatRwf(move.unitCost) + " each");

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
            list.appendChild(el("p", { className: "empty", text: "Nothing has been used, received or counted yet." }));
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

    /* Report: what was used and what is left, for a period */
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
        } else {
            stock.reportFrom = addDays(today, -6);
            stock.reportTo = today;
        }

        $("reportFrom").value = stock.reportFrom;
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

    async function loadReport() {
        if (!stock.reportFrom) setPeriod("month");

        var table = $("reportTable");
        $("reportRange").textContent = "Loading…";

        var data = await api("GET", "/admin/stock/report?from=" + stock.reportFrom + "&to=" + stock.reportTo);
        stock.report = data;

        var owner = isOwner();
        $("reportRange").textContent = formatDay(data.from, { day: "numeric", month: "short", year: "numeric" }) + " – " +
            formatDay(data.to, { day: "numeric", month: "short", year: "numeric" }) + " · " + plural(data.rows.length, "item", "items");

        table.textContent = "";
        table.appendChild(el("caption", { className: "visually-hidden", text: "Stock used and left for the period" }));

        var heads = ["Item", "At start", "Received", "Used", "Corrections", "Left"];
        if (owner) heads.push("Value used", "Value left");

        table.appendChild(el("thead", {}, [el("tr", {}, heads.map(function (h, i) {
            return el("th", { scope: "col", className: i === 0 ? "room-col" : null, text: h });
        }))]));

        var body = el("tbody");
        var lastCategory = "";
        var totalUsed = 0;
        var totalLeft = 0;

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

            if (owner) {
                cells.push(el("td", { text: formatRwf(row.usedValue) }), el("td", { text: formatRwf(row.remainingValue) }));
                totalUsed += row.usedValue;
                totalLeft += row.remainingValue;
            }

            body.appendChild(el("tr", {}, cells));
        });

        table.appendChild(body);

        if (owner && data.rows.length) {
            var foot = el("tr", { className: "total-row" }, [el("th", { scope: "row", className: "room-col", text: "Total" })]);
            for (var i = 0; i < 5; i += 1) foot.appendChild(el("td", { text: "" }));
            foot.appendChild(el("td", { text: formatRwf(totalUsed) }));
            foot.appendChild(el("td", { text: formatRwf(totalLeft) }));
            table.appendChild(el("tfoot", {}, [foot]));
        }
    }

    /* A file Excel opens: comma separated, with the BOM so letters like é show correctly. */
    function csvCell(value) {
        if (typeof value === "number") return String(value);
        var textValue = String(value === undefined || value === null ? "" : value);
        if (/^[=+\-@\t\r]/.test(textValue)) textValue = "'" + textValue; // never run as a formula
        return /[",\r\n]/.test(textValue) ? "\"" + textValue.replace(/"/g, "\"\"") + "\"" : textValue;
    }

    $("reportDownload").addEventListener("click", function () {
        var data = stock.report;
        if (!data) return;

        var owner = isOwner();
        var head = ["Item", "Category", "Counted in", "At start", "Received", "Used", "Corrections", "Left", "Warn at"];
        if (owner) head.push("Price for one (RWF)", "Value used (RWF)", "Value left (RWF)");

        var lines = [head].concat(data.rows.map(function (row) {
            var line = [row.name, row.category, row.unit, row.atStart, row.received, row.used, row.corrections, row.remaining, row.lowStockAt];
            if (owner) line.push(row.unitCost, row.usedValue, row.remainingValue);
            return line;
        }));

        var csv = "﻿" + lines.map(function (line) {
            return line.map(csvCell).join(",");
        }).join("\r\n");

        var link = el("a", {
            href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
            download: "zebra-dormus-stock-" + data.from + "-to-" + data.to + ".csv"
        });
        document.body.appendChild(link);
        link.click();
        setTimeout(function () {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 1000);
    });

    async function loadStock(quiet) {
        if (!quiet) {
            $("stockStats").textContent = "";
            if (stock.tab === "items") placeholder($("stockList"), "Loading stock…");
        }

        var data = await api("GET", "/admin/stock/items" + (stock.archived ? "?archived=1" : ""));
        stock.items = data.items;
        stock.categories = data.categories;
        stock.summary = data.summary;

        fillCategorySelect();
        renderStockStats();
        renderStockAlert();
        showStockTab(stock.tab);

        if (stock.tab === "items") renderStockList();
        else if (stock.tab === "changes") await loadChanges(false);
        else await loadReport();
    }

    /* ---------- Start ---------- */

    async function start() {
        if (!getToken()) {
            showSignin("");
            return;
        }

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

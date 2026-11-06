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
    var VIEWS = ["today", "bookings", "availability", "rooms", "staff", "account"];
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

    var TITLES = { today: "Today", bookings: "Bookings", availability: "Availability", rooms: "Rooms", staff: "Staff", account: "My account" };

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
        if (["rooms", "staff", "account"].indexOf(current) >= 0) return;
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

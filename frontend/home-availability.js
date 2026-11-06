/* =========================================
   ZEBRA DORMUS INN
   Home page: each room card says whether the room is booked
   tonight, or for the dates picked in "Check-in / Check-out".
   Asks the booking server (GET /api/availability), counts only.
========================================= */

(function () {
    "use strict";

    if (!document.getElementById("roomGrid")) return;

    var REFRESH_MS = 90 * 1000;
    var request = 0;

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

    function addDays(text, days) {
        var date = new Date(text + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    }

    function isDay(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
    }

    /* The dates the guest picked, or tonight when none are picked yet. */
    function wantedStay() {
        var checkIn = (document.getElementById("checkIn") || {}).value || "";
        var checkOut = (document.getElementById("checkOut") || {}).value || "";
        var today = kigaliToday();

        if (isDay(checkIn) && isDay(checkOut) && checkOut > checkIn && checkIn >= today) {
            return { checkIn: checkIn, checkOut: checkOut, forDates: true };
        }

        return { checkIn: today, checkOut: addDays(today, 1), forDates: false };
    }

    function check() {
        if (!window.ZD_API || !window.fetch) return;

        var stay = wantedStay();
        var mine = ++request;
        var address = window.ZD_API + "/availability?checkIn=" + stay.checkIn + "&checkOut=" + stay.checkOut;

        fetch(address, { cache: "no-store" })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
                if (mine !== request || !data || !data.success || !Array.isArray(data.rooms)) return;

                var rooms = {};
                data.rooms.forEach(function (room) {
                    rooms[String(room._id)] = Number(room.available) || 0;
                });

                window.ZDHomeAvailability = { forDates: stay.forDates, rooms: rooms };

                if (typeof renderzebradormusRooms === "function") renderzebradormusRooms();
            })
            .catch(function () { /* no answer: the cards just don't show it */ });
    }

    ["checkIn", "checkOut"].forEach(function (id) {
        var field = document.getElementById(id);
        if (field) field.addEventListener("change", check);
    });

    /* rooms get booked while the page is open: look again now and then */
    setInterval(function () {
        if (document.visibilityState === "visible") check();
    }, REFRESH_MS);

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
    else check();
})();

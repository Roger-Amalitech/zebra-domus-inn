/* =========================================
   ZEBRA DORMUS INN
   Where the booking server (the backend) is.

   Leave BOOKING_SERVER empty while the website is opened from the
   booking server itself (http://localhost:5000 on your computer, or
   one hosted web service that serves both the site and the API).

   If the backend is ever hosted at its own, different address, put
   that address here, for example:
   var BOOKING_SERVER = "https://zebra-dormus-api.onrender.com";
========================================= */

(function () {
    "use strict";

    var BOOKING_SERVER = "";

    var server = BOOKING_SERVER.replace(/\/+$/, "");

    if (!server) {
        var host = window.location.hostname;
        var onThisComputer = host === "localhost" || host === "127.0.0.1";
        var previewTool = ["3000", "5500"].indexOf(window.location.port) >= 0;

        if (window.location.protocol === "file:" || (onThisComputer && previewTool)) {
            // Opened straight from the folder, or from a preview tool such as
            // VS Code Live Server: use the booking server on this computer.
            server = "http://localhost:5000";
        } else {
            server = window.location.origin;
        }
    }

    window.ZD_API = server + "/api";
})();

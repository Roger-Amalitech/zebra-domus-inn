/* Zebra Dormus Inn: the prices on the home page's event cards.
   The owner sets them in the dashboard; until then the card says to ask for the price.
   Follows the language chosen in the header. */
(function () {
    "use strict";

    var prices = {};

    function words() {
        return typeof getCurrentTranslations === "function" ? getCurrentTranslations() : {};
    }

    function render() {
        var t = words();
        document.querySelectorAll("[data-event-price]").forEach(function (node) {
            var price = prices[node.getAttribute("data-event-price")];
            if (price) {
                var amount = "RWF " + Number(price).toLocaleString("en-US");
                node.textContent = (t.eventPriceFor || "{price} for the event").replace("{price}", amount);
            } else {
                node.textContent = t.eventPriceAsk || "Ask us for the price";
            }
        });
    }

    function init() {
        if (!document.querySelector("[data-event-price]")) return;

        var language = document.getElementById("languageSelect");
        if (language) language.addEventListener("change", render);
        render();

        fetch((window.ZD_API || "/api") + "/events")
            .then(function (response) { return response.json(); })
            .then(function (data) {
                (data.types || []).forEach(function (type) {
                    prices[type.key] = type.price;
                });
                render();
            })
            .catch(function () { /* the card keeps "Ask us for the price" */ });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

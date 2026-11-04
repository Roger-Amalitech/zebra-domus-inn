/* Zebra Dormus Inn: the header is see-through over the top photo,
   and turns solid white as soon as the guest scrolls or opens the menu. */
(function () {
    var SOLID_AFTER = 40; // pixels scrolled before the header turns white

    function init() {
        var header = document.querySelector(".header");
        var hero = document.querySelector(".hero");
        if (!header || !hero) return;

        var menuButton = document.getElementById("menuButton");
        // Turns on the photo-behind-header layout only when this script runs.
        document.documentElement.classList.add("has-overlay-header");

        var overlay = null;
        function update() {
            var menuOpen = menuButton && menuButton.getAttribute("aria-expanded") === "true";
            var show = window.scrollY <= SOLID_AFTER && !menuOpen;
            if (show === overlay) return;
            overlay = show;
            header.classList.toggle("is-overlay", show);
        }

        window.addEventListener("scroll", update, { passive: true });
        if (menuButton && "MutationObserver" in window) {
            new MutationObserver(update).observe(menuButton, { attributes: true, attributeFilter: ["aria-expanded"] });
        }
        update();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

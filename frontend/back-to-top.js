/* Zebra Domus Inn: "Back to top" button.
   Appears once the guest has scrolled past the date search, and takes them back to the top.
   Its label follows the language chosen in the header (EN / RW / FR). */
(function () {
    var LABELS = { en: "Back to top", rw: "Subira hejuru", fr: "Retour en haut" };
    var SHOW_AFTER = 600; // pixels scrolled before the button appears

    function currentLang() {
        var select = document.getElementById("languageSelect");
        return (select && select.value) || "en";
    }

    function init() {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "back-to-top";
        button.innerHTML =
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
        document.body.appendChild(button);

        function setLabel() {
            var text = LABELS[currentLang()] || LABELS.en;
            button.setAttribute("aria-label", text);
            button.title = text;
        }

        var visible = null;
        function update() {
            var show = window.scrollY > SHOW_AFTER;
            if (show === visible) return; // only touch the page when the state changes
            visible = show;
            button.classList.toggle("is-visible", show);
        }
        window.addEventListener("scroll", update, { passive: true });

        button.addEventListener("click", function () {
            var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
            // Keyboard users land on the logo at the top, not stranded at the bottom.
            var logo = document.querySelector("header a");
            if (logo) logo.focus({ preventScroll: true });
        });

        var select = document.getElementById("languageSelect");
        if (select) select.addEventListener("change", setLabel);

        setLabel();
        update();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

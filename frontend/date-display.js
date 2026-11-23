/* Zebra Domus Inn: shows the search-box dates as dd/mm/yyyy in every browser.
   The real date fields stay underneath, so tapping still opens the phone's own date picker,
   and the booking script keeps reading and setting them exactly as before. */
(function () {
    var EMPTY = { en: "Add date", rw: "Hitamo itariki", fr: "Choisir" };

    function currentLang() {
        var select = document.getElementById("languageSelect");
        return (select && select.value) || "en";
    }

    function format(value) {
        if (!value) return "";
        var parts = value.split("-");
        return parts[2] + "/" + parts[1] + "/" + parts[0];
    }

    function setup(input) {
        var box = input.parentElement;
        var display = document.createElement("span");
        display.className = "date-display";
        display.setAttribute("aria-hidden", "true");
        box.appendChild(display);
        input.classList.add("has-date-display");

        var last = null;
        function place() { display.style.left = input.offsetLeft + "px"; }
        function render() {
            place(); // a field that was hidden (a closed view) has moved once shown
            var key = input.value + "|" + currentLang();
            if (key === last) return;
            last = key;
            display.textContent = input.value ? format(input.value) : (EMPTY[currentLang()] || EMPTY.en);
            display.classList.toggle("is-empty", !input.value);
        }

        input.addEventListener("change", render);
        input.addEventListener("input", render);
        input.addEventListener("click", function () {
            try { if (input.showPicker) input.showPicker(); } catch (e) { /* not supported: the field still opens on tap */ }
        });
        window.addEventListener("resize", place);
        setInterval(render, 400); // the booking script can also set dates, and the language can change

        place();
        render();
    }

    function init() {
        ["checkIn", "checkOut"].forEach(function (id) {
            var input = document.getElementById(id);
            if (input) setup(input);
        });
        // other date fields that ask for the same look (the event day on events.html)
        document.querySelectorAll("input[type=date][data-date-display]").forEach(setup);
    }

    // for date fields made later (the day in an event's details view)
    window.ZDDateDisplay = function (input) {
        if (input && !input.classList.contains("has-date-display")) setup(input);
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

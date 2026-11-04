/* Zebra Dormus Inn: the photo row.
   The photos sit in one row that slides sideways on every screen.
   Phones and tablets: swipe. Computers (or any screen used with a mouse): the round
   arrows beside the "Photos" title move one screenful at a time and turn grey at either end. */
(function () {
    "use strict";

    var LABELS = {
        en: { prev: "Previous photos", next: "Next photos" },
        rw: { prev: "Amafoto abanza", next: "Amafoto akurikira" },
        fr: { prev: "Photos précédentes", next: "Photos suivantes" }
    };

    var ICON = {
        prev: "M15 18l-6-6 6-6",
        next: "M9 6l6 6-6 6"
    };

    function lang() {
        var select = document.getElementById("languageSelect");
        var value = select && select.value;
        return LABELS[value] ? value : "en";
    }

    function arrow(kind) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "gallery-arrow gallery-" + kind;
        button.setAttribute("aria-controls", "photoRow");
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + ICON[kind] +
            '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        return button;
    }

    function init() {
        var section = document.getElementById("photos");
        var row = section && section.querySelector(".gallery");
        if (!row) return;
        row.id = row.id || "photoRow";

        /* title and line of text on the left, arrows on the right */
        var head = document.createElement("div");
        head.className = "section-head";
        var text = document.createElement("div");
        text.className = "section-head-text";
        var title = section.querySelector("h2");
        var sub = section.querySelector(".section-sub");
        section.insertBefore(head, row);
        if (title) text.appendChild(title);
        if (sub) text.appendChild(sub);

        var nav = document.createElement("div");
        nav.className = "gallery-nav";
        var prev = arrow("prev");
        var next = arrow("next");
        nav.append(prev, next);
        head.append(text, nav);

        function label() {
            var words = LABELS[lang()];
            prev.setAttribute("aria-label", words.prev);
            next.setAttribute("aria-label", words.next);
        }

        /* one screenful: as many whole photos as are in view */
        function step() {
            var photo = row.querySelector("figure");
            if (!photo) return row.clientWidth;
            var gap = parseFloat(getComputedStyle(row).columnGap) || 0;
            var width = photo.getBoundingClientRect().width + gap;
            return Math.max(1, Math.floor((row.clientWidth + gap) / width)) * width;
        }

        function update() {
            var end = row.scrollWidth - row.clientWidth;
            var atStart = row.scrollLeft <= 2;
            var atEnd = row.scrollLeft >= end - 2;
            /* keep keyboard focus on an arrow that still works */
            if (atEnd && document.activeElement === next && !atStart) prev.focus({ preventScroll: true });
            if (atStart && document.activeElement === prev && !atEnd) next.focus({ preventScroll: true });
            prev.disabled = atStart;
            next.disabled = atEnd;
        }

        function move(direction) {
            var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            row.scrollBy({ left: direction * step(), behavior: still ? "auto" : "smooth" });
        }

        prev.addEventListener("click", function () { move(-1); });
        next.addEventListener("click", function () { move(1); });

        var waiting = false;
        function soon() {
            if (waiting) return;
            waiting = true;
            requestAnimationFrame(function () { waiting = false; update(); });
        }
        row.addEventListener("scroll", soon, { passive: true });
        window.addEventListener("resize", soon);

        var language = document.getElementById("languageSelect");
        if (language) language.addEventListener("change", function () { setTimeout(label, 0); });

        label();
        update();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

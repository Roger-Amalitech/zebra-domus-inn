/* Zebra Domus Inn: the photos at the top of the page.
   Guests swipe, tap the see-through arrows, or tap one of the small lines under the
   headline to look through the inn's photos; the headline stays in place while the
   photos change. The photos are listed in index.html inside #heroTrack, and one line
   is made for each photo. After the last photo, "next" goes back to the first.
   Photos load one ahead of the guest, so a phone doesn't download them all at once. */
(function () {
    "use strict";

    var TEXT = {
        en: { prev: "Previous photo", next: "Next photo", region: "Photos of Zebra Domus Inn", photo: function (n, t) { return "Photo " + n + " of " + t; } },
        rw: { prev: "Ifoto ibanza", next: "Ifoto ikurikira", region: "Amafoto ya Zebra Domus Inn", photo: function (n, t) { return "Ifoto ya " + n + " kuri " + t; } },
        fr: { prev: "Photo précédente", next: "Photo suivante", region: "Photos de Zebra Domus Inn", photo: function (n, t) { return "Photo " + n + " sur " + t; } }
    };

    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function init() {
        var track = document.getElementById("heroTrack");
        var controls = document.getElementById("heroControls");
        var prev = document.getElementById("heroPrev");
        var next = document.getElementById("heroNext");
        var dotsBox = document.getElementById("heroDots");
        var language = document.getElementById("languageSelect");
        if (!track || !controls || !prev || !next || !dotsBox) return;

        var slides = Array.prototype.slice.call(track.querySelectorAll("img"));
        var total = slides.length;
        if (total < 2) return;

        var index = 0;
        var frame = 0;

        function at(i) { return ((i % total) + total) % total; }

        /* start loading a photo before the guest reaches it */
        function warm(i) {
            var image = slides[at(i)];
            if (image && image.loading === "lazy") image.loading = "eager";
        }

        function go(i) {
            var target = at(i);
            warm(target);
            track.scrollTo({ left: target * track.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
        }

        /* one line per photo */
        var dots = slides.map(function (slide, i) {
            var dot = document.createElement("button");
            dot.type = "button";
            dot.className = "hero-dot";
            dot.setAttribute("aria-controls", "heroTrack");
            dot.addEventListener("click", function () { go(i); });
            dotsBox.appendChild(dot);
            return dot;
        });

        function update() {
            frame = 0;
            var width = track.clientWidth || 1;
            index = Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / width)));
            dots.forEach(function (dot, i) {
                if (i === index) dot.setAttribute("aria-current", "true");
                else dot.removeAttribute("aria-current");
            });
            warm(index + 1);
            warm(index - 1);
        }

        function label() {
            var t = TEXT[language && TEXT[language.value] ? language.value : "en"];
            prev.setAttribute("aria-label", t.prev);
            next.setAttribute("aria-label", t.next);
            track.setAttribute("aria-label", t.region);
            dots.forEach(function (dot, i) { dot.setAttribute("aria-label", t.photo(i + 1, total)); });
        }

        prev.addEventListener("click", function () { go(index - 1); });
        next.addEventListener("click", function () { go(index + 1); });

        track.addEventListener("scroll", function () {
            if (!frame) frame = requestAnimationFrame(update);
        }, { passive: true });

        track.addEventListener("keydown", function (event) {
            if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
            else if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        });

        /* keep the same photo in view when the phone turns or the window resizes */
        window.addEventListener("resize", function () {
            track.scrollLeft = index * track.clientWidth;
        });

        if (language) language.addEventListener("change", label);

        controls.hidden = false;
        label();
        update();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

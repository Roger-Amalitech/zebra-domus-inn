/* Zebra Dormus Inn: the photo grid.
   The photos sit in a collage (index.html, #photoGrid): one big photo and smaller ones
   around it. The last photo in the collage is shaded with "+8 photos" on it: the photos
   that are only in the full-screen view. Tapping any photo opens it full screen:
   - swipe, the arrows or the keyboard's left and right keys go to the next photo
   - a row of small photos along the bottom on a computer
   - the X, Escape or the phone's back button closes it.
   Captions follow the language chosen in the header (EN / RW / FR). */
(function () {
    "use strict";

    var TEXT = {
        en: { close: "Close", prev: "Previous photo", next: "Next photo", more: function (n) { return "+" + n + " photos"; }, of: function (i, n) { return i + " / " + n; } },
        rw: { close: "Funga", prev: "Ifoto ibanza", next: "Ifoto ikurikira", more: function (n) { return "+" + n + " amafoto"; }, of: function (i, n) { return i + " / " + n; } },
        fr: { close: "Fermer", prev: "Photo précédente", next: "Photo suivante", more: function (n) { return "+" + n + " photos"; }, of: function (i, n) { return i + " / " + n; } }
    };

    var PATHS = {
        close: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
        prev: '<path d="M15 18l-6-6 6-6"/>',
        next: '<path d="M9 6l6 6-6 6"/>'
    };

    function byId(id) { return document.getElementById(id); }

    function lang() {
        var select = byId("languageSelect");
        var value = select && select.value;
        return TEXT[value] ? value : "en";
    }

    function tx() { return TEXT[lang()]; }

    function icon(name, size) {
        var template = document.createElement("template");
        template.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + PATHS[name] + "</svg>";
        return template.content.firstElementChild;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function init() {
        var grid = byId("photoGrid");
        if (!grid) return;

        var tiles = Array.prototype.slice.call(grid.querySelectorAll(".photo-open"));
        if (!tiles.length) return;

        function photo(i) {
            var img = tiles[i].querySelector("img");
            var caption = tiles[i].querySelector(".photo-caption");
            return { src: img.getAttribute("src"), alt: img.alt, caption: caption ? caption.textContent : "" };
        }

        /* the last photo in the collage: "+8 photos" (the ones only seen full screen,
           counting this shaded one) */
        var shown = tiles.filter(function (tile) { return !tile.parentNode.hidden; });
        var last = shown[shown.length - 1];
        var extra = tiles.length - shown.length + 1;
        var moreText = null;
        if (extra > 1) {
            last.classList.add("has-more");
            moreText = el("span", "photo-more");
            last.appendChild(moreText);
        }

        /* ---------- the full-screen view ---------- */

        var dialog = null;
        var els = {};
        var index = 0;
        var pushed = false;
        var returnFocus = null;

        function build() {
            if (dialog) return;

            dialog = el("dialog", "photo-viewer");
            dialog.setAttribute("aria-labelledby", "pvCaption");

            var top = el("div", "pv-top");
            var count = el("p", "pv-count");
            var close = el("button", "glass-button pv-close");
            close.type = "button";
            close.appendChild(icon("close", 20));
            top.append(count, close);

            var stage = el("div", "pv-stage");
            var image = el("img", "pv-image");
            image.decoding = "async";
            image.draggable = false; // a drag with the mouse is a swipe, not "save the picture"
            var prev = el("button", "glass-button pv-arrow pv-prev");
            prev.type = "button";
            prev.appendChild(icon("prev", 22));
            var next = el("button", "glass-button pv-arrow pv-next");
            next.type = "button";
            next.appendChild(icon("next", 22));
            stage.append(image, prev, next);

            var caption = el("p", "pv-caption");
            caption.id = "pvCaption";

            var thumbs = el("div", "pv-thumbs");
            tiles.forEach(function (tile, i) {
                var thumb = el("button", "pv-thumb");
                thumb.type = "button";
                var small = el("img");
                small.src = photo(i).src;
                small.alt = "";
                small.loading = "lazy";
                thumb.appendChild(small);
                thumb.addEventListener("click", function () { show(i); });
                thumbs.appendChild(thumb);
            });

            dialog.append(top, stage, caption, thumbs);
            document.body.appendChild(dialog);
            els = { count: count, close: close, image: image, prev: prev, next: next, caption: caption, thumbs: thumbs };

            close.addEventListener("click", requestClose);
            prev.addEventListener("click", function () { show(index - 1); });
            next.addEventListener("click", function () { show(index + 1); });
            dialog.addEventListener("cancel", function (event) {
                event.preventDefault();
                requestClose();
            });
            dialog.addEventListener("keydown", function (event) {
                if (event.key === "ArrowLeft") { event.preventDefault(); show(index - 1); }
                if (event.key === "ArrowRight") { event.preventDefault(); show(index + 1); }
            });

            /* swipe left or right on the photo */
            var startX = null;
            var startY = null;
            stage.addEventListener("pointerdown", function (event) {
                if (event.target.closest("button")) return;
                startX = event.clientX;
                startY = event.clientY;
            });
            stage.addEventListener("pointerup", function (event) {
                if (startX === null) return;
                var dx = event.clientX - startX;
                var dy = event.clientY - startY;
                startX = null;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
            });
            stage.addEventListener("pointercancel", function () { startX = null; });
        }

        function label() {
            var t = tx();
            if (moreText) moreText.textContent = t.more(extra);
            if (!dialog) return;
            dialog.setAttribute("lang", lang());
            els.close.setAttribute("aria-label", t.close);
            els.prev.setAttribute("aria-label", t.prev);
            els.next.setAttribute("aria-label", t.next);
            Array.prototype.forEach.call(els.thumbs.children, function (thumb, i) {
                thumb.setAttribute("aria-label", photo(i).caption || photo(i).alt);
            });
        }

        function show(i) {
            var n = tiles.length;
            index = (i + n) % n; // the last photo goes round to the first
            var p = photo(index);
            els.image.src = p.src;
            els.image.alt = p.alt;
            els.caption.textContent = p.caption;
            els.count.textContent = tx().of(index + 1, n);
            Array.prototype.forEach.call(els.thumbs.children, function (thumb, j) {
                if (j === index) thumb.setAttribute("aria-current", "true");
                else thumb.removeAttribute("aria-current");
            });
            var current = els.thumbs.children[index];
            if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest", inline: "center" });
            // the next photo is ready before it is asked for
            new Image().src = photo((index + 1) % n).src;
        }

        function open(i) {
            build();
            label();
            show(i);
            if (!dialog.open) {
                returnFocus = document.activeElement;
                dialog.showModal();
                document.documentElement.classList.add("rs-lock");
                els.close.focus({ preventScroll: true });
                try {
                    history.pushState({ zdPhoto: true }, ""); // same address: Back closes the photo
                    pushed = true;
                } catch (error) {
                    pushed = false;
                }
            }
        }

        function finishClose() {
            pushed = false;
            if (dialog && dialog.open) dialog.close();
            document.documentElement.classList.remove("rs-lock");
            if (returnFocus && document.contains(returnFocus) && returnFocus.focus) returnFocus.focus({ preventScroll: true });
            returnFocus = null;
        }

        function requestClose() {
            if (pushed && history.state && history.state.zdPhoto) history.back(); /* popstate below finishes */
            else finishClose();
        }

        window.addEventListener("popstate", function () {
            if (dialog && dialog.open && !(history.state && history.state.zdPhoto)) finishClose();
        });

        tiles.forEach(function (tile, i) {
            tile.addEventListener("click", function () { open(i); });
        });

        var language = byId("languageSelect");
        if (language) language.addEventListener("change", function () {
            setTimeout(function () {
                label();
                if (dialog && dialog.open) show(index);
            }, 0);
        });

        label();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();

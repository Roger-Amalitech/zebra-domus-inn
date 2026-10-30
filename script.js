/* =========================================
   ZEBRA DOMUS INN
   Mobile menu, room cards, room selection,
   price summary and booking submission
========================================= */

const GREEN_HAVEN_API = "http://localhost:5000/api";

let zebradomusRooms = [];

/* Shown when the backend isn't running. Keep these in step with
   the rooms in the database (backend/seedRooms.js). */
const BUILT_IN_ROOMS = [
    {
        id: "standard-room",
        name: "Standard Room",
        pricePerNight: 25000,
        description: "A cozy, comfortable room for a restful stay.",
        capacity: 2,
        totalRooms: 1
    },
    {
        id: "deluxe-room",
        name: "Deluxe Room",
        pricePerNight: 40000,
        description: "Extra space and comfort for a special getaway.",
        capacity: 2,
        totalRooms: 1
    },
    {
        id: "family-room",
        name: "Family Room",
        pricePerNight: 55000,
        description: "A spacious, comfortable room for families.",
        capacity: 4,
        totalRooms: 1
    }
];

let zebradomusUsingBuiltInRooms = false;

/* Zebra Domus room photos, kept in the images folder.
   These are shown for the matching room type. To use different
   photos, replace the files or change the names here. */
const roomImageFallbacks = {
    standard:
        "images/room-standard.jpg",

    deluxe:
        "images/room-deluxe.jpg",

    family:
        "images/room-family.jpg"
};


/* =========================================
   SMALL HELPERS
========================================= */

function getTranslations() {
    return typeof getCurrentTranslations === "function"
        ? getCurrentTranslations()
        : {};
}

function formatRwf(amount) {
    return `RWF ${Number(amount).toLocaleString("en-US")}`;
}

/* Read "YYYY-MM-DD" as a local date (not UTC). */
function parseInputDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
        return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function toInputDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function formatShortDate(date) {
    return date.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short"
    });
}

function getStay() {
    const checkIn = parseInputDate(document.getElementById("checkIn")?.value);
    const checkOut = parseInputDate(document.getElementById("checkOut")?.value);
    const guests = Number(document.getElementById("guests")?.value) || 1;

    let nights = 0;

    if (checkIn && checkOut) {
        nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    }

    return { checkIn, checkOut, nights, guests };
}

function getRoomId(room) {
    return String(room._id ?? room.id ?? "");
}

function getRoomPrice(room) {
    const amount = Number(room.pricePerNight ?? room.price);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function findRoom(roomId) {
    return zebradomusRooms.find((room) => getRoomId(room) === roomId) || null;
}

/* Static icon markup (no user data goes in here). */
const icons = {
    guests:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    door:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M14 12h.01"/></svg>',
    check:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
};

function iconElement(name) {
    const template = document.createElement("template");
    template.innerHTML = icons[name] || "";
    return template.content.firstElementChild;
}


/* =========================================
   MOBILE MENU
========================================= */

function initzebradomusMobileMenu() {
    const menuButton = document.getElementById("menuButton");
    const navigation = document.getElementById("navigation");

    if (!menuButton || !navigation) {
        console.error("Mobile menu button or navigation was not found.");
        return;
    }

    function setMenu(isOpen) {
        navigation.classList.toggle("active", isOpen);
        menuButton.setAttribute("aria-expanded", String(isOpen));
        menuButton.setAttribute(
            "aria-label",
            isOpen ? "Close menu" : "Open menu"
        );
    }

    menuButton.addEventListener("click", function () {
        setMenu(!navigation.classList.contains("active"));
    });

    navigation.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            setMenu(false);
        });
    });

    navigation.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            setMenu(false);
            menuButton.focus();
        }
    });
}


/* =========================================
   ROOM TEXT AND IMAGES
========================================= */

function getRoomTranslations(room) {
    const t = getTranslations();

    const name = String(
        room.name || room.roomType || ""
    ).toLowerCase();

    if (name.includes("standard")) {
        return {
            name: t.standardRoom || "Standard Room",
            description:
                room.description ||
                t.standardDescription ||
                "A comfortable room for your stay.",
            image: roomImageFallbacks.standard,
            hasOwnPhoto: true
        };
    }

    if (name.includes("deluxe")) {
        return {
            name: t.deluxeRoom || "Deluxe Room",
            description:
                room.description ||
                t.deluxeDescription ||
                "Enjoy extra space and comfort.",
            image: roomImageFallbacks.deluxe,
            hasOwnPhoto: true
        };
    }

    if (name.includes("family")) {
        return {
            name: t.familyRoom || "Family Room",
            description:
                room.description ||
                t.familyDescription ||
                "A spacious room for families.",
            image: roomImageFallbacks.family,
            hasOwnPhoto: true
        };
    }

    return {
        name: room.name || room.roomType || "Motel Room",
        description:
            room.description || "A comfortable room for your stay.",
        image: roomImageFallbacks.standard
    };
}


/* =========================================
   ROOM CARDS
========================================= */

function renderzebradomusRooms() {
    const roomGrid = document.getElementById("roomGrid");

    if (!roomGrid) {
        console.error('Zebra Domus: "#roomGrid" was not found.');
        return;
    }

    const t = getTranslations();

    if (zebradomusRooms.length === 0) {
        const empty = document.createElement("p");
        empty.className = "room-status";
        empty.textContent = "No rooms are available right now.";
        roomGrid.replaceChildren(empty);
        return;
    }

    const stay = getStay();
    const selectedId = document.getElementById("roomType")?.value || "";
    const fragment = document.createDocumentFragment();

    zebradomusRooms.forEach((room) => {
        const translated = getRoomTranslations(room);
        const roomId = getRoomId(room);
        const capacity = Number(room.capacity) || 2;
        const tooSmall = stay.guests > capacity;
        const isSelected = roomId !== "" && roomId === selectedId;

        const card = document.createElement("article");
        card.className = "room-card" + (isSelected ? " is-selected" : "");

        /* Room image */

        const imageWrapper = document.createElement("div");
        imageWrapper.className = "room-image";

        const image = document.createElement("img");

        const suppliedImage =
            typeof room.image === "string"
                ? room.image.trim()
                : "";

        const fallbackImage = translated.image;

        /* Use the inn's own photo for Standard, Deluxe and Family rooms.
           Any other room type uses the image saved in the database. */
        image.src = translated.hasOwnPhoto || !/^(https?:\/\/|images\/)/i.test(suppliedImage)
            ? fallbackImage
            : suppliedImage;

        image.alt = translated.name;
        image.loading = "lazy";
        image.decoding = "async";

        image.addEventListener("error", () => {
            if (!image.dataset.fallbackUsed) {
                image.dataset.fallbackUsed = "true";
                image.src = fallbackImage;
            } else {
                image.hidden = true;
            }
        });

        imageWrapper.appendChild(image);

        if (isSelected) {
            const badge = document.createElement("span");
            badge.className = "room-badge";
            badge.textContent = "Your choice";
            imageWrapper.appendChild(badge);
        }

        card.appendChild(imageWrapper);

        /* Room information */

        const content = document.createElement("div");
        content.className = "room-content";

        const title = document.createElement("h3");
        title.className = "room-title";
        title.textContent = translated.name;

        const features = document.createElement("div");
        features.className = "room-features";

        const capacityLabel = document.createElement("span");
        capacityLabel.append(
            iconElement("guests"),
            `Up to ${capacity} ${capacity === 1 ? "guest" : "guests"}`
        );
        features.appendChild(capacityLabel);

        const totalRooms = Number(room.totalRooms);

        if (Number.isFinite(totalRooms) && totalRooms > 0) {
            const roomsLabel = document.createElement("span");
            roomsLabel.append(
                iconElement("door"),
                `${totalRooms} ${totalRooms === 1 ? "room" : "rooms"} of this type`
            );
            features.appendChild(roomsLabel);
        }

        const description = document.createElement("p");
        description.className = "room-description";
        description.textContent = translated.description;

        content.append(title, features, description);

        if (tooSmall) {
            const warning = document.createElement("p");
            warning.className = "room-warning";
            warning.textContent =
                `Fits ${capacity} ${capacity === 1 ? "guest" : "guests"} — you chose ${stay.guests}.`;
            content.appendChild(warning);
        }

        /* Price and Book Now button */

        const bottom = document.createElement("div");
        bottom.className = "room-bottom";

        const price = document.createElement("p");
        price.className = "room-price";

        const amount = getRoomPrice(room);

        if (amount === null) {
            const unavailable = document.createElement("strong");
            unavailable.textContent = "Price unavailable";
            price.appendChild(unavailable);
        } else {
            const perNight = document.createElement("strong");
            perNight.textContent = `${formatRwf(amount)} `;

            const per = document.createElement("span");
            per.className = "per";
            per.textContent = t.perNight || "/ night";
            perNight.appendChild(per);

            price.appendChild(perNight);

            if (stay.nights > 0) {
                const stayTotal = document.createElement("span");
                stayTotal.className = "stay-total";
                stayTotal.textContent =
                    `${formatRwf(amount * stay.nights)} for ${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`;
                price.appendChild(stayTotal);
            }
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "room-button";
        button.dataset.roomId = roomId;
        button.dataset.roomName = String(
            room.name ?? room.roomType ?? translated.name
        );
        button.setAttribute("aria-pressed", String(isSelected));

        if (tooSmall) {
            button.disabled = true;
            button.textContent = "Too small";
        } else if (isSelected) {
            button.append(iconElement("check"), "Selected");
        } else {
            button.textContent = t.bookNow || "Select";
        }

        bottom.append(price, button);
        content.appendChild(bottom);

        card.appendChild(content);
        fragment.appendChild(card);
    });

    roomGrid.replaceChildren(fragment);
}


/* Fill the "Room" dropdown in the booking form. */

function populateRoomSelect() {
    const roomType = document.getElementById("roomType");

    if (!roomType) {
        return;
    }

    const previous = roomType.value;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
        zebradomusRooms.length > 0 ? "Choose a room" : "No rooms available";

    const options = [placeholder];

    zebradomusRooms.forEach((room) => {
        const translated = getRoomTranslations(room);
        const amount = getRoomPrice(room);
        const option = document.createElement("option");

        option.value = getRoomId(room);
        option.textContent = amount === null
            ? translated.name
            : `${translated.name} · ${formatRwf(amount)}`;

        options.push(option);
    });

    roomType.replaceChildren(...options);

    if (previous && findRoom(previous)) {
        roomType.value = previous;
    }
}


/* Show how many rooms start from. */

function updateRoomsIntro() {
    const intro = document.getElementById("roomsFrom");
    const prices = zebradomusRooms
        .map(getRoomPrice)
        .filter((price) => price !== null);

    if (intro && prices.length > 0) {
        intro.textContent =
            `From ${formatRwf(Math.min(...prices))} a night`;
    }
}


/* Load rooms from the existing backend */

async function loadzebradomusRooms() {
    const roomGrid = document.getElementById("roomGrid");

    if (!roomGrid) {
        console.error('Zebra Domus: "#roomGrid" was not found.');
        return;
    }

    const loading = document.createElement("p");
    loading.className = "room-status";
    loading.textContent = "Loading rooms…";
    roomGrid.replaceChildren(loading);

    try {
        const response = await fetch(`${GREEN_HAVEN_API}/rooms`);

        if (!response.ok) {
            throw new Error(`Rooms API returned HTTP ${response.status}`);
        }

        const result = await response.json();

        const rooms = Array.isArray(result)
            ? result
            : Array.isArray(result.rooms)
                ? result.rooms
                : Array.isArray(result.data)
                    ? result.data
                    : Array.isArray(result.data?.rooms)
                        ? result.data.rooms
                        : null;

        if (!rooms) {
            throw new Error("The API response does not contain a rooms array.");
        }

        zebradomusRooms = rooms;
        populateRoomSelect();
        updateRoomsIntro();
        renderzebradomusRooms();
        updateBookingSummary();

        console.log(
            `Zebra Domus: Loaded ${rooms.length} rooms successfully.`
        );

    } catch (error) {
        /* No backend running: still show the rooms from the built-in
           list, but don't pretend online booking works (see submit). */
        console.warn(
            "Zebra Domus: backend not reachable, showing the built-in room list.",
            error
        );

        zebradomusUsingBuiltInRooms = true;
        zebradomusRooms = BUILT_IN_ROOMS;
        populateRoomSelect();
        updateRoomsIntro();
        renderzebradomusRooms();
        updateBookingSummary();
    }
}


/* Book Now: select the room and scroll to the booking form */

function handlezebradomusBookNow(event) {
    const button = event.target.closest(".room-button");

    if (!button || button.disabled) {
        return;
    }

    const roomGrid = document.getElementById("roomGrid");

    if (!roomGrid || !roomGrid.contains(button)) {
        return;
    }

    const roomId = button.dataset.roomId;
    const roomName = button.dataset.roomName;

    const bookingSection = document.getElementById("booking");
    const roomType = document.getElementById("roomType");

    /* Remember the selected room for other booking code. */

    window.zebradomusSelectedRoomId = roomId;
    window.zebradomusSelectedRoomName = roomName;

    /* Select the matching room in the dropdown. */

    if (roomType) {
        const options = Array.from(roomType.options);

        let matchingOption = options.find((option) =>
            option.value === roomId && roomId !== ""
        );

        if (!matchingOption) {
            matchingOption = options.find((option) =>
                option.value === roomName ||
                option.text.trim() === roomName
            );
        }

        if (matchingOption) {
            roomType.value = matchingOption.value;
            roomType.dispatchEvent(
                new Event("change", { bubbles: true })
            );
        } else {
            console.warn(
                "Book Now: No matching option exists in #roomType. " +
                "The form will still scroll into view."
            );
        }
    }

    if (bookingSection) {
        bookingSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } else {
        console.error('Book Now: Add id="booking" to the booking section.');
    }
}


/* =========================================
   STAY SUMMARY AND PRICE
========================================= */

function updateBookingSummary() {
    const stay = getStay();
    const room = findRoom(document.getElementById("roomType")?.value || "");

    /* "Your stay" line */

    const stayDates = document.getElementById("stayDates");
    const stayGuests = document.getElementById("stayGuests");

    if (stayDates) {
        if (stay.checkIn && stay.checkOut && stay.nights > 0) {
            stayDates.textContent =
                `${formatShortDate(stay.checkIn)} – ${formatShortDate(stay.checkOut)} · ` +
                `${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`;
        } else if (stay.checkIn && stay.checkOut) {
            stayDates.textContent = "Check-out must be after check-in";
        } else {
            stayDates.textContent = "Choose your dates";
        }
    }

    if (stayGuests) {
        stayGuests.textContent =
            `${stay.guests} ${stay.guests === 1 ? "guest" : "guests"}` +
            (room ? ` · ${getRoomTranslations(room).name}` : "");
    }

    /* Price summary */

    const summary = document.getElementById("priceSummary");

    if (!summary) {
        return;
    }

    const price = room ? getRoomPrice(room) : null;

    if (!room || price === null || stay.nights <= 0) {
        const empty = document.createElement("p");
        empty.className = "summary-empty";
        empty.textContent = "Choose a room and your dates to see the total.";
        summary.replaceChildren(empty);
        return;
    }

    const total = price * stay.nights;
    const payment = getSelectedPayment();

    const row = (label, value, className = "summary-row") => {
        const line = document.createElement("div");
        line.className = className;

        const left = document.createElement("span");
        left.textContent = label;

        const right = document.createElement("span");
        right.textContent = value;

        line.append(left, right);
        return line;
    };

    const divider = document.createElement("div");
    divider.className = "summary-divider";

    summary.replaceChildren(
        row(
            `${formatRwf(price)} × ${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`,
            formatRwf(total)
        ),
        divider,
        row("Total", formatRwf(total), "summary-total"),
        row(
            "Pay",
            payment === "Pay at the Motel" ? "At the inn, on arrival" : payment
        )
    );
}


/* =========================================
   DATES
========================================= */

function initzebradomusDates() {
    const checkIn = document.getElementById("checkIn");
    const checkOut = document.getElementById("checkOut");
    const guests = document.getElementById("guests");

    if (!checkIn || !checkOut) {
        return;
    }

    const today = new Date();
    checkIn.min = toInputDate(today);

    function syncCheckOutMin() {
        const arrival = parseInputDate(checkIn.value);

        if (!arrival) {
            checkOut.min = toInputDate(today);
            return;
        }

        const nextDay = new Date(arrival);
        nextDay.setDate(nextDay.getDate() + 1);
        checkOut.min = toInputDate(nextDay);

        const departure = parseInputDate(checkOut.value);

        if (departure && departure <= arrival) {
            checkOut.value = toInputDate(nextDay);
        }
    }

    function onStayChange() {
        syncCheckOutMin();
        renderzebradomusRooms();
        updateBookingSummary();
    }

    syncCheckOutMin();

    checkIn.addEventListener("change", onStayChange);
    checkOut.addEventListener("change", onStayChange);

    if (guests) {
        guests.addEventListener("change", onStayChange);
    }
}


/* =========================================
   PAYMENT OPTIONS
========================================= */

const paymentNotes = {
    "MTN Mobile Money":
        "Your booking is saved as pending until your MoMo payment is confirmed.",
    "Airtel Money":
        "Your booking is saved as pending until your Airtel Money payment is confirmed.",
    "Visa/Mastercard":
        "Your booking is saved as pending until your card payment is confirmed.",
    "Pay at the Motel":
        "Nothing to pay now. Pay at reception when you arrive."
};

function getSelectedPayment() {
    const checked = document.querySelector('input[name="paymentMethod"]:checked');
    return checked ? checked.value : "";
}

function updatePaymentOptions() {
    const selected = getSelectedPayment();

    document.querySelectorAll(".pay-option").forEach((option) => {
        const input = option.querySelector("input");
        option.classList.toggle("is-checked", Boolean(input && input.checked));
    });

    const note = document.getElementById("paymentNote");

    if (note) {
        note.textContent = paymentNotes[selected] || "";
    }

    updateBookingSummary();
}


/* =========================================
   BOOKING SUBMISSION
========================================= */

function showBookingMessage(text, isInfo = false) {
    const message = document.getElementById("bookingMessage");

    if (!message) {
        return;
    }

    message.classList.toggle("is-info", isInfo);
    message.textContent = text;
}

function setSubmitting(isSubmitting) {
    const button = document.getElementById("searchButton");

    if (!button) {
        return;
    }

    button.disabled = isSubmitting;

    const label = button.querySelector(".button-label");

    if (label) {
        label.textContent = isSubmitting ? "Sending your booking…" : "Confirm booking";
    }
}

function showConfirmation(booking) {
    const form = document.getElementById("bookingForm");
    const confirmation = document.getElementById("bookingConfirmed");
    const reference = document.getElementById("confirmRef");
    const details = document.getElementById("confirmDetails");

    if (!form || !confirmation) {
        return;
    }

    if (reference) {
        reference.textContent = booking.bookingReference || "";
    }

    if (details) {
        const arrival = new Date(booking.checkIn);
        const departure = new Date(booking.checkOut);
        const dateOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };

        const rows = [
            ["Room", booking.room],
            ["Check-in", arrival.toLocaleDateString("en-GB", dateOptions)],
            ["Check-out", departure.toLocaleDateString("en-GB", dateOptions)],
            ["Guests", String(booking.guests)],
            ["Total", formatRwf(booking.totalPrice)],
            ["Payment", booking.paymentMethod === "Pay at the Motel" ? "Pay at the inn" : booking.paymentMethod],
            ["Status", "Pending confirmation"]
        ];

        details.replaceChildren(
            ...rows.map(([label, value]) => {
                const line = document.createElement("div");
                const dt = document.createElement("dt");
                const dd = document.createElement("dd");
                dt.textContent = label;
                dd.textContent = value ?? "";
                line.append(dt, dd);
                return line;
            })
        );
    }

    form.hidden = true;
    confirmation.hidden = false;
    confirmation.focus({ preventScroll: true });
    confirmation.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleBookingSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    showBookingMessage("");

    if (!form.reportValidity()) {
        return;
    }

    const stay = getStay();
    const roomId = document.getElementById("roomType")?.value || "";
    const room = findRoom(roomId);

    if (!room) {
        showBookingMessage("Please choose a room.");
        return;
    }

    if (stay.nights <= 0) {
        showBookingMessage("Check-out must be after check-in.");
        document.getElementById("checkOut")?.focus();
        return;
    }

    const capacity = Number(room.capacity) || 2;

    if (stay.guests > capacity) {
        showBookingMessage(
            `This room fits up to ${capacity} guests. Choose a bigger room or fewer guests.`
        );
        return;
    }

    if (zebradomusUsingBuiltInRooms) {
        showBookingMessage(
            "Online booking isn't connected yet. Please call or WhatsApp the inn to book this room."
        );
        return;
    }

    const payload = {
        guestName: document.getElementById("guestName").value.trim(),
        guestEmail: document.getElementById("guestEmail").value.trim(),
        guestPhone: document.getElementById("guestPhone").value.trim(),
        roomId,
        checkIn: document.getElementById("checkIn").value,
        checkOut: document.getElementById("checkOut").value,
        guests: stay.guests,
        paymentMethod: getSelectedPayment()
    };

    setSubmitting(true);

    try {
        const response = await fetch(`${GREEN_HAVEN_API}/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || `Booking failed (HTTP ${response.status}).`
            );
        }

        showConfirmation(result.booking || {});

    } catch (error) {
        console.error("Zebra Domus booking failed:", error);

        const text = error instanceof TypeError
            ? "We couldn't reach the booking server. Check your connection and try again."
            : error.message;

        showBookingMessage(text);

    } finally {
        setSubmitting(false);
    }
}

function resetBooking() {
    const form = document.getElementById("bookingForm");
    const confirmation = document.getElementById("bookingConfirmed");

    if (form) {
        form.reset();
        form.hidden = false;
    }

    if (confirmation) {
        confirmation.hidden = true;
    }

    showBookingMessage("");
    updatePaymentOptions();
    renderzebradomusRooms();
    updateBookingSummary();

    document.getElementById("dates")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


/* =========================================
   START
========================================= */

function initzebradomus() {
    initzebradomusMobileMenu();
    initzebradomusDates();

    const year = document.getElementById("currentYear");

    if (year) {
        year.textContent = String(new Date().getFullYear());
    }

    const roomGrid = document.getElementById("roomGrid");

    if (roomGrid) {
        roomGrid.addEventListener("click", handlezebradomusBookNow);
    }

    const roomType = document.getElementById("roomType");

    if (roomType) {
        roomType.addEventListener("change", () => {
            renderzebradomusRooms();
            updateBookingSummary();
        });
    }

    document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
        input.addEventListener("change", updatePaymentOptions);
    });

    const form = document.getElementById("bookingForm");

    if (form) {
        form.addEventListener("submit", handleBookingSubmit);
    }

    document.getElementById("newBookingButton")
        ?.addEventListener("click", resetBooking);

    updatePaymentOptions();
    loadzebradomusRooms();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initzebradomus, { once: true });
} else {
    initzebradomus();
}

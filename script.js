const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".primary-nav");
const navLinks = [...document.querySelectorAll(".primary-nav a")];
const sections = [...document.querySelectorAll(".section-anchor")];

toggle?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("nav-open");
  toggle.setAttribute("aria-expanded", String(isOpen));
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !document.body.classList.contains("nav-open")) return;
  document.body.classList.remove("nav-open");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.focus();
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    document.body.classList.remove("nav-open");
    toggle?.setAttribute("aria-expanded", "false");
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    navLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${visible.target.id}`;
      link.classList.toggle("is-active", isActive);
      if (isActive) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  },
  { rootMargin: "-35% 0px -45% 0px", threshold: [0.1, 0.25, 0.5] }
);

sections.forEach((section) => observer.observe(section));

const appointmentDialog = document.querySelector("#appointment-dialog");
const appointmentForm = document.querySelector("#appointment-form");
const appointmentStatus = document.querySelector("#appointment-status");
const appointmentFallback = document.querySelector("#appointment-fallback");
const appointmentSubmit = document.querySelector("#appointment-submit");
const turnstileContainer = document.querySelector("#turnstile-widget");
const requestDate = document.querySelector("#request-date");
let appointmentOpener = null;
let turnstileToken = "";
let turnstileWidgetId = null;
let appointmentReady = false;

function setAppointmentStatus(message, state = "info") {
  if (!appointmentStatus) return;
  appointmentStatus.textContent = message;
  appointmentStatus.dataset.state = state;
}

function showAppointmentUnavailable(message) {
  appointmentReady = false;
  if (appointmentSubmit) appointmentSubmit.disabled = true;
  if (appointmentFallback) appointmentFallback.hidden = false;
  setAppointmentStatus(message, "error");
}

function resetAppointmentChallenge() {
  turnstileToken = "";
  if (appointmentSubmit) appointmentSubmit.disabled = true;
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
}

function loadTurnstile(siteKey) {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    if (!window.turnstile || !turnstileContainer) {
      showAppointmentUnavailable("Spam protection could not be loaded. No request was sent.");
      return;
    }
    turnstileWidgetId = window.turnstile.render(turnstileContainer, {
      sitekey: siteKey,
      theme: "dark",
      callback: (token) => {
        turnstileToken = token;
        if (appointmentSubmit && appointmentReady) appointmentSubmit.disabled = false;
      },
      "expired-callback": () => resetAppointmentChallenge(),
      "error-callback": () => showAppointmentUnavailable("Spam protection is unavailable. No request was sent; please call or email the salon."),
    });
  };
  script.onerror = () => showAppointmentUnavailable("Spam protection could not be loaded. No request was sent; please call or email the salon.");
  document.head.append(script);
}

for (const trigger of document.querySelectorAll("[data-open-appointment]")) {
  trigger.addEventListener("click", () => {
    if (!appointmentDialog?.showModal) {
      document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    appointmentOpener = trigger;
    appointmentDialog.showModal();
    document.querySelector("#request-name")?.focus();
  });
}

document.querySelector("[data-close-appointment]")?.addEventListener("click", () => appointmentDialog?.close());
appointmentDialog?.addEventListener("close", () => appointmentOpener?.focus());
appointmentDialog?.addEventListener("click", (event) => {
  if (event.target === appointmentDialog) appointmentDialog.close();
});

if (requestDate) {
  const today = new Date();
  requestDate.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

if (appointmentForm && appointmentSubmit && appointmentStatus) {
  fetch("/api/appointment-request", { headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("request setup unavailable")))
    .then((setup) => {
      if (!setup.ready || !setup.siteKey) {
        showAppointmentUnavailable("Online appointment requests are not connected yet. No request can be sent through this form.");
        return;
      }
      appointmentReady = true;
      if (appointmentFallback) appointmentFallback.hidden = true;
      setAppointmentStatus("Secure request form ready. The salon must confirm availability before an appointment is booked.");
      loadTurnstile(setup.siteKey);
    })
    .catch(() => showAppointmentUnavailable("Online requests are unavailable right now. No request has been sent."));

  appointmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!appointmentForm.reportValidity()) return;

    const formData = new FormData(appointmentForm);
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    if (!email && !phone) {
      setAppointmentStatus("Add an email address or phone number so the salon can contact you. No request was sent.", "error");
      document.querySelector("#request-email")?.focus();
      return;
    }
    if (!appointmentReady) {
      showAppointmentUnavailable("Online requests are not connected yet. No request was sent; please call or email the salon.");
      return;
    }
    if (!turnstileToken) {
      setAppointmentStatus("Complete the spam-protection check before sending your request.", "error");
      return;
    }

    const selectedFiles = [...(document.querySelector("#request-photos")?.files || [])];
    if (selectedFiles.length > 3) {
      setAppointmentStatus("Choose no more than three photos. No request was sent.", "error");
      return;
    }
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    let totalPhotoBytes = 0;
    const photos = [];
    try {
      for (const file of selectedFiles) {
        totalPhotoBytes += file.size;
        if (!allowedTypes.has(file.type) || file.size > 1_048_576 || totalPhotoBytes > 2 * 1_048_576) {
          setAppointmentStatus("Use up to three JPG, PNG, or WebP photos, 1 MB each and 2 MB total. No request was sent.", "error");
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        photos.push({ name: file.name, type: file.type, content: btoa(binary) });
      }
    } catch {
      setAppointmentStatus("A photo could not be read. No request was sent; try again or remove the photo.", "error");
      return;
    }

    appointmentSubmit.disabled = true;
    setAppointmentStatus("Sending your request securely…");
    const payload = {
      name: String(formData.get("name") || "").trim(),
      email,
      phone,
      vehicleType: formData.get("vehicleType"),
      vehicleDetails: formData.get("vehicleDetails"),
      service: formData.get("service"),
      preferredDate: formData.get("preferredDate"),
      notes: formData.get("notes"),
      website: formData.get("website"),
      photos,
      turnstileToken,
    };

    try {
      const response = await fetch("/api/appointment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      resetAppointmentChallenge();
      if (response.ok && result.ok === true) {
        appointmentForm.reset();
        setAppointmentStatus("Your request was sent to X's Auto Salon. They’ll contact you to confirm availability; no appointment is booked until they confirm.", "success");
        if (appointmentFallback) appointmentFallback.hidden = true;
        return;
      }
      if (result.error === "not_configured") {
        showAppointmentUnavailable("Online requests are not connected yet. Your request was not sent; please call or email the salon.");
      } else if (result.error === "captcha_invalid" || result.error === "captcha_required") {
        setAppointmentStatus("The spam-protection check expired or didn’t pass. Try the check again. No request was sent.", "error");
      } else if (result.error === "invalid_photos" || result.error === "request_too_large") {
        setAppointmentStatus(`${result.message || "The photo upload is too large or invalid."} No request was sent.`, "error");
      } else if (response.status === 422) {
        setAppointmentStatus("Check the required fields and contact details. No request was sent.", "error");
      } else {
        setAppointmentStatus("We couldn't send your request. It was not submitted; please call or email the salon.", "error");
        if (appointmentFallback) appointmentFallback.hidden = false;
      }
    } catch {
      resetAppointmentChallenge();
      setAppointmentStatus("We couldn't reach the request service. Your request was not sent; please call or email the salon.", "error");
      if (appointmentFallback) appointmentFallback.hidden = false;
    }
  });
}

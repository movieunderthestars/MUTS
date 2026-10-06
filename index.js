const waitlistForm = document.querySelector("#waitlist-form");
const formNote = document.querySelector("#form-note");
const header = document.querySelector(".topbar");
const heroPanel = document.querySelector(".hero-panel");

function updateHeaderState() {
  if (!header || !heroPanel) {
    return;
  }

  const heroBottom = heroPanel.getBoundingClientRect().bottom;
  header.classList.toggle("scrolled", heroBottom <= 80);
}

window.addEventListener("scroll", updateHeaderState, { passive: true });
window.addEventListener("resize", updateHeaderState);
updateHeaderState();

waitlistForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!waitlistForm.reportValidity()) {
    return;
  }

  const email = new FormData(waitlistForm).get("email")?.toString().trim();

  if (!email) {
    formNote.textContent = "Please enter a valid email address.";
    formNote.classList.remove("is-success");
    formNote.classList.add("is-error");
    return;
  }

  formNote.textContent = "Saving your spot...";
  formNote.classList.remove("is-error", "is-success");

  try {
    const response = await fetch("/api/waitlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Unable to save your email right now.");
    }

    formNote.textContent = data.message || "You’re on the waitlist.";
    formNote.classList.remove("is-error");
    formNote.classList.add("is-success");
    waitlistForm.reset();
  } catch (error) {
    formNote.textContent = error.message || "Unable to save your email right now.";
    formNote.classList.remove("is-success");
    formNote.classList.add("is-error");
  }
});

const waitlistForm = document.querySelector("#waitlist-form");
const formNote = document.querySelector("#form-note");
const surveyDialog = document.querySelector("#survey-dialog");
const surveyForm = document.querySelector("#survey-form");
const surveyNote = document.querySelector("#survey-note");
const surveySkip = document.querySelector("#survey-skip");
const resumeSurveyButton = document.querySelector("#resume-survey");
const header = document.querySelector(".topbar");
const heroPanel = document.querySelector(".hero-panel");
const surveyTokenKey = "muts-survey-token";
let surveyToken = "";

function setResumeSurveyVisible(visible) {
  resumeSurveyButton.hidden = !visible;
}

function rememberSurveyToken(token) {
  surveyToken = token;
  setResumeSurveyVisible(true);
  try {
    localStorage.setItem(surveyTokenKey, token);
  } catch (error) {
    console.error("Unable to remember survey link in this browser:", error);
  }
}

function clearSurveyToken() {
  surveyToken = "";
  setResumeSurveyVisible(false);
  try {
    localStorage.removeItem(surveyTokenKey);
  } catch (error) {
    console.error("Unable to clear saved survey link:", error);
  }
}

async function resumeSurvey(token, openDialog = false) {
  const response = await fetch(`/api/waitlist/survey?token=${encodeURIComponent(token)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "This survey link is invalid or has expired.");
  }

  rememberSurveyToken(token);
  if (openDialog) {
    surveyForm.reset();
    surveyForm.querySelector('[type="submit"]').disabled = false;
    surveyNote.textContent = "";
    surveyNote.classList.remove("is-error", "is-success");
    surveyDialog.showModal();
  }
}

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

const pageUrl = new URL(window.location.href);
const emailSurveyToken = pageUrl.searchParams.get("surveyToken");
let storedSurveyToken = "";
try {
  storedSurveyToken = localStorage.getItem(surveyTokenKey) || "";
} catch (error) {
  console.error("Unable to read saved survey link:", error);
}

if (emailSurveyToken) {
  pageUrl.searchParams.delete("surveyToken");
  window.history.replaceState({}, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}

const initialSurveyToken = emailSurveyToken || storedSurveyToken;
if (initialSurveyToken) {
  resumeSurvey(initialSurveyToken, Boolean(emailSurveyToken)).catch((error) => {
    console.error("Unable to resume survey:", error);
    if (emailSurveyToken) {
      formNote.textContent = error.message || "This survey link is invalid or has expired.";
      formNote.classList.add("is-error");
    }
    if (error.message.includes("invalid") || error.message.includes("expired")) {
      clearSurveyToken();
    }
  });
}

resumeSurveyButton?.addEventListener("click", () => {
  if (!surveyToken) {
    return;
  }
  resumeSurvey(surveyToken, true).catch((error) => {
    console.error("Unable to resume survey:", error);
    formNote.textContent = error.message || "Unable to resume your survey right now.";
    formNote.classList.add("is-error");
    if (error.message.includes("invalid") || error.message.includes("expired")) {
      clearSurveyToken();
    }
  });
});

document.querySelectorAll(".waitlist-form").forEach((currentWaitlistForm) => {
  const currentFormNote = currentWaitlistForm.nextElementSibling?.matches(".form-note")
    ? currentWaitlistForm.nextElementSibling
    : formNote;

  currentWaitlistForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentWaitlistForm.reportValidity()) {
      return;
    }

    const email = new FormData(currentWaitlistForm).get("email")?.toString().trim();

    if (!email) {
      currentFormNote.textContent = "Please enter a valid email address.";
      currentFormNote.classList.remove("is-success");
      currentFormNote.classList.add("is-error");
      return;
    }

    currentFormNote.textContent = "Saving your spot...";
    currentFormNote.classList.remove("is-error", "is-success");

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
      if (typeof data.surveyToken !== "string" || !data.surveyToken) {
        throw new Error("Your spot was saved, but the survey link could not be opened.");
      }

      currentFormNote.textContent = data.message || "You’re on the waitlist.";
      currentFormNote.classList.remove("is-error");
      currentFormNote.classList.add("is-success");
      currentWaitlistForm.reset();
      rememberSurveyToken(data.surveyToken);
      surveyForm.reset();
      surveyForm.querySelector('[type="submit"]').disabled = false;
      surveyNote.textContent = "";
      surveyDialog.showModal();
    } catch (error) {
      currentFormNote.textContent = error.message || "Unable to save your email right now.";
      currentFormNote.classList.remove("is-success");
      currentFormNote.classList.add("is-error");
      if (error.message.includes("already on the waitlist") && surveyToken) {
        currentFormNote.textContent = "This email is already on the waitlist. Continue your survey below.";
      }
    }
  });
});

surveyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!surveyForm.reportValidity()) {
    return;
  }

  const formData = new FormData(surveyForm);
  const answers = {};
  for (const [key, value] of formData.entries()) {
    if (Object.prototype.hasOwnProperty.call(answers, key)) {
      answers[key] = Array.isArray(answers[key]) ? [...answers[key], value] : [answers[key], value];
    } else {
      answers[key] = value;
    }
  }
  surveyNote.textContent = "Sending your answers...";
  surveyNote.classList.remove("is-error", "is-success");

  try {
    const response = await fetch("/api/waitlist/survey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: surveyToken, survey: answers }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Unable to save your answers right now.");
    }

    surveyNote.textContent = "Thanks for helping us plan the night.";
    surveyNote.classList.add("is-success");
    surveyForm.querySelector('[type="submit"]').disabled = true;
    clearSurveyToken();
  } catch (error) {
    surveyNote.textContent = error.message || "Unable to save your answers right now.";
    surveyNote.classList.add("is-error");
  }
});

surveySkip?.addEventListener("click", () => surveyDialog.close());
